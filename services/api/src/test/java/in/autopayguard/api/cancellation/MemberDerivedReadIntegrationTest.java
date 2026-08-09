package in.autopayguard.api.cancellation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
@Import(MemberDerivedReadIntegrationTest.ClockConfiguration.class)
class MemberDerivedReadIntegrationTest {

    private static final UUID STREAMBOX =
            UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final Instant BASE_TIME =
            Instant.parse("2026-08-01T00:00:00Z");
    private static final String PRIVATE_CANARY_NAME =
            "M5 Private Derived Canary";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private MutableClock clock;

    @BeforeEach
    void resetClock() {
        clock.set(BASE_TIME);
    }

    @Test
    void memberReadsOnlySharedDerivedDataAndNeverGainsMutationOrDeliveryAuthority()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m5-derived-owner-" + suffix,
                        "m5-derived-owner-" + suffix + "@example.test",
                        "Derived owner");
        JwtRequestPostProcessor member =
                identity(
                        "m5-derived-member-" + suffix,
                        "m5-derived-member-" + suffix + "@example.test",
                        "Derived member");

        CreatedHousehold household =
                createHousehold(owner, "M5 derived read household");
        grantSharing(owner, "m5-owner-grant-" + suffix);
        UUID memberUserId = provisionAndGrant(member, "m5-member-" + suffix);
        UUID memberId = addMember(household.id(), memberUserId);

        CreatedCommitment shared =
                createCommitment(
                        owner,
                        household.id(),
                        "M5 Shared Derived Item",
                        12_345L,
                        LocalDate.of(2026, 8, 10));
        CreatedCommitment privateCanary =
                createCommitment(
                        owner,
                        household.id(),
                        PRIVATE_CANARY_NAME,
                        900_000L,
                        LocalDate.of(2026, 8, 11));
        share(owner, shared);

        PreparedAttempt sharedAttempt =
                prepareAttempt(owner, shared, "m5-shared-" + suffix);
        PreparedAttempt privateAttempt =
                prepareAttempt(owner, privateCanary, "m5-private-" + suffix);

        UUID sharedNotification =
                insertNotification(
                        household.ownerUserId(),
                        household.id(),
                        shared.id(),
                        sharedAttempt.occurrence().date(),
                        "DELIVERED",
                        null,
                        "c".repeat(64),
                        BASE_TIME.plusSeconds(10));
        UUID privateNotification =
                insertNotification(
                        household.ownerUserId(),
                        household.id(),
                        privateCanary.id(),
                        privateAttempt.occurrence().date(),
                        "DEAD",
                        "PROVIDER_PERMANENT",
                        "d".repeat(64),
                        BASE_TIME.plusSeconds(20));

        MvcResult inbox =
                mockMvc.perform(
                                get("/v1/decisions/inbox")
                                        .param("householdId", household.id().toString())
                                        .param("from", "2026-08-01")
                                        .param("to", "2026-08-31")
                                        .param("limit", "100")
                                        .with(member))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(
                                jsonPath("$.items[0].commitmentId")
                                        .value(shared.id().toString()))
                        .andExpect(
                                jsonPath("$.items[0].currentDecision.decision")
                                        .value("CANCEL_WITH_PROVIDER"))
                        .andReturn();
        assertPrivateCanaryAbsent(inbox);

        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        shared.id())
                                .param("householdId", household.id().toString())
                                .with(member))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(
                        jsonPath("$.items[0].id")
                                .value(sharedAttempt.attemptId().toString()));
        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        privateCanary.id())
                                .param("householdId", household.id().toString())
                                .with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        sharedAttempt.attemptId())
                                .with(member))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.commitmentId")
                                .value(shared.id().toString()));
        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        privateAttempt.attemptId())
                                .with(member))
                .andExpect(status().isNotFound());

        MvcResult memberSavings =
                mockMvc.perform(
                                get("/v1/savings")
                                        .param("householdId", household.id().toString())
                                        .param("limit", "100")
                                        .with(member))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(
                                jsonPath("$.items[0].commitmentId")
                                        .value(shared.id().toString()))
                        .andExpect(jsonPath("$.unquantifiedCount").value(0))
                        .andReturn();
        assertPrivateCanaryAbsent(memberSavings);
        assertThat(
                        JsonPath.<Number>read(
                                        memberSavings.getResponse().getContentAsString(),
                                        "$.currencies[0].totals[0].exactAttemptCount")
                                .intValue())
                .isEqualTo(1);

        mockMvc.perform(
                        get("/v1/notifications")
                                .param("householdId", household.id().toString())
                                .param("filter", "ALL")
                                .with(member))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(
                        jsonPath("$.items[0].id")
                                .value(sharedNotification.toString()));
        mockMvc.perform(
                        get("/v1/notifications")
                                .param("householdId", household.id().toString())
                                .param("filter", "FAILED")
                                .with(member))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
        mockMvc.perform(
                        get("/v1/notifications/{notificationId}", sharedNotification)
                                .with(member))
                .andExpect(status().isOk());
        mockMvc.perform(
                        get("/v1/notifications/{notificationId}", privateNotification)
                                .with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/notification-diagnostics")
                                .param("householdId", household.id().toString())
                                .with(member))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deliveredCount").value(1))
                .andExpect(jsonPath("$.deadCount").value(0))
                .andExpect(jsonPath("$.failures.length()").value(0));

        assertMemberMutationsRemainDenied(
                member,
                sharedAttempt,
                sharedNotification);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM notifications WHERE recipient_user_id = ?",
                                Integer.class,
                                memberUserId))
                .isZero();

        clock.advance(Duration.ofSeconds(1));
        withdrawSharing(member, "m5-member-withdraw-" + suffix);
        assertSharedReadsSuspended(member, household.id(), shared, sharedAttempt, sharedNotification);

        clock.advance(Duration.ofSeconds(1));
        grantSharing(member, "m5-member-regrant-" + suffix);
        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        sharedAttempt.attemptId())
                                .with(member))
                .andExpect(status().isOk());

        jdbc.update(
                """
                UPDATE household_members
                SET status = 'REMOVED', removed_at = ?,
                    optimistic_version = optimistic_version + 1,
                    updated_at = ?
                WHERE id = ?
                """,
                clock.instant(),
                clock.instant(),
                memberId);
        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        sharedAttempt.attemptId())
                                .with(member))
                .andExpect(status().isNotFound());

        mockMvc.perform(
                        get("/v1/savings")
                                .param("householdId", household.id().toString())
                                .param("limit", "100")
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2));
    }

    private void assertMemberMutationsRemainDenied(
            JwtRequestPostProcessor member,
            PreparedAttempt sharedAttempt,
            UUID sharedNotification)
            throws Exception {
        Integer decisionsBefore =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM occurrence_decisions WHERE occurrence_id = ?",
                        Integer.class,
                        sharedAttempt.occurrence().id());
        mockMvc.perform(
                        post(
                                        "/v1/occurrences/{occurrenceId}/decisions",
                                        sharedAttempt.occurrence().id())
                                .with(member)
                                .header(
                                        "Idempotency-Key",
                                        "m5-member-decision-denied")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"decision\":\"KEEP\"}"))
                .andExpect(status().isNotFound());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM occurrence_decisions WHERE occurrence_id = ?",
                                Integer.class,
                                sharedAttempt.occurrence().id()))
                .isEqualTo(decisionsBefore);

        mockMvc.perform(
                        patch(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        sharedAttempt.attemptId())
                                .with(member)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "serviceStatus": "NOT_STARTED",
                                          "paymentMandateStatus": "NOT_STARTED",
                                          "abandoned": false
                                        }
                                        """))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        patch(
                                        "/v1/notifications/{notificationId}",
                                        sharedNotification)
                                .with(member)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"read\":true}"))
                .andExpect(status().isNotFound());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT optimistic_version FROM notifications WHERE id = ?",
                                Long.class,
                                sharedNotification))
                .isZero();
    }

    private void assertSharedReadsSuspended(
            JwtRequestPostProcessor member,
            UUID householdId,
            CreatedCommitment shared,
            PreparedAttempt sharedAttempt,
            UUID sharedNotification)
            throws Exception {
        mockMvc.perform(
                        get("/v1/decisions/inbox")
                                .param("householdId", householdId.toString())
                                .param("from", "2026-08-01")
                                .param("to", "2026-08-31")
                                .with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        shared.id())
                                .param("householdId", householdId.toString())
                                .with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        sharedAttempt.attemptId())
                                .with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/savings")
                                .param("householdId", householdId.toString())
                                .with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/notifications")
                                .param("householdId", householdId.toString())
                                .with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/notifications/{notificationId}", sharedNotification)
                                .with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/notification-diagnostics")
                                .param("householdId", householdId.toString())
                                .with(member))
                .andExpect(status().isNotFound());
    }

    private CreatedHousehold createHousehold(
            JwtRequestPostProcessor owner, String name) throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(owner)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "name": "%s",
                                                  "defaultCurrency": "INR",
                                                  "timezone": "Asia/Kolkata",
                                                  "ageConfirmed": true,
                                                  "privacyNoticeAccepted": true,
                                                  "privacyNoticeVersion": "foundation-v1"
                                                }
                                                """
                                                        .formatted(name)))
                        .andExpect(status().isCreated())
                        .andReturn();
        return new CreatedHousehold(
                UUID.fromString(read(result, "$.id")),
                UUID.fromString(read(result, "$.ownerUserId")));
    }

    private UUID provisionAndGrant(
            JwtRequestPostProcessor member, String keyStem) throws Exception {
        MvcResult me =
                mockMvc.perform(get("/v1/me").with(member))
                        .andExpect(status().isOk())
                        .andReturn();
        UUID userId = UUID.fromString(read(me, "$.id"));
        mockMvc.perform(
                        post("/v1/privacy/notice-acknowledgements")
                                .with(member)
                                .header(
                                        "Idempotency-Key",
                                        keyStem + "-notice")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"noticeVersion\":\"foundation-v1\"}"))
                .andExpect(status().isCreated());
        grantSharing(member, keyStem + "-grant");
        return userId;
    }

    private void grantSharing(
            JwtRequestPostProcessor identity, String idempotencyKey) throws Exception {
        recordConsent(identity, idempotencyKey, "GRANTED");
    }

    private void withdrawSharing(
            JwtRequestPostProcessor identity, String idempotencyKey) throws Exception {
        recordConsent(identity, idempotencyKey, "WITHDRAWN");
    }

    private void recordConsent(
            JwtRequestPostProcessor identity,
            String idempotencyKey,
            String action)
            throws Exception {
        mockMvc.perform(
                        post("/v1/privacy/consents")
                                .with(identity)
                                .header("Idempotency-Key", idempotencyKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "purpose": "HOUSEHOLD_SHARING",
                                          "purposeVersion": "foundation-v1",
                                          "action": "%s"
                                        }
                                        """
                                                .formatted(action)))
                .andExpect(status().isCreated());
    }

    private UUID addMember(UUID householdId, UUID memberUserId) {
        UUID memberId = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'MEMBER', 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                memberId,
                householdId,
                memberUserId,
                clock.instant(),
                clock.instant(),
                clock.instant());
        return memberId;
    }

    private CreatedCommitment createCommitment(
            JwtRequestPostProcessor owner,
            UUID householdId,
            String displayName,
            long amountMinor,
            LocalDate anchorDate)
            throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("householdId", householdId);
        body.put("merchantId", STREAMBOX);
        body.put("displayName", displayName);
        body.put("category", "SUBSCRIPTION");
        body.put("paymentRail", "CARD_RECURRING");
        body.put("amountMinor", amountMinor);
        body.put("estimatedAmountMinor", null);
        body.put("currency", "INR");
        body.put("frequency", "MONTHLY");
        body.put("intervalCount", 1);
        body.put("customIntervalUnit", null);
        body.put("anchorDate", anchorDate);
        body.put("monthDayPolicy", "ANCHOR_DAY");
        body.put("variableAmount", false);
        body.put("maskedPaymentLabel", null);
        MvcResult result =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(owner)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(objectMapper.writeValueAsBytes(body)))
                        .andExpect(status().isCreated())
                        .andReturn();
        return new CreatedCommitment(
                UUID.fromString(read(result, "$.id")),
                result.getResponse().getHeader(HttpHeaders.ETAG));
    }

    private void share(
            JwtRequestPostProcessor owner, CreatedCommitment commitment)
            throws Exception {
        mockMvc.perform(
                        patch(
                                        "/v1/commitments/{commitmentId}/sharing",
                                        commitment.id())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, commitment.etag())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "visibility": "HOUSEHOLD",
                                          "responsibleMemberId": null
                                        }
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.visibility").value("HOUSEHOLD"));
    }

    private PreparedAttempt prepareAttempt(
            JwtRequestPostProcessor owner,
            CreatedCommitment commitment,
            String keyStem)
            throws Exception {
        Occurrence occurrence = firstOccurrence(commitment.id());
        MvcResult decision =
                mockMvc.perform(
                                post(
                                                "/v1/occurrences/{occurrenceId}/decisions",
                                                occurrence.id())
                                        .with(owner)
                                        .header(
                                                "Idempotency-Key",
                                                keyStem + "-decision")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"decision\":\"CANCEL_WITH_PROVIDER\"}"))
                        .andExpect(status().isCreated())
                        .andReturn();
        MvcResult guide =
                mockMvc.perform(
                                get(
                                                "/v1/commitments/{commitmentId}/cancellation-guide",
                                                commitment.id())
                                        .with(owner))
                        .andExpect(status().isOk())
                        .andReturn();
        UUID decisionId = UUID.fromString(read(decision, "$.id"));
        UUID guideId = UUID.fromString(read(guide, "$.id"));
        int guideVersion =
                JsonPath.read(
                        guide.getResponse().getContentAsString(), "$.version");
        Map<String, Object> attemptBody = new LinkedHashMap<>();
        attemptBody.put("occurrenceId", occurrence.id());
        attemptBody.put("decisionId", decisionId);
        attemptBody.put("guideId", guideId);
        attemptBody.put("guideVersion", guideVersion);
        attemptBody.put("note", null);
        MvcResult attempt =
                mockMvc.perform(
                                post(
                                                "/v1/commitments/{commitmentId}/cancellation-attempts",
                                                commitment.id())
                                        .with(owner)
                                        .header(
                                                "Idempotency-Key",
                                                keyStem + "-attempt")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                objectMapper.writeValueAsBytes(
                                                        attemptBody)))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                        .andReturn();
        return new PreparedAttempt(
                occurrence,
                UUID.fromString(read(attempt, "$.id")));
    }

    private Occurrence firstOccurrence(UUID commitmentId) {
        return jdbc.queryForObject(
                """
                SELECT id, scheduled_date
                FROM commitment_occurrences
                WHERE commitment_id = ?
                ORDER BY scheduled_date, id
                FETCH FIRST 1 ROW ONLY
                """,
                (row, ignored) ->
                        new Occurrence(
                                row.getObject("id", UUID.class),
                                row.getObject("scheduled_date", LocalDate.class)),
                commitmentId);
    }

    private UUID insertNotification(
            UUID recipientUserId,
            UUID householdId,
            UUID commitmentId,
            LocalDate scheduledDate,
            String status,
            String failureCategory,
            String semanticKey,
            Instant createdAt) {
        UUID notificationId = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO notifications (
                    id, recipient_user_id, household_id, commitment_id,
                    occurrence_id, reminder_rule_id, scheduled_date, channel,
                    offset_days, planned_for, semantic_key, read_at,
                    optimistic_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 'IN_APP', 7, ?, ?, NULL, 0, ?, ?)
                """,
                notificationId,
                recipientUserId,
                householdId,
                commitmentId,
                scheduledDate,
                createdAt,
                semanticKey,
                createdAt,
                createdAt);
        jdbc.update(
                """
                INSERT INTO notification_deliveries (
                    id, notification_id, status, attempt_count, available_at,
                    lease_token, lease_until, provider_message_id, failure_category,
                    delivered_at, suppressed_at, created_at, updated_at
                ) VALUES (?, ?, ?, 0, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?)
                """,
                UUID.randomUUID(),
                notificationId,
                status,
                createdAt,
                failureCategory,
                "DELIVERED".equals(status) ? createdAt : null,
                createdAt,
                createdAt);
        return notificationId;
    }

    private static void assertPrivateCanaryAbsent(MvcResult result)
            throws Exception {
        assertThat(result.getResponse().getContentAsString())
                .doesNotContain(PRIVATE_CANARY_NAME, "900000", "10800000");
    }

    private static String read(MvcResult result, String path)
            throws Exception {
        return JsonPath.read(result.getResponse().getContentAsString(), path);
    }

    private static JwtRequestPostProcessor identity(
            String subject, String email, String displayName) {
        return jwt()
                .jwt(
                        token ->
                                token.subject(subject)
                                        .claim("email", email)
                                        .claim("name", displayName))
                .authorities(
                        new org.springframework.security.core.authority.SimpleGrantedAuthority(
                                "ROLE_USER"));
    }

    private record CreatedHousehold(UUID id, UUID ownerUserId) {}

    private record CreatedCommitment(UUID id, String etag) {}

    private record Occurrence(UUID id, LocalDate date) {}

    private record PreparedAttempt(Occurrence occurrence, UUID attemptId) {}

    @TestConfiguration(proxyBeanMethods = false)
    static class ClockConfiguration {

        @Bean
        @Primary
        MutableClock memberDerivedReadClock() {
            return new MutableClock(BASE_TIME, ZoneOffset.UTC);
        }
    }

    static final class MutableClock extends Clock {

        private Instant instant;
        private final ZoneId zone;

        MutableClock(Instant instant, ZoneId zone) {
            this.instant = instant;
            this.zone = zone;
        }

        void set(Instant instant) {
            this.instant = instant;
        }

        void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return new MutableClock(instant, zone);
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
