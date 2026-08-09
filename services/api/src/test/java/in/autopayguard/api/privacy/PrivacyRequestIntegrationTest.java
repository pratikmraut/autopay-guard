package in.autopayguard.api.privacy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class PrivacyRequestIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private PrivacyRequestService privacyRequestService;

    @Test
    void privacyAdminQueueReadIsRedactedAndAudited()
            throws Exception {
        mockMvc.perform(get("/v1/admin/privacy/requests").with(privacyAdmin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray());

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*)
                                FROM audit_events
                                WHERE actor_role = 'PRIVACY_ADMIN'
                                  AND action = 'PRIVACY_REQUESTS_VIEWED'
                                  AND resource_type = 'AUDIT_QUERY'
                                  AND outcome = 'SUCCEEDED'
                                """,
                                Integer.class))
                .isEqualTo(1);
    }

    @Test
    void privacyRequestRateLimitCountsNewClaimsButNotExactReplay()
            throws Exception {
        JwtRequestPostProcessor requester =
                identity(
                        "m5-rate-limit-subject",
                        "m5-rate-limit-subject@example.test",
                        "Rate Limit Subject");
        createHousehold(requester, "Rate limit household");

        for (int index = 0; index < 5; index++) {
            createRequest(
                    requester,
                    "privacy-rate-request-" + index,
                    "CORRECTION",
                    "UTC");
        }

        mockMvc.perform(
                        post("/v1/privacy/requests")
                                .with(requester)
                                .header(
                                        "Idempotency-Key",
                                        "privacy-rate-request-0")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "requestType": "CORRECTION",
                                          "correctionValue": "UTC"
                                        }
                                        """))
                .andExpect(status().isCreated());

        String actorKey =
                OperationRateLimiter.actorKeyForSubject(
                        "m5-rate-limit-subject");
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM operation_rate_events
                                WHERE actor_key = ?
                                  AND operation = 'PRIVACY_REQUEST'
                                """,
                                Integer.class,
                                actorKey))
                .isEqualTo(5);

        mockMvc.perform(
                        post("/v1/privacy/requests")
                                .with(requester)
                                .header(
                                        "Idempotency-Key",
                                        "privacy-rate-request-5")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "requestType": "CORRECTION",
                                          "correctionValue": "UTC"
                                        }
                                        """))
                .andExpect(status().isTooManyRequests());
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM operation_rate_events
                                WHERE actor_key = ?
                                  AND operation = 'PRIVACY_REQUEST'
                                """,
                                Integer.class,
                                actorKey))
                .isEqualTo(5);
    }

    @Test
    void exportRetentionIsBoundedAndPurgeIsPhysicalAndIdempotent()
            throws Exception {
        JwtRequestPostProcessor requester =
                identity(
                        "m5-export-purge-subject",
                        "m5-export-purge-subject@example.test",
                        "Export Purge Subject");
        createHousehold(requester, "Export purge household");
        MvcResult created =
                createRequest(
                        requester,
                        "privacy-export-purge-01",
                        "EXPORT",
                        null);
        UUID requestId =
                UUID.fromString(
                        JsonPath.read(
                                created.getResponse().getContentAsString(),
                                "$.id"));
        Map<String, Object> initial =
                jdbcTemplate.queryForMap(
                        """
                        SELECT payload
                        FROM privacy_export_artifacts
                        WHERE request_id = ?
                        """,
                        requestId);
        Instant generatedAt =
                jdbcTemplate.queryForObject(
                        """
                        SELECT generated_at
                        FROM privacy_export_artifacts
                        WHERE request_id = ?
                        """,
                        (resultSet, rowNumber) ->
                                resultSet.getTimestamp("generated_at").toInstant(),
                        requestId);
        Instant expiresAt =
                jdbcTemplate.queryForObject(
                        """
                        SELECT expires_at
                        FROM privacy_export_artifacts
                        WHERE request_id = ?
                        """,
                        (resultSet, rowNumber) ->
                                resultSet.getTimestamp("expires_at").toInstant(),
                        requestId);
        assertThat(Duration.between(generatedAt, expiresAt))
                .isEqualTo(PrivacyRequestService.EXPORT_RETENTION)
                .isLessThan(Duration.ofHours(24));
        assertThat(initial.get("payload")).isNotNull();

        Instant backdatedGeneratedAt =
                Instant.now().minus(24, java.time.temporal.ChronoUnit.HOURS);
        Instant backdatedExpiresAt =
                backdatedGeneratedAt.plus(
                        PrivacyRequestService.EXPORT_RETENTION);
        jdbcTemplate.update(
                """
                UPDATE privacy_export_artifacts
                SET generated_at = ?, expires_at = ?
                WHERE request_id = ?
                """,
                backdatedGeneratedAt,
                backdatedExpiresAt,
                requestId);

        privacyRequestService.purgeExpiredExports();

        Map<String, Object> purged =
                jdbcTemplate.queryForMap(
                        """
                        SELECT payload, purged_at
                        FROM privacy_export_artifacts
                        WHERE request_id = ?
                        """,
                        requestId);
        assertThat(purged.get("payload")).isNull();
        assertThat(purged.get("purged_at")).isNotNull();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT status FROM privacy_requests WHERE id = ?",
                                String.class,
                                requestId))
                .isEqualTo("EXPIRED");
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'PRIVACY_EXPORT_EXPIRED'
                                """,
                                Integer.class,
                                requestId))
                .isEqualTo(1);

        privacyRequestService.purgeExpiredExports();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'PRIVACY_EXPORT_EXPIRED'
                                """,
                                Integer.class,
                                requestId))
                .isEqualTo(1);
        mockMvc.perform(
                        get("/v1/privacy/requests/{id}", requestId)
                                .with(requester))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("EXPIRED"))
                .andExpect(
                        jsonPath("$.export")
                                .value(org.hamcrest.Matchers.nullValue()));
        mockMvc.perform(get("/v1/privacy/requests").with(requester))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(requestId.toString()))
                .andExpect(jsonPath("$.items[0].status").value("EXPIRED"))
                .andExpect(
                        jsonPath("$.items[0].export")
                                .value(org.hamcrest.Matchers.nullValue()));
        mockMvc.perform(
                        get("/v1/privacy/requests/{id}/export", requestId)
                                .with(requester))
                .andExpect(status().isGone());
    }

    @Test
    void exportIsCanonicalCompleteSubjectOnlyAndExcludesForeignPrivateData()
            throws Exception {
        JwtRequestPostProcessor requester =
                identity(
                        "m5-export-subject",
                        "m5-export-subject@example.test",
                        "Export Subject");
        JwtRequestPostProcessor foreign =
                identity(
                        "m5-export-foreign",
                        "m5-export-foreign@example.test",
                        "Foreign Subject");
        UUID requesterHousehold =
                createHousehold(requester, "Export household");
        UUID foreignHousehold = createHousehold(foreign, "Foreign household");
        UUID foreignUserId = userId("m5-export-foreign@example.test");
        insertPrivateCanary(foreignHousehold, foreignUserId);
        UUID requesterUserId = userId("m5-export-subject@example.test");
        UUID importId = UUID.randomUUID();
        UUID validImportItemId = UUID.randomUUID();
        UUID invalidImportItemId = UUID.randomUUID();
        Instant importCreatedAt = Instant.now();
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_jobs (
                    id, household_id, owner_user_id, status, raw_payload,
                    raw_byte_count, content_fingerprint, preview_expires_at,
                    raw_processed_at,
                    total_item_count, valid_item_count, invalid_item_count,
                    duplicate_item_count, selected_item_count,
                    created_commitment_count, optimistic_version, confirmed_at,
                    discarded_at, expired_at, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 'PREVIEW_READY', NULL, 17, ?, ?, ?,
                    2, 1, 1, 0, 0, 0, 0, NULL, NULL, NULL, ?, ?
                )
                """,
                importId,
                requesterHousehold,
                requesterUserId,
                "d".repeat(64),
                importCreatedAt.plus(Duration.ofHours(1)),
                importCreatedAt,
                importCreatedAt,
                importCreatedAt);
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_items (
                    id, import_job_id, row_number, valid, duplicate_kind,
                    schedule_fingerprint, name, category, amount_minor,
                    currency, frequency, next_due_date, month_day_policy,
                    payment_rail, masked_payment_label, merchant_id, selected,
                    created_commitment_id, created_at, updated_at
                ) VALUES (
                    ?, ?, 2, TRUE, 'NONE', ?, 'SAFE_NORMALIZED_IMPORT',
                    'OTHER', 1000, 'INR', 'MONTHLY', '2026-08-01',
                    'ANCHOR_DAY', 'UNKNOWN', NULL, NULL, NULL, NULL, ?, ?
                )
                """,
                validImportItemId,
                importId,
                "e".repeat(64),
                importCreatedAt,
                importCreatedAt);
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_items (
                    id, import_job_id, row_number, valid, duplicate_kind,
                    schedule_fingerprint, name, category, amount_minor,
                    currency, frequency, next_due_date, month_day_policy,
                    payment_rail, masked_payment_label, merchant_id, selected,
                    created_commitment_id, created_at, updated_at
                ) VALUES (
                    ?, ?, 3, FALSE, NULL, NULL, NULL, NULL, NULL, NULL,
                    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?
                )
                """,
                invalidImportItemId,
                importId,
                importCreatedAt,
                importCreatedAt);
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_item_errors (
                    import_item_id, sequence_number, error_code
                ) VALUES (?, 1, 'NAME_INVALID')
                """,
                invalidImportItemId);
        grantSharing(requester, "export-subject-consent");
        grantSharing(foreign, "export-foreign-consent");
        jdbcTemplate.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'MEMBER', 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                UUID.randomUUID(),
                foreignHousehold,
                requesterUserId,
                Instant.now(),
                Instant.now(),
                Instant.now());
        UUID sharedCommitmentId =
                insertCommitment(
                        foreignHousehold,
                        foreignUserId,
                        "SHARED_COMMITMENT_CANARY",
                        "HOUSEHOLD");
        insertReminderCanary(foreignHousehold, sharedCommitmentId);
        UUID receivedInvitationId = UUID.randomUUID();
        UUID affectedAuditId = UUID.randomUUID();
        Instant invitationCreatedAt = Instant.now();
        jdbcTemplate.update(
                """
                INSERT INTO household_invitations (
                    id, household_id, invitee_email, role, token_hash,
                    pending_key, status, accepted_by_user_id,
                    optimistic_version, expires_at, accepted_at,
                    revoked_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'MEMBER', ?, ?, 'PENDING', NULL, 0,
                          ?, NULL, NULL, ?, ?)
                """,
                receivedInvitationId,
                foreignHousehold,
                "m5-export-subject@example.test",
                "b".repeat(64),
                foreignHousehold + "|m5-export-subject@example.test",
                invitationCreatedAt.plusSeconds(86_400),
                invitationCreatedAt,
                invitationCreatedAt);
        Object[] auditValues = {
            affectedAuditId,
            foreignUserId,
            "USER",
            "HOUSEHOLD_INVITATION_CREATED",
            "HOUSEHOLD_INVITATION",
            receivedInvitationId,
            "SUCCEEDED",
            "m5-export-affected-audit",
            invitationCreatedAt,
            invitationCreatedAt
        };
        jdbcTemplate.update(
                """
                INSERT INTO audit_events (
                    id, actor_user_id, actor_role, action, resource_type,
                    resource_id, outcome, correlation_id, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                auditValues);
        jdbcTemplate.update(
                """
                INSERT INTO audit_event_locks (
                    id, actor_user_id, actor_role, action, resource_type,
                    resource_id, outcome, correlation_id, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                auditValues);

        MvcResult created =
                mockMvc.perform(
                                post("/v1/privacy/requests")
                                        .with(requester)
                                        .header(
                                                "Idempotency-Key",
                                                "privacy-export-key-0001")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "requestType": "EXPORT"
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                        .andExpect(jsonPath("$.status").value("READY"))
                        .andExpect(
                                jsonPath("$.export.schemaVersion")
                                        .value("autopay-guard-export-v2"))
                        .andReturn();
        String requestId =
                JsonPath.read(
                        created.getResponse().getContentAsString(), "$.id");
        String expectedDigest =
                JsonPath.read(
                        created.getResponse().getContentAsString(),
                        "$.export.sha256");

        MvcResult downloaded =
                mockMvc.perform(
                                get("/v1/privacy/requests/{id}/export", requestId)
                                        .with(requester))
                        .andExpect(status().isOk())
                        .andExpect(
                                header()
                                        .string(
                                                HttpHeaders.CONTENT_DISPOSITION,
                                                "attachment; filename=\"autopay-guard-export-v2.json\""))
                        .andExpect(
                                header()
                                        .string(
                                                "X-Content-SHA256",
                                                expectedDigest))
                        .andReturn();
        byte[] payload = downloaded.getResponse().getContentAsByteArray();
        assertThat(sha256(payload)).isEqualTo(expectedDigest);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'PRIVACY_EXPORT_DOWNLOADED'
                                  AND outcome = 'SUCCEEDED'
                                """,
                                Integer.class,
                                UUID.fromString(requestId)))
                .isEqualTo(1);
        assertThat(new String(payload, StandardCharsets.UTF_8))
                .doesNotContain("FOREIGN_PRIVATE_CANARY")
                .doesNotContain("token_hash")
                .doesNotContain("code_hash")
                .doesNotContain("idempotency")
                .doesNotContain("RAW_IMPORT_CANARY")
                .doesNotContain("contentFingerprint")
                .doesNotContain("scheduleFingerprint");

        JsonNode manifest = objectMapper.readTree(payload);
        assertThat(manifest.get("schemaVersion").asString())
                .isEqualTo("autopay-guard-export-v2");
        assertThat(manifest.propertyNames())
                .containsExactly(
                        "auditEvents",
                        "cancellationData",
                        "consentEvents",
                        "generatedAt",
                        "households",
                        "importJobs",
                        "memberships",
                        "noticeAcknowledgements",
                        "notificationData",
                        "privacyRequests",
                        "schemaVersion",
                        "subject",
                        "supportGrants");
        JsonNode exportedImport = manifest.get("importJobs").get(0);
        assertThat(exportedImport.get("id").asString())
                .isEqualTo(importId.toString());
        assertThat(exportedImport.get("items").get(0).get("name").asString())
                .isEqualTo("SAFE_NORMALIZED_IMPORT");
        assertThat(exportedImport.get("items").get(1).has("name")).isFalse();
        assertThat(
                        exportedImport
                                .get("items")
                                .get(1)
                                .get("errorCodes")
                                .get(0)
                                .asString())
                .isEqualTo("NAME_INVALID");
        assertThat(manifest.get("subject").get("email").asString())
                .isEqualTo("m5-export-subject@example.test");
        assertThat(
                        manifest.get("subject")
                                .get("invitations")
                                .findValues("id")
                                .stream()
                                .map(JsonNode::asString)
                                .toList())
                .contains(receivedInvitationId.toString());
        assertThat(
                        manifest.get("auditEvents").findValues("id").stream()
                                .map(JsonNode::asString)
                                .toList())
                .contains(affectedAuditId.toString());
        JsonNode sharedCommitment =
                manifest.get("households").findValues("commitments").stream()
                        .flatMap(node -> java.util.stream.StreamSupport.stream(
                                node.spliterator(), false))
                        .filter(
                                node ->
                                        "SHARED_COMMITMENT_CANARY"
                                                .equals(
                                                        node.get("displayName")
                                                                .asString()))
                        .findFirst()
                        .orElseThrow();
        assertThat(sharedCommitment.get("reminderRuleSets").isEmpty())
                .isTrue();
        String stored =
                jdbcTemplate.queryForObject(
                        "SELECT payload FROM privacy_export_artifacts WHERE request_id = ?",
                        String.class,
                        UUID.fromString(requestId));
        assertThat(stored.getBytes(StandardCharsets.UTF_8)).isEqualTo(payload);

        mockMvc.perform(
                        get("/v1/privacy/requests/{id}/export", requestId)
                                .with(foreign))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/privacy/requests/{id}/export", requestId)
                                .with(privacyAdmin()))
                .andExpect(status().isForbidden());
    }

    @Test
    void creationAndExecutionAreIdempotentAndCorrectionIsTimezoneOnly()
            throws Exception {
        JwtRequestPostProcessor requester =
                identity(
                        "m5-correction-subject",
                        "m5-correction-subject@example.test",
                        "Correction Subject");
        mockMvc.perform(get("/v1/me").with(requester)).andExpect(status().isOk());

        String body =
                """
                {
                  "requestType": "CORRECTION",
                  "correctionValue": "Europe/Paris"
                }
                """;
        MvcResult created =
                mockMvc.perform(
                                post("/v1/privacy/requests")
                                        .with(requester)
                                        .header(
                                                "Idempotency-Key",
                                                "privacy-correction-key-01")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                        .andExpect(jsonPath("$.status").value("REQUESTED"))
                        .andReturn();
        String requestId =
                JsonPath.read(
                        created.getResponse().getContentAsString(), "$.id");

        mockMvc.perform(
                        post("/v1/privacy/requests")
                                .with(requester)
                                .header(
                                        "Idempotency-Key",
                                        "privacy-correction-key-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(requestId));
        mockMvc.perform(
                        post("/v1/privacy/requests")
                                .with(requester)
                                .header(
                                        "Idempotency-Key",
                                        "privacy-correction-key-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "requestType": "CORRECTION",
                                          "correctionValue": "Asia/Tokyo"
                                        }
                                        """))
                .andExpect(status().isConflict());

        mockMvc.perform(
                        post("/v1/admin/privacy/requests/{id}/execute", requestId)
                                .with(requester)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-execute-key-0001"))
                .andExpect(status().isForbidden());

        mockMvc.perform(
                        post("/v1/admin/privacy/requests/{id}/execute", requestId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-execute-key-0001"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                .andExpect(jsonPath("$.status").value("EXECUTED"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT timezone FROM users WHERE email = ?",
                                String.class,
                                "m5-correction-subject@example.test"))
                .isEqualTo("Europe/Paris");

        mockMvc.perform(
                        post("/v1/admin/privacy/requests/{id}/execute", requestId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-execute-key-0001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("EXECUTED"));

        mockMvc.perform(
                        post("/v1/privacy/requests")
                                .with(requester)
                                .header(
                                        "Idempotency-Key",
                                        "privacy-invalid-zone-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "requestType": "CORRECTION",
                                          "correctionValue": "+05:30"
                                        }
                                        """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void correctionExecutionRevalidatesTheFakeLocalSubjectBoundary()
            throws Exception {
        JwtRequestPostProcessor requester =
                identity(
                        "m5-non-fake-correction-subject",
                        "correction-person@example.com",
                        "Non Fake Correction Subject");
        mockMvc.perform(get("/v1/me").with(requester)).andExpect(status().isOk());
        String originalTimezone =
                jdbcTemplate.queryForObject(
                        "SELECT timezone FROM users WHERE email = ?",
                        String.class,
                        "correction-person@example.com");

        MvcResult created =
                createRequest(
                        requester,
                        "privacy-non-fake-correction",
                        "CORRECTION",
                        "Europe/Paris");
        String requestId =
                JsonPath.read(
                        created.getResponse().getContentAsString(), "$.id");

        mockMvc.perform(
                        post("/v1/admin/privacy/requests/{id}/execute", requestId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-non-fake-correct"))
                .andExpect(status().isConflict());

        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT timezone FROM users WHERE email = ?",
                                String.class,
                                "correction-person@example.com"))
                .isEqualTo(originalTimezone);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT status FROM privacy_requests WHERE id = ?",
                                String.class,
                                UUID.fromString(requestId)))
                .isEqualTo("REQUESTED");
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*)
                                FROM audit_events
                                WHERE action = 'PRIVACY_CORRECTION_EXECUTED'
                                  AND resource_id = ?
                                """,
                                Integer.class,
                                UUID.fromString(requestId)))
                .isZero();
    }

    @Test
    void cancellationRequiresOwnershipFreshEtagAndPreprocessingState()
            throws Exception {
        JwtRequestPostProcessor requester =
                identity(
                        "m5-cancel-subject",
                        "m5-cancel-subject@example.test",
                        "Cancel Subject");
        JwtRequestPostProcessor foreign =
                identity(
                        "m5-cancel-foreign",
                        "m5-cancel-foreign@example.test",
                        "Cancel Foreign");
        mockMvc.perform(get("/v1/me").with(requester)).andExpect(status().isOk());
        mockMvc.perform(get("/v1/me").with(foreign)).andExpect(status().isOk());
        MvcResult created =
                createRequest(
                        requester,
                        "privacy-delete-cancel-01",
                        "DELETION",
                        null);
        String requestId =
                JsonPath.read(
                        created.getResponse().getContentAsString(), "$.id");

        mockMvc.perform(
                        post("/v1/privacy/requests/{id}/cancel", requestId)
                                .with(foreign)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-foreign-cancel-1"))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        post("/v1/privacy/requests/{id}/cancel", requestId)
                                .with(requester)
                                .header(HttpHeaders.IF_MATCH, "\"7\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-stale-cancel-01"))
                .andExpect(status().isPreconditionFailed());
        mockMvc.perform(
                        post("/v1/privacy/requests/{id}/cancel", requestId)
                                .with(requester)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-good-cancel-001"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    @Test
    void deletionBlocksCanonicalAndMultiMemberSubjectsBeforeErasure()
            throws Exception {
        JwtRequestPostProcessor canonical =
                identity(
                        "m5-canonical-demo-subject",
                        "demo@autopayguard.local",
                        "Demo User");
        createHousehold(canonical, "Canonical household");
        MvcResult canonicalRequest =
                createRequest(
                        canonical,
                        "privacy-canonical-delete",
                        "DELETION",
                        null);
        String canonicalId =
                JsonPath.read(
                        canonicalRequest.getResponse().getContentAsString(),
                        "$.id");
        mockMvc.perform(
                        post(
                                        "/v1/admin/privacy/requests/{id}/execute",
                                        canonicalId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-canonical-exec-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("BLOCKED"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT deleted_at IS NULL FROM users WHERE email = ?",
                                Boolean.class,
                                "demo@autopayguard.local"))
                .isTrue();

        JwtRequestPostProcessor owner =
                identity(
                        "m5-shared-owner",
                        "m5-shared-owner@example.test",
                        "Shared Owner");
        JwtRequestPostProcessor member =
                identity(
                        "m5-shared-member",
                        "m5-shared-member@example.test",
                        "Shared Member");
        UUID householdId = createHousehold(owner, "Shared household");
        mockMvc.perform(get("/v1/me").with(member)).andExpect(status().isOk());
        UUID memberUserId = userId("m5-shared-member@example.test");
        jdbcTemplate.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'MEMBER', 'ACTIVE', 0,
                          CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                UUID.randomUUID(),
                householdId,
                memberUserId);
        MvcResult sharedRequest =
                createRequest(
                        owner,
                        "privacy-shared-delete-01",
                        "DELETION",
                        null);
        String sharedId =
                JsonPath.read(
                        sharedRequest.getResponse().getContentAsString(), "$.id");
        mockMvc.perform(
                        post("/v1/admin/privacy/requests/{id}/execute", sharedId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-shared-exec-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("BLOCKED"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM households WHERE id = ?",
                                Integer.class,
                                householdId))
                .isEqualTo(1);

        JwtRequestPostProcessor nonFake =
                identity(
                        "m5-non-fake-delete-subject",
                        "person@example.com",
                        "Non Fake Subject");
        mockMvc.perform(get("/v1/me").with(nonFake)).andExpect(status().isOk());
        MvcResult nonFakeRequest =
                createRequest(
                        nonFake,
                        "privacy-non-fake-delete",
                        "DELETION",
                        null);
        String nonFakeId =
                JsonPath.read(
                        nonFakeRequest.getResponse().getContentAsString(),
                        "$.id");
        mockMvc.perform(
                        post("/v1/admin/privacy/requests/{id}/execute", nonFakeId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-non-fake-exec"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("BLOCKED"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM users WHERE email = ?",
                                Integer.class,
                                "person@example.com"))
                .isEqualTo(1);
    }

    @Test
    void retainedV1ArtifactStillDownloadsWithItsVersionedFilename()
            throws Exception {
        JwtRequestPostProcessor requester =
                identity(
                        "m6-retained-v1-export-" + UUID.randomUUID(),
                        "m6-retained-v1-export-" + UUID.randomUUID()
                                + "@example.test",
                        "Retained V1 Export Subject");
        createHousehold(requester, "Retained V1 export household");
        MvcResult created =
                createRequest(
                        requester,
                        "privacy-retained-v1-export-01",
                        "EXPORT",
                        null);
        UUID requestId =
                UUID.fromString(
                        JsonPath.read(
                                created.getResponse().getContentAsString(),
                                "$.id"));
        String retainedPayload =
                "{\"fixture\":\"retained-v1\",\"schemaVersion\":\"autopay-guard-export-v1\"}";
        byte[] retainedBytes =
                retainedPayload.getBytes(StandardCharsets.UTF_8);
        String retainedDigest = sha256(retainedBytes);
        assertThat(
                        jdbcTemplate.update(
                                """
                                UPDATE privacy_export_artifacts
                                SET schema_version = 'autopay-guard-export-v1',
                                    payload = ?, payload_sha256 = ?,
                                    byte_count = ?
                                WHERE request_id = ?
                                """,
                                retainedPayload,
                                retainedDigest,
                                retainedBytes.length,
                                requestId))
                .isEqualTo(1);

        MvcResult downloaded =
                mockMvc.perform(
                                get(
                                                "/v1/privacy/requests/{id}/export",
                                                requestId)
                                        .with(requester))
                        .andExpect(status().isOk())
                        .andExpect(
                                header()
                                        .string(
                                                HttpHeaders.CONTENT_DISPOSITION,
                                                "attachment; filename=\"autopay-guard-export-v1.json\""))
                        .andExpect(
                                header()
                                        .string(
                                                HttpHeaders.CACHE_CONTROL,
                                                "no-store"))
                        .andExpect(
                                header()
                                        .string(
                                                "X-Content-SHA256",
                                                retainedDigest))
                        .andReturn();
        assertThat(downloaded.getResponse().getContentAsByteArray())
                .isEqualTo(retainedBytes);
    }

    @Test
    void eligibleDeletionErasesSubjectDataLeavesMinimalTombstoneAndPreventsReprovision()
            throws Exception {
        JwtRequestPostProcessor requester =
                identity(
                        "m5-disposable-delete-subject",
                        "m5-disposable-delete@example.test",
                        "Disposable Subject");
        UUID householdId = createHousehold(requester, "Disposable household");
        UUID userId = userId("m5-disposable-delete@example.test");
        UUID importId = UUID.randomUUID();
        UUID importItemId = UUID.randomUUID();
        Instant importNow = Instant.now();
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_jobs (
                    id, household_id, owner_user_id, status, raw_payload,
                    raw_byte_count, content_fingerprint, preview_expires_at,
                    raw_processed_at,
                    total_item_count, valid_item_count, invalid_item_count,
                    duplicate_item_count, selected_item_count,
                    created_commitment_count, optimistic_version, confirmed_at,
                    discarded_at, expired_at, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 'PREVIEW_READY', NULL, 1, ?, ?, ?,
                    1, 0, 1, 0, 0, 0, 0, NULL, NULL, NULL, ?, ?
                )
                """,
                importId,
                householdId,
                userId,
                "f".repeat(64),
                importNow.plus(Duration.ofHours(1)),
                importNow,
                importNow,
                importNow);
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_items (
                    id, import_job_id, row_number, valid, duplicate_kind,
                    schedule_fingerprint, name, category, amount_minor,
                    currency, frequency, next_due_date, month_day_policy,
                    payment_rail, masked_payment_label, merchant_id, selected,
                    created_commitment_id, created_at, updated_at
                ) VALUES (
                    ?, ?, 2, FALSE, NULL, NULL, NULL, NULL, NULL, NULL,
                    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?
                )
                """,
                importItemId,
                importId,
                importNow,
                importNow);
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_item_errors (
                    import_item_id, sequence_number, error_code
                ) VALUES (?, 1, 'NAME_INVALID')
                """,
                importItemId);
        String subjectActorKey =
                OperationRateLimiter.actorKeyForSubject(
                        "m5-disposable-delete-subject");
        jdbcTemplate.update(
                """
                INSERT INTO operation_rate_locks (
                    actor_key, operation, touched_at
                ) VALUES (?, 'IMPORT_CREATE', ?)
                """,
                subjectActorKey,
                importNow);
        UUID commitmentId =
                insertCommitment(
                        householdId,
                        userId,
                        "DISPOSABLE_FEEDBACK_COMMITMENT",
                        "PRIVATE");
        UUID feedbackId = UUID.randomUUID();
        UUID foreignGuideAdminId = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at,
                    privacy_notice_version, created_at, updated_at
                ) VALUES (?, ?, ?, 'Foreign Guide Admin', 'Asia/Kolkata',
                          'en-IN', NULL, NULL, NULL,
                          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                foreignGuideAdminId,
                "foreign-guide-admin-" + foreignGuideAdminId,
                "foreign-guide-admin-" + foreignGuideAdminId + "@example.test");
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_feedback (
                    id, owner_user_id, household_id, commitment_id,
                    guide_id, guide_version, outcome, note, created_at
                ) VALUES (?, ?, ?, ?,
                          '40000000-0000-4000-8000-000000000001',
                          1, 'OUTDATED', 'ERASE_ME', CURRENT_TIMESTAMP)
                """,
                feedbackId,
                userId,
                householdId,
                commitmentId);
        jdbcTemplate.update(
                """
                INSERT INTO m5_idempotency_records (
                    actor_user_id, operation, key_hash, request_hash,
                    resource_id, response_status, response_body,
                    response_version, created_at
                ) VALUES (?, 'FEEDBACK_REVIEW', ?, ?, ?, 200, NULL, 0,
                          CURRENT_TIMESTAMP)
                """,
                foreignGuideAdminId,
                "b".repeat(64),
                "c".repeat(64),
                feedbackId);
        MvcResult created =
                createRequest(
                        requester,
                        "privacy-disposable-delete",
                        "DELETION",
                        null);
        String requestId =
                JsonPath.read(
                        created.getResponse().getContentAsString(), "$.id");

        mockMvc.perform(
                        post("/v1/admin/privacy/requests/{id}/execute", requestId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-disposable-exec"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                .andExpect(jsonPath("$.status").value("EXECUTED"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM households WHERE id = ?",
                                Integer.class,
                                householdId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM users WHERE id = ?",
                                Integer.class,
                                userId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM commitment_import_jobs
                                WHERE id = ?
                                """,
                                Integer.class,
                                importId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM commitment_import_items
                                WHERE id = ?
                                """,
                                Integer.class,
                                importItemId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM operation_rate_events
                                WHERE actor_key = ?
                                """,
                                Integer.class,
                                subjectActorKey))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM operation_rate_locks
                                WHERE actor_key = ?
                                """,
                                Integer.class,
                                subjectActorKey))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM privacy_requests
                                WHERE requester_user_id = ?
                                """,
                                Integer.class,
                                userId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM privacy_notice_acknowledgements
                                WHERE user_id = ?
                                """,
                                Integer.class,
                                userId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM consent_events WHERE user_id = ?",
                                Integer.class,
                                userId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM m5_idempotency_records
                                WHERE resource_id = ?
                                """,
                                Integer.class,
                                feedbackId))
                .isZero();
        String subjectHash =
                sha256(
                        ("autopay-guard/deletion-tombstone/v1:"
                                        + "m5-disposable-delete-subject")
                                .getBytes(StandardCharsets.UTF_8));
        Map<String, Object> tombstone =
                jdbcTemplate.queryForMap(
                        """
                        SELECT subject_hash, execution_id, created_at
                        FROM deletion_tombstones
                        WHERE subject_hash = ?
                        """,
                        subjectHash);
        assertThat(tombstone.get("subject_hash")).isEqualTo(subjectHash);
        assertThat(
                        tombstone.values().stream()
                                .map(String::valueOf)
                                .toList())
                .noneMatch(
                        value ->
                                value.contains("m5-disposable-delete-subject")
                                        || value.contains(
                                                "m5-disposable-delete@example.test")
                                        || value.contains("Disposable Subject")
                                        || value.contains(userId.toString())
                                        || value.contains(requestId));
        assertThat(tombstone.get("execution_id")).isNotNull();
        assertThat(tombstone.get("created_at")).isNotNull();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*) FROM m5_idempotency_records
                                WHERE resource_id = ?
                                """,
                                Integer.class,
                                UUID.fromString(requestId)))
                .isZero();
        mockMvc.perform(
                        post("/v1/admin/privacy/requests/{id}/execute", requestId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "privacy-disposable-exec"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/v1/me").with(requester))
                .andExpect(status().isForbidden());
    }

    private MvcResult createRequest(
            JwtRequestPostProcessor identity,
            String key,
            String type,
            String correctionValue)
            throws Exception {
        String body =
                correctionValue == null
                        ? """
                          {
                            "requestType": "%s"
                          }
                          """
                                .formatted(type)
                        : """
                          {
                            "requestType": "%s",
                            "correctionValue": "%s"
                          }
                          """
                                .formatted(type, correctionValue);
        return mockMvc.perform(
                        post("/v1/privacy/requests")
                                .with(identity)
                                .header("Idempotency-Key", key)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated())
                .andReturn();
    }

    private UUID createHousehold(
            JwtRequestPostProcessor identity, String name) throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(identity)
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
        return UUID.fromString(
                JsonPath.read(
                        result.getResponse().getContentAsString(), "$.id"));
    }

    private UUID userId(String email) {
        return jdbcTemplate.queryForObject(
                "SELECT id FROM users WHERE email = ?",
                UUID.class,
                email);
    }

    private void insertPrivateCanary(UUID householdId, UUID ownerUserId) {
        insertCommitment(
                householdId,
                ownerUserId,
                "FOREIGN_PRIVATE_CANARY",
                "PRIVATE");
    }

    private UUID insertCommitment(
            UUID householdId,
            UUID ownerUserId,
            String displayName,
            String visibility) {
        UUID commitmentId = UUID.randomUUID();
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
                    ?, ?, ?, NULL, NULL, ?,
                    'OTHER', 'UNKNOWN', 99900, NULL, 'INR', 'MONTHLY',
                    1, NULL, ?, 'ANCHOR_DAY', ?, FALSE, NULL,
                    'MANUAL', NULL, ?, 'ACTIVE', 1,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                commitmentId,
                householdId,
                ownerUserId,
                displayName,
                LocalDate.of(2026, 8, 15),
                LocalDate.of(2026, 8, 15),
                visibility);
        return commitmentId;
    }

    private void insertReminderCanary(UUID householdId, UUID commitmentId) {
        UUID setId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbcTemplate.update(
                """
                INSERT INTO reminder_rule_sets (
                    id, household_id, commitment_id, scope_type,
                    scope_reference_id, mode, activated_at,
                    optimistic_version, created_at, updated_at
                ) VALUES (?, ?, ?, 'COMMITMENT', ?, 'CUSTOM', ?, 1, ?, ?)
                """,
                setId,
                householdId,
                commitmentId,
                commitmentId,
                now,
                now,
                now);
        jdbcTemplate.update(
                """
                INSERT INTO reminder_rules (
                    id, rule_set_id, channel, offset_days,
                    local_send_time, enabled, activated_at,
                    created_at, updated_at
                ) VALUES (?, ?, 'IN_APP', 3, '09:00:00', TRUE, ?, ?, ?)
                """,
                UUID.randomUUID(),
                setId,
                now,
                now,
                now);
    }

    private void grantSharing(
            JwtRequestPostProcessor identity, String idempotencyKey)
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
                                          "action": "GRANTED"
                                        }
                                        """))
                .andExpect(status().isCreated());
    }

    private static JwtRequestPostProcessor identity(
            String subject, String email, String displayName) {
        return jwt()
                .jwt(
                        token ->
                                token.subject(subject)
                                        .claim("email", email)
                                        .claim("name", displayName))
                .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static JwtRequestPostProcessor privacyAdmin() {
        return jwt()
                .jwt(
                        token ->
                                token.subject("m5-privacy-admin")
                                        .claim(
                                                "email",
                                                "m5-privacy-admin@example.test")
                                        .claim("name", "Privacy Admin")
                                        .claim(
                                                "realm_access",
                                                Map.of(
                                                        "roles",
                                                        List.of(
                                                                "PRIVACY_ADMIN"))))
                .authorities(
                        new SimpleGrantedAuthority("ROLE_PRIVACY_ADMIN"));
    }

    private static String sha256(byte[] value) throws Exception {
        return HexFormat.of()
                .formatHex(MessageDigest.getInstance("SHA-256").digest(value));
    }
}
