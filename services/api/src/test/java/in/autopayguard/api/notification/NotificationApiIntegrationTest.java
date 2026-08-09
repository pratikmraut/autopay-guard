package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class NotificationApiIntegrationTest {

    private static final UUID STREAMBOX =
            UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final Instant CREATED_AT =
            Instant.parse("2026-07-26T10:00:00Z");

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void notificationActivityIsOwnerScopedVersionedFilteredAndSafe()
            throws Exception {
        JwtRequestPostProcessor alice =
                identity(
                        "m3-notification-alice",
                        "notification-alice@example.test",
                        "Alice");
        JwtRequestPostProcessor bob =
                identity(
                        "m3-notification-bob",
                        "notification-bob@example.test",
                        "Bob");
        CreatedHousehold aliceCreated =
                createHousehold(alice, "Alice reminders");
        UUID aliceHousehold = aliceCreated.id();
        createHousehold(bob, "Bob reminders");
        UUID aliceUser = aliceCreated.ownerUserId();
        UUID commitment = createCommitment(alice, aliceHousehold);
        LocalDate scheduledDate =
                LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(20);

        UUID delivered =
                insertNotification(
                        aliceUser,
                        aliceHousehold,
                        commitment,
                        scheduledDate,
                        NotificationChannel.IN_APP,
                        7,
                        NotificationStatus.DELIVERED,
                        null,
                        "smtp-provider-id-must-not-leak",
                        CREATED_AT);
        UUID retry =
                insertNotification(
                        aliceUser,
                        aliceHousehold,
                        commitment,
                        scheduledDate,
                        NotificationChannel.EMAIL,
                        3,
                        NotificationStatus.RETRY_SCHEDULED,
                        NotificationFailureCategory.PROVIDER_TRANSIENT,
                        null,
                        CREATED_AT.plusSeconds(1));
        UUID dead =
                insertNotification(
                        aliceUser,
                        aliceHousehold,
                        commitment,
                        scheduledDate,
                        NotificationChannel.EMAIL,
                        1,
                        NotificationStatus.DEAD,
                        NotificationFailureCategory.PROVIDER_PERMANENT,
                        null,
                        CREATED_AT.plusSeconds(2));

        MvcResult all =
                mockMvc.perform(
                                get("/v1/notifications")
                                        .param(
                                                "householdId",
                                                aliceHousehold.toString())
                                        .with(alice))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.householdId").value(aliceHousehold.toString()))
                        .andExpect(jsonPath("$.filter").value("ALL"))
                        .andExpect(jsonPath("$.items.length()").value(3))
                        .andExpect(jsonPath("$.nextCursor").value(nullValue()))
                        .andReturn();
        assertThat(all.getResponse().getContentAsString())
                .doesNotContain(
                        "smtp-provider-id-must-not-leak",
                        "notification-alice@example.test",
                        "recipientUserId",
                        "semanticKey",
                        "attemptCount");

        mockMvc.perform(
                        get("/v1/notifications")
                                .param("householdId", aliceHousehold.toString())
                                .param("filter", "UNREAD")
                                .with(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(delivered.toString()));
        mockMvc.perform(
                        get("/v1/notifications")
                                .param("householdId", aliceHousehold.toString())
                                .param("filter", "FAILED")
                                .with(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(dead.toString()))
                .andExpect(jsonPath("$.items[0].failureCategory").value("PROVIDER_PERMANENT"));

        mockMvc.perform(get("/v1/notifications/{id}", retry).with(alice))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                .andExpect(jsonPath("$.status").value("RETRY_SCHEDULED"))
                .andExpect(jsonPath("$.nextAttemptAt").isNotEmpty());
        mockMvc.perform(
                        patch("/v1/notifications/{id}", retry)
                                .with(alice)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"read\":true}"))
                .andExpect(status().isPreconditionRequired());
        mockMvc.perform(
                        patch("/v1/notifications/{id}", retry)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "0")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"read\":true}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        patch("/v1/notifications/{id}", retry)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"read\":true}"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.read").value(true))
                .andExpect(jsonPath("$.version").value(1));
        mockMvc.perform(
                        patch("/v1/notifications/{id}", retry)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"read\":false}"))
                .andExpect(status().isPreconditionFailed());

        MvcResult diagnostics =
                mockMvc.perform(
                                get("/v1/notification-diagnostics")
                                        .param(
                                                "householdId",
                                                aliceHousehold.toString())
                                        .with(alice))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.pendingCount").value(0))
                        .andExpect(jsonPath("$.processingCount").value(0))
                        .andExpect(jsonPath("$.retryScheduledCount").value(1))
                        .andExpect(jsonPath("$.deliveredCount").value(1))
                        .andExpect(jsonPath("$.deadCount").value(1))
                        .andExpect(jsonPath("$.suppressedCount").value(0))
                        .andExpect(
                                jsonPath(
                                        "$.failures[*].category",
                                        containsInAnyOrder(
                                                "PROVIDER_TRANSIENT",
                                                "PROVIDER_PERMANENT")))
                        .andReturn();
        assertThat(diagnostics.getResponse().getContentAsString())
                .doesNotContain(
                        "smtp-provider-id-must-not-leak",
                        "notification-alice@example.test",
                        "semanticKey",
                        "attemptCount");

        mockMvc.perform(
                        get("/v1/notifications")
                                .param("householdId", aliceHousehold.toString())
                                .with(bob))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/v1/notifications/{id}", delivered).with(bob))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        patch("/v1/notifications/{id}", delivered)
                                .with(bob)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"read\":true}"))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/notification-diagnostics")
                                .param("householdId", aliceHousehold.toString())
                                .with(bob))
                .andExpect(status().isNotFound());
    }

    @Test
    void notificationCursorIsBoundToItsHouseholdFilterAndLimit()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m3-notification-cursor",
                        "notification-cursor@example.test",
                        "Cursor");
        CreatedHousehold created =
                createHousehold(owner, "Cursor reminders");
        UUID household = created.id();
        UUID user = created.ownerUserId();
        UUID commitment = createCommitment(owner, household);
        LocalDate date = LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(20);
        insertNotification(
                user,
                household,
                commitment,
                date,
                NotificationChannel.IN_APP,
                7,
                NotificationStatus.DELIVERED,
                null,
                null,
                CREATED_AT);
        insertNotification(
                user,
                household,
                commitment,
                date,
                NotificationChannel.IN_APP,
                3,
                NotificationStatus.DELIVERED,
                null,
                null,
                CREATED_AT.plusSeconds(1));

        MvcResult first =
                mockMvc.perform(
                                get("/v1/notifications")
                                        .param("householdId", household.toString())
                                        .param("limit", "1")
                                        .with(owner))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.nextCursor").isNotEmpty())
                        .andReturn();
        String cursor =
                JsonPath.read(
                        first.getResponse().getContentAsString(), "$.nextCursor");

        mockMvc.perform(
                        get("/v1/notifications")
                                .param("householdId", household.toString())
                                .param("limit", "2")
                                .param("cursor", cursor)
                                .with(owner))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        get("/v1/notifications")
                                .param("householdId", household.toString())
                                .param("limit", "1")
                                .param("filter", "FAILED")
                                .param("cursor", cursor)
                                .with(owner))
                .andExpect(status().isBadRequest());
    }

    private CreatedHousehold createHousehold(
            JwtRequestPostProcessor identity, String name) throws Exception {
        String request =
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
                        .formatted(name);
        MvcResult result =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(identity)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(request))
                        .andExpect(status().isCreated())
                        .andReturn();
        String body = result.getResponse().getContentAsString();
        return new CreatedHousehold(
                UUID.fromString(JsonPath.read(body, "$.id")),
                UUID.fromString(JsonPath.read(body, "$.ownerUserId")));
    }

    private UUID createCommitment(
            JwtRequestPostProcessor identity, UUID householdId) throws Exception {
        LocalDate anchor =
                LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(20);
        String request =
                """
                {
                  "householdId": "%s",
                  "merchantId": "%s",
                  "displayName": "StreamBox notification fixture",
                  "category": "SUBSCRIPTION",
                  "paymentRail": "CARD_RECURRING",
                  "amountMinor": 49900,
                  "estimatedAmountMinor": null,
                  "currency": "INR",
                  "frequency": "MONTHLY",
                  "intervalCount": 1,
                  "customIntervalUnit": null,
                  "anchorDate": "%s",
                  "monthDayPolicy": "ANCHOR_DAY",
                  "variableAmount": false,
                  "maskedPaymentLabel": null
                }
                """
                        .formatted(householdId, STREAMBOX, anchor);
        MvcResult result =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(identity)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(request))
                        .andExpect(status().isCreated())
                        .andReturn();
        return UUID.fromString(
                JsonPath.read(result.getResponse().getContentAsString(), "$.id"));
    }

    private UUID insertNotification(
            UUID recipientUserId,
            UUID householdId,
            UUID commitmentId,
            LocalDate scheduledDate,
            NotificationChannel channel,
            int offsetDays,
            NotificationStatus status,
            NotificationFailureCategory failureCategory,
            String providerMessageId,
            Instant createdAt) {
        UUID notificationId = UUID.randomUUID();
        UUID deliveryId = UUID.randomUUID();
        String semanticKey =
                NotificationSemanticKey.create(
                        recipientUserId,
                        householdId,
                        commitmentId,
                        scheduledDate,
                        channel,
                        offsetDays);
        Instant availableAt = createdAt.plusSeconds(300);
        jdbc.update(
                """
                INSERT INTO notifications (
                    id, recipient_user_id, household_id, commitment_id,
                    occurrence_id, reminder_rule_id, scheduled_date, channel,
                    offset_days, planned_for, semantic_key, read_at,
                    optimistic_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
                """,
                notificationId,
                recipientUserId,
                householdId,
                commitmentId,
                scheduledDate,
                channel.name(),
                offsetDays,
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
                ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
                """,
                deliveryId,
                notificationId,
                status.name(),
                status == NotificationStatus.RETRY_SCHEDULED ? 1 : 0,
                availableAt,
                providerMessageId,
                failureCategory == null ? null : failureCategory.name(),
                status == NotificationStatus.DELIVERED ? createdAt : null,
                status == NotificationStatus.SUPPRESSED ? createdAt : null,
                createdAt,
                createdAt);
        return notificationId;
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
}
