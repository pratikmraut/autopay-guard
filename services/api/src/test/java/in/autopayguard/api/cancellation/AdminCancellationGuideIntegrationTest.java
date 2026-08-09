package in.autopayguard.api.cancellation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AdminCancellationGuideIntegrationTest {

    private static final UUID GUIDE_ONE =
            UUID.fromString("40000000-0000-4000-8000-000000000001");
    private static final UUID GUIDE_TWO =
            UUID.fromString("40000000-0000-4000-8000-000000000002");

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private CancellationGuideVersionRepository versionRepository;

    @Test
    void guideAdministrationIsRoleBoundConditionalIdempotentAndImmutable()
            throws Exception {
        mockMvc.perform(
                        get("/v1/admin/cancellation-guides")
                                .with(user("m5-admin-denied")))
                .andExpect(status().isForbidden());
        mockMvc.perform(
                        get("/v1/admin/cancellation-guides")
                                .with(guideAdmin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(20))
                .andExpect(jsonPath("$.items[0].currentPublishedVersion").value(1));

        MvcResult created =
                mockMvc.perform(
                                post(
                                                "/v1/admin/cancellation-guides/{guideId}/drafts",
                                                GUIDE_ONE)
                                        .with(guideAdmin())
                                        .header(
                                                "Idempotency-Key",
                                                "guide-draft-create-0001"))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                        .andExpect(jsonPath("$.guideVersion").value(2))
                        .andExpect(jsonPath("$.status").value("DRAFT"))
                        .andExpect(jsonPath("$.steps.length()").value(4))
                        .andReturn();
        String draftId =
                JsonPath.read(
                        created.getResponse().getContentAsString(), "$.draftId");

        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guides/{guideId}/drafts",
                                        GUIDE_ONE)
                                .with(guideAdmin())
                                .header(
                                        "Idempotency-Key",
                                        "guide-draft-create-0001"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.draftId").value(draftId));
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guides/{guideId}/drafts",
                                        GUIDE_TWO)
                                .with(guideAdmin())
                                .header(
                                        "Idempotency-Key",
                                        "guide-draft-create-0001"))
                .andExpect(status().isConflict());

        mockMvc.perform(
                        patch(
                                        "/v1/admin/cancellation-guide-drafts/{draftId}",
                                        draftId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(draftUpdateBody(true)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        patch(
                                        "/v1/admin/cancellation-guide-drafts/{draftId}",
                                        draftId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(draftUpdateBody(false)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.riskNotice").value("Updated fictional notice."))
                .andExpect(jsonPath("$.reviewIntervalDays").value(45));
        mockMvc.perform(
                        patch(
                                        "/v1/admin/cancellation-guide-drafts/{draftId}",
                                        draftId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(draftUpdateBody(false)))
                .andExpect(status().isPreconditionFailed());

        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guide-drafts/{draftId}/publish",
                                        draftId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .header(
                                        "Idempotency-Key",
                                        "guide-publish-key-00001"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.publishedVersion").value(2));
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guide-drafts/{draftId}/publish",
                                        draftId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .header(
                                        "Idempotency-Key",
                                        "guide-publish-key-00001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publishedVersion").value(2));

        assertThat(count("cancellation_published_version_locks", 2)).isEqualTo(1);
        assertThat(count("cancellation_published_step_locks", 2)).isEqualTo(4);
        assertThat(count("cancellation_published_target_locks", 2)).isEqualTo(2);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT risk_notice
                                FROM cancellation_guide_versions
                                WHERE guide_id = ? AND version = 1
                                """,
                                String.class,
                                GUIDE_ONE))
                .startsWith("Fictional local guidance only.");

        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        """
                                        UPDATE cancellation_guide_versions
                                        SET risk_notice = 'mutated'
                                        WHERE guide_id = ? AND version = 1
                                        """,
                                        GUIDE_ONE))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void retirementClearsOnlyTheHeadAndOwnerResolutionUsesTheHead()
            throws Exception {
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guides/{guideId}/retire",
                                        GUIDE_ONE)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "guide-retire-key-000001"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.state").value("RETIRED"))
                .andExpect(jsonPath("$.currentPublishedVersion").doesNotExist());
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guides/{guideId}/retire",
                                        GUIDE_ONE)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "guide-retire-key-000001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("RETIRED"));

        assertThat(versionRepository.findCurrentPublished(GUIDE_ONE)).isEmpty();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*)
                                FROM cancellation_guide_versions
                                WHERE guide_id = ? AND version = 1
                                  AND status = 'PUBLISHED'
                                """,
                                Integer.class,
                                GUIDE_ONE))
                .isEqualTo(1);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*)
                                FROM guide_lifecycle_event_locks
                                WHERE guide_id = ? AND action = 'RETIRED'
                                """,
                                Integer.class,
                                GUIDE_ONE))
                .isEqualTo(1);

        MvcResult revivedDraft =
                mockMvc.perform(
                                post(
                                                "/v1/admin/cancellation-guides/{guideId}/drafts",
                                                GUIDE_ONE)
                                        .with(guideAdmin())
                                        .header(
                                                "Idempotency-Key",
                                                "guide-revive-draft-0001"))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                        .andExpect(jsonPath("$.guideVersion").value(2))
                        .andReturn();
        String revivedDraftId =
                JsonPath.read(
                        revivedDraft.getResponse().getContentAsString(),
                        "$.draftId");
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guide-drafts/{draftId}/publish",
                                        revivedDraftId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "guide-revive-publish-001"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                .andExpect(jsonPath("$.catalogState").value("ACTIVE"))
                .andExpect(jsonPath("$.publishedVersion").value(2));
        assertThat(versionRepository.findCurrentPublished(GUIDE_ONE))
                .get()
                .extracting(CancellationGuideVersionEntity::version)
                .isEqualTo(2);
    }

    @Test
    void feedbackAndAuditViewsAreRedactedAndSeparatelyAuthorized()
            throws Exception {
        JwtRequestPostProcessor owner = user("m5-feedback-owner");
        mockMvc.perform(get("/v1/me").with(owner)).andExpect(status().isOk());
        UUID ownerId =
                jdbcTemplate.queryForObject(
                        "SELECT id FROM users WHERE oidc_subject = ?",
                        UUID.class,
                        "m5-feedback-owner");
        UUID householdId = UUID.randomUUID();
        UUID commitmentId = UUID.randomUUID();
        UUID feedbackId = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency,
                    timezone, created_at, updated_at
                ) VALUES (?, 'Feedback private household', ?, 'INR',
                          'Asia/Kolkata', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                householdId,
                ownerId);
        jdbcTemplate.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'OWNER', 'ACTIVE', 0,
                          CURRENT_TIMESTAMP, NULL,
                          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                householdId,
                householdId,
                ownerId);
        insertCommitment(commitmentId, householdId, ownerId);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_feedback (
                    id, owner_user_id, household_id, commitment_id,
                    guide_id, guide_version, outcome, note, created_at
                ) VALUES (?, ?, ?, ?, ?, 1, 'OUTDATED',
                          'PRIVATE_NOTE_CANARY', CURRENT_TIMESTAMP)
                """,
                feedbackId,
                ownerId,
                householdId,
                commitmentId,
                GUIDE_ONE);

        mockMvc.perform(
                        get("/v1/admin/cancellation-guide-feedback")
                                .with(owner))
                .andExpect(status().isForbidden());
        MvcResult listed =
                mockMvc.perform(
                                get("/v1/admin/cancellation-guide-feedback")
                                        .with(guideAdmin()))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items[0].id").value(feedbackId.toString()))
                        .andExpect(jsonPath("$.items[0].disposition").value("PENDING"))
                        .andExpect(jsonPath("$.items[0].version").value(0))
                        .andReturn();
        assertThat(listed.getResponse().getContentAsString())
                .doesNotContain(
                        "PRIVATE_NOTE_CANARY",
                        ownerId.toString(),
                        householdId.toString(),
                        commitmentId.toString(),
                        "note",
                        "ownerUserId");

        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guide-feedback/{id}/review",
                                        feedbackId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "feedback-review-key-0001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"disposition":"RESOLVED"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.disposition").value("RESOLVED"))
                .andExpect(jsonPath("$.note").doesNotExist());
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guide-feedback/{id}/review",
                                        feedbackId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "feedback-review-key-0001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"disposition":"RESOLVED"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guide-feedback/{id}/review",
                                        feedbackId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "feedback-review-stale-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"disposition":"DISMISSED"}
                                        """))
                .andExpect(status().isPreconditionFailed());
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guide-feedback/{id}/review",
                                        feedbackId)
                                .with(guideAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .header(
                                        "Idempotency-Key",
                                        "feedback-review-key-0002")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"disposition":"DISMISSED"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                .andExpect(jsonPath("$.disposition").value("DISMISSED"));

        mockMvc.perform(get("/v1/admin/audit-events").with(guideAdmin()))
                .andExpect(status().isForbidden());
        MvcResult audited =
                mockMvc.perform(
                                get("/v1/admin/audit-events?limit=1")
                                        .with(auditReader()))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items[0].id").exists())
                        .andExpect(jsonPath("$.nextCursor").exists())
                        .andReturn();
        String nextCursor =
                JsonPath.read(
                        audited.getResponse().getContentAsString(),
                        "$.nextCursor");
        mockMvc.perform(
                        get("/v1/admin/audit-events?limit=1&cursor={cursor}",
                                        nextCursor)
                                .with(auditReader()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").exists());
        assertThat(audited.getResponse().getContentAsString())
                .doesNotContain(
                        "PRIVATE_NOTE_CANARY",
                        "m5-guide-admin@example.test",
                        "actorUserId",
                        "createdAt");
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*)
                                FROM audit_events
                                WHERE action = 'AUDIT_EVENTS_VIEWED'
                                  AND resource_type = 'AUDIT_QUERY'
                                """,
                                Integer.class))
                .isEqualTo(2);
    }

    private int count(String table, int guideVersion) {
        return jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM "
                        + table
                        + " WHERE guide_id = ? AND "
                        + ("cancellation_published_version_locks".equals(table)
                                ? "version"
                                : "guide_version")
                        + " = ?",
                Integer.class,
                GUIDE_ONE,
                guideVersion);
    }

    private void insertCommitment(
            UUID commitmentId, UUID householdId, UUID ownerId) {
        jdbcTemplate.update(
                """
                INSERT INTO recurring_commitments (
                    id, household_id, data_owner_user_id,
                    responsible_member_id, merchant_id, display_name,
                    category, payment_rail, amount_minor,
                    estimated_amount_minor, currency, frequency,
                    interval_count, custom_interval_unit, anchor_date,
                    month_day_policy, next_due_date, variable_amount,
                    masked_payment_label, source, source_confidence,
                    visibility, status, optimistic_version,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, ?, NULL, '10000000-0000-4000-8000-000000000001',
                    'Private commitment canary', 'SUBSCRIPTION', 'UNKNOWN',
                    500, NULL, 'INR', 'MONTHLY', 1, NULL, ?,
                    'ANCHOR_DAY', ?, FALSE, NULL, 'MANUAL', NULL,
                    'PRIVATE', 'ACTIVE', 0,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                commitmentId,
                householdId,
                ownerId,
                LocalDate.of(2026, 8, 5),
                LocalDate.of(2026, 8, 5));
    }

    private static String draftUpdateBody(boolean addForbiddenField) {
        String forbidden =
                addForbiddenField
                        ? ",\"actionType\":\"INFORMATION\""
                        : "";
        return """
                {
                  "riskNotice": "Updated fictional notice.",
                  "reviewIntervalDays": 45,
                  "steps": [
                    {
                      "track": "SERVICE",
                      "sequenceNumber": 1,
                      "title": "Service review",
                      "instruction": "Review the fictional service."
                      %s
                    },
                    {
                      "track": "SERVICE",
                      "sequenceNumber": 2,
                      "title": "Service action",
                      "instruction": "Open the reserved local service target."
                    },
                    {
                      "track": "PAYMENT_MANDATE",
                      "sequenceNumber": 1,
                      "title": "Mandate review",
                      "instruction": "Review the fictional mandate separately."
                    },
                    {
                      "track": "PAYMENT_MANDATE",
                      "sequenceNumber": 2,
                      "title": "Mandate action",
                      "instruction": "Open the local demo mandate target."
                    }
                  ]
                }
                """
                .formatted(forbidden);
    }

    private static JwtRequestPostProcessor user(String subject) {
        return jwt()
                .jwt(
                        token ->
                                token.subject(subject)
                                        .claim("email", subject + "@example.test")
                                        .claim("name", "M5 Test User"))
                .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static JwtRequestPostProcessor guideAdmin() {
        return jwt()
                .jwt(
                        token ->
                                token.subject("m5-guide-admin")
                                        .claim(
                                                "email",
                                                "m5-guide-admin@example.test")
                                        .claim("name", "Guide Admin"))
                .authorities(
                        new SimpleGrantedAuthority("ROLE_GUIDE_ADMIN"));
    }

    private static JwtRequestPostProcessor auditReader() {
        return jwt()
                .jwt(
                        token ->
                                token.subject("m5-audit-reader")
                                        .claim(
                                                "email",
                                                "m5-audit-reader@example.test")
                                        .claim("name", "Audit Reader"))
                .authorities(
                        new SimpleGrantedAuthority("ROLE_AUDIT_READ"));
    }
}
