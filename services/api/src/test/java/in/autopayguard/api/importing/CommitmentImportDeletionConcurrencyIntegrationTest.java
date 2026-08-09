package in.autopayguard.api.importing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import in.autopayguard.api.common.security.OpaqueCodes;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockPart;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CommitmentImportDeletionConcurrencyIntegrationTest {

    private static final String HEADER =
            "name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label";
    private static final MediaType SAFE_MULTIPART_FORM_DATA =
            MediaType.parseMediaType(
                    "multipart/form-data;boundary=AutopayGuardM6TestBoundary");
    private static final String TOMBSTONE_DOMAIN =
            "autopay-guard/deletion-tombstone/v1:";
    private static final long READY_TIMEOUT_SECONDS = 5;
    private static final long RESULT_TIMEOUT_SECONDS = 20;

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private CommitmentImportService importService;

    @Test
    void confirmedCsvImportCanBeDeletedWithoutControlResidue()
            throws Exception {
        SubjectFixture subject = subject("confirmed");
        ImportFixture imported =
                uploadPreview(
                        subject,
                        csv("Confirmed deletion fixture"),
                        "m6-confirmed-delete-upload");
        mockMvc.perform(
                        post(
                                        "/v1/imports/{id}/confirm",
                                        imported.importId())
                                .with(subject.auth())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-confirmed-delete-confirm")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"selectedItemIds":["%s"]}
                                        """
                                                .formatted(imported.itemId())))
                .andExpect(status().isOk());
        assertCount(
                """
                SELECT COUNT(*)
                FROM commitment_import_items i
                JOIN recurring_commitments c
                  ON c.id = i.created_commitment_id
                WHERE i.import_job_id = ?
                  AND i.selected = TRUE
                  AND c.data_owner_user_id = ?
                """,
                new Object[] {imported.importId(), subject.userId()},
                1);

        UUID requestId = requestDeletion(subject, "confirmed");
        MvcResult deletion =
                executeDeletion(
                        requestId,
                        "m6-confirmed-delete-execute");

        assertDeletionErasedSubject(
                subject,
                requestId,
                Set.of(imported.importId()),
                deletion);
    }

    @Test
    void uploadRacingDeletionCannotRecreateSubjectDataOrDeadlock()
            throws Exception {
        SubjectFixture subject = subject("upload");
        UUID requestId = requestDeletion(subject, "upload");

        RaceResult<MvcResult> race =
                race(
                        () ->
                                upload(
                                        subject,
                                        csv("Upload deletion race"),
                                        "m6-delete-race-upload-operation"),
                        () ->
                                executeDeletion(
                                        requestId,
                                        "m6-delete-race-upload-execute"));

        assertHttpOutcome(race.operation(), 201, 403, 404);
        Set<UUID> importIds = new HashSet<>();
        if (race.operation().getResponse().getStatus() == 201) {
            importIds.add(responseId(race.operation()));
        }
        assertDeletionErasedSubject(subject, requestId, importIds, race.deletion());
    }

    @Test
    void confirmRacingDeletionCannotLeaveCommitmentsOrDeadlock()
            throws Exception {
        SubjectFixture subject = subject("confirm");
        ImportFixture imported =
                uploadPreview(
                        subject,
                        csv("Confirm deletion race"),
                        "m6-delete-race-confirm-upload");
        UUID requestId = requestDeletion(subject, "confirm");
        String requestBody =
                """
                {"selectedItemIds":["%s"]}
                """
                        .formatted(imported.itemId());

        RaceResult<MvcResult> race =
                race(
                        () ->
                                mockMvc.perform(
                                                post(
                                                                "/v1/imports/{id}/confirm",
                                                                imported.importId())
                                                        .with(subject.auth())
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"0\"")
                                                        .header(
                                                                "Idempotency-Key",
                                                                "m6-delete-race-confirm-operation")
                                                        .contentType(
                                                                MediaType.APPLICATION_JSON)
                                                        .content(requestBody))
                                        .andReturn(),
                        () ->
                                executeDeletion(
                                        requestId,
                                        "m6-delete-race-confirm-execute"));

        assertHttpOutcome(race.operation(), 200, 403, 404);
        assertDeletionErasedSubject(
                subject,
                requestId,
                Set.of(imported.importId()),
                race.deletion());
    }

    @Test
    void lazyExpiryGetRacingDeletionCannotRestorePreviewOrDeadlock()
            throws Exception {
        SubjectFixture subject = subject("lazy-expiry");
        ImportFixture imported =
                uploadPreview(
                        subject,
                        csv("Lazy expiry deletion race"),
                        "m6-delete-race-lazy-upload");
        expireNow(imported.importId());
        UUID requestId = requestDeletion(subject, "lazy-expiry");

        RaceResult<MvcResult> race =
                race(
                        () ->
                                mockMvc.perform(
                                                get(
                                                                "/v1/imports/{id}",
                                                                imported.importId())
                                                        .with(subject.auth()))
                                        .andReturn(),
                        () ->
                                executeDeletion(
                                        requestId,
                                        "m6-delete-race-lazy-execute"));

        assertHttpOutcome(race.operation(), 200, 403, 404);
        if (race.operation().getResponse().getStatus() == 200) {
            assertThat(
                            JsonPath.<String>read(
                                    race.operation()
                                            .getResponse()
                                            .getContentAsString(),
                                    "$.status"))
                    .isEqualTo("EXPIRED");
        }
        assertDeletionErasedSubject(
                subject,
                requestId,
                Set.of(imported.importId()),
                race.deletion());
    }

    @Test
    void discardRacingDeletionCannotLeavePreviewOrDeadlock()
            throws Exception {
        SubjectFixture subject = subject("discard");
        ImportFixture imported =
                uploadPreview(
                        subject,
                        csv("Discard deletion race"),
                        "m6-delete-race-discard-upload");
        UUID requestId = requestDeletion(subject, "discard");

        RaceResult<MvcResult> race =
                race(
                        () ->
                                mockMvc.perform(
                                                delete(
                                                                "/v1/imports/{id}",
                                                                imported.importId())
                                                        .with(subject.auth())
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"0\""))
                                        .andReturn(),
                        () ->
                                executeDeletion(
                                        requestId,
                                        "m6-delete-race-discard-execute"));

        assertHttpOutcome(race.operation(), 204, 403, 404);
        assertDeletionErasedSubject(
                subject,
                requestId,
                Set.of(imported.importId()),
                race.deletion());
    }

    @Test
    void scheduledExpiryRacingDeletionCannotLeavePreviewOrDeadlock()
            throws Exception {
        SubjectFixture subject = subject("scheduled-expiry");
        ImportFixture imported =
                uploadPreview(
                        subject,
                        csv("Scheduled expiry deletion race"),
                        "m6-delete-race-scheduled-upload");
        expireNow(imported.importId());
        UUID requestId = requestDeletion(subject, "scheduled-expiry");

        RaceResult<Void> race =
                race(
                        () -> {
                            importService.expireDueImports();
                            return null;
                        },
                        () ->
                                executeDeletion(
                                        requestId,
                                        "m6-delete-race-scheduled-execute"));

        assertThat(race.operation()).isNull();
        assertDeletionErasedSubject(
                subject,
                requestId,
                Set.of(imported.importId()),
                race.deletion());
    }

    private SubjectFixture subject(String scenario) throws Exception {
        String suffix = scenario + "-" + UUID.randomUUID();
        String oidcSubject = "m6-import-delete-" + suffix;
        String email = "m6-import-delete-" + suffix + "@example.test";
        SubjectFixture unprovisioned =
                new SubjectFixture(
                        oidcSubject,
                        email,
                        "Import Delete Race " + scenario,
                        null,
                        null);
        UUID householdId =
                createHousehold(
                        unprovisioned,
                        "M6 import deletion " + scenario);
        UUID userId =
                jdbcTemplate.queryForObject(
                        "SELECT id FROM users WHERE email = ?",
                        UUID.class,
                        email);
        return new SubjectFixture(
                oidcSubject,
                email,
                unprovisioned.displayName(),
                userId,
                householdId);
    }

    private UUID createHousehold(SubjectFixture subject, String name)
            throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(subject.auth())
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

    private ImportFixture uploadPreview(
            SubjectFixture subject, String csv, String idempotencyKey)
            throws Exception {
        MvcResult uploaded =
                upload(subject, csv, idempotencyKey);
        assertHttpOutcome(uploaded, 201);
        UUID importId = responseId(uploaded);
        UUID itemId =
                jdbcTemplate.queryForObject(
                        """
                        SELECT id
                        FROM commitment_import_items
                        WHERE import_job_id = ?
                        """,
                        UUID.class,
                        importId);
        return new ImportFixture(importId, itemId);
    }

    private MvcResult upload(
            SubjectFixture subject, String csv, String idempotencyKey)
            throws Exception {
        MockPart householdPart =
                new MockPart(
                        "householdId",
                        subject.householdId()
                                .toString()
                                .getBytes(StandardCharsets.US_ASCII));
        householdPart.getHeaders().setContentType(MediaType.TEXT_PLAIN);
        MockPart file =
                new MockPart(
                        "file",
                        "controlled.csv",
                        csv.getBytes(StandardCharsets.UTF_8));
        file.getHeaders().setContentType(MediaType.parseMediaType("text/csv"));
        return mockMvc.perform(
                        multipart("/v1/imports")
                                .part(householdPart)
                                .part(file)
                                .contentType(SAFE_MULTIPART_FORM_DATA)
                                .with(subject.auth())
                                .header("Idempotency-Key", idempotencyKey))
                .andReturn();
    }

    private UUID requestDeletion(SubjectFixture subject, String scenario)
            throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/v1/privacy/requests")
                                        .with(subject.auth())
                                        .header(
                                                "Idempotency-Key",
                                                "m6-import-delete-request-"
                                                        + scenario)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"requestType":"DELETION"}
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn();
        return responseId(result);
    }

    private MvcResult executeDeletion(UUID requestId, String idempotencyKey)
            throws Exception {
        return mockMvc.perform(
                        post(
                                        "/v1/admin/privacy/requests/{id}/execute",
                                        requestId)
                                .with(privacyAdmin())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header("Idempotency-Key", idempotencyKey))
                .andReturn();
    }

    private void expireNow(UUID importId) {
        Instant expiresAt = Instant.now().minusSeconds(1);
        Instant createdAt = expiresAt.minus(Duration.ofHours(23));
        Instant processedAt = createdAt.plusSeconds(1);
        assertThat(
                        jdbcTemplate.update(
                                """
                                UPDATE commitment_import_jobs
                                SET created_at = ?, raw_processed_at = ?,
                                    preview_expires_at = ?, updated_at = ?
                                WHERE id = ? AND status = 'PREVIEW_READY'
                                """,
                                createdAt,
                                processedAt,
                                expiresAt,
                                processedAt,
                                importId))
                .isEqualTo(1);
    }

    private <T> RaceResult<T> race(
            ThrowingSupplier<T> operation,
            ThrowingSupplier<MvcResult> deletion)
            throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<T> operationFuture =
                    executor.submit(
                            () -> {
                                ready.countDown();
                                start.await();
                                return operation.get();
                            });
            Future<MvcResult> deletionFuture =
                    executor.submit(
                            () -> {
                                ready.countDown();
                                start.await();
                                return deletion.get();
                            });

            assertThat(
                            ready.await(
                                    READY_TIMEOUT_SECONDS,
                                    TimeUnit.SECONDS))
                    .as("both racing operations reached the start gate")
                    .isTrue();
            start.countDown();
            T operationResult =
                    operationFuture.get(
                            RESULT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            MvcResult deletionResult =
                    deletionFuture.get(
                            RESULT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            return new RaceResult<>(operationResult, deletionResult);
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(
                            executor.awaitTermination(
                                    READY_TIMEOUT_SECONDS,
                                    TimeUnit.SECONDS))
                    .as("race executor terminated")
                    .isTrue();
        }
    }

    private void assertDeletionErasedSubject(
            SubjectFixture subject,
            UUID privacyRequestId,
            Set<UUID> importIds,
            MvcResult deletion)
            throws Exception {
        assertHttpOutcome(deletion, 200);
        assertThat(
                        JsonPath.<String>read(
                                deletion.getResponse().getContentAsString(),
                                "$.status"))
                .isEqualTo("EXECUTED");

        assertCount(
                "SELECT COUNT(*) FROM users WHERE id = ?",
                subject.userId(),
                0);
        assertCount(
                "SELECT COUNT(*) FROM households WHERE owner_user_id = ?",
                subject.userId(),
                0);
        assertCount(
                "SELECT COUNT(*) FROM households WHERE id = ?",
                subject.householdId(),
                0);
        assertCount(
                "SELECT COUNT(*) FROM recurring_commitments WHERE data_owner_user_id = ?",
                subject.userId(),
                0);
        assertCount(
                "SELECT COUNT(*) FROM commitment_import_jobs WHERE owner_user_id = ?",
                subject.userId(),
                0);
        assertCount(
                "SELECT COUNT(*) FROM privacy_requests WHERE requester_user_id = ?",
                subject.userId(),
                0);
        assertCount(
                "SELECT COUNT(*) FROM m5_idempotency_records WHERE actor_user_id = ?",
                subject.userId(),
                0);
        assertCount(
                "SELECT COUNT(*) FROM idempotency_records WHERE owner_user_id = ?",
                subject.userId(),
                0);
        assertCount(
                "SELECT COUNT(*) FROM audit_events WHERE actor_user_id = ?",
                subject.userId(),
                0);

        String actorKey =
                OperationRateLimiter.actorKeyForSubject(subject.oidcSubject());
        assertCount(
                "SELECT COUNT(*) FROM operation_rate_events WHERE actor_key = ?",
                actorKey,
                0);
        assertCount(
                "SELECT COUNT(*) FROM operation_rate_locks WHERE actor_key = ?",
                actorKey,
                0);

        for (UUID importId : importIds) {
            assertCount(
                    "SELECT COUNT(*) FROM commitment_import_jobs WHERE id = ?",
                    importId,
                    0);
            assertCount(
                    "SELECT COUNT(*) FROM commitment_import_items WHERE import_job_id = ?",
                    importId,
                    0);
            assertCount(
                    """
                    SELECT COUNT(*) FROM audit_events
                    WHERE resource_type = 'IMPORT_JOB' AND resource_id = ?
                    """,
                    importId,
                    0);
        }
        assertCount(
                "SELECT COUNT(*) FROM privacy_requests WHERE id = ?",
                privacyRequestId,
                0);

        String subjectHash =
                OpaqueCodes.sha256(
                        TOMBSTONE_DOMAIN + subject.oidcSubject());
        assertCount(
                "SELECT COUNT(*) FROM deletion_tombstones WHERE subject_hash = ?",
                subjectHash,
                1);
    }

    private void assertCount(
            String sql, Object parameter, int expectedCount) {
        Object[] parameters =
                parameter instanceof Object[] values
                        ? values
                        : new Object[] {parameter};
        assertThat(
                        jdbcTemplate.queryForObject(
                                sql, Integer.class, parameters))
                .isEqualTo(expectedCount);
    }

    private static void assertHttpOutcome(
            MvcResult result, int... expectedStatuses) throws Exception {
        assertThat(expectedStatuses)
                .as(
                        "HTTP response body: %s",
                        result.getResponse().getContentAsString())
                .contains(result.getResponse().getStatus());
    }

    private static UUID responseId(MvcResult result) throws Exception {
        return UUID.fromString(
                JsonPath.read(
                        result.getResponse().getContentAsString(), "$.id"));
    }

    private static String csv(String name) {
        return HEADER
                + "\n"
                + name
                + ",OTHER,10,INR,MONTHLY,2026-08-15,UNKNOWN,\n";
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
                                token.subject("m6-import-delete-privacy-admin")
                                        .claim(
                                                "email",
                                                "m6-import-delete-privacy-admin@example.test")
                                        .claim(
                                                "name",
                                                "M6 Import Delete Privacy Admin")
                                        .claim(
                                                "realm_access",
                                                Map.of(
                                                        "roles",
                                                        List.of(
                                                                "PRIVACY_ADMIN"))))
                .authorities(
                        new SimpleGrantedAuthority("ROLE_PRIVACY_ADMIN"));
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws Exception;
    }

    private record RaceResult<T>(T operation, MvcResult deletion) {}

    private record ImportFixture(UUID importId, UUID itemId) {}

    private record SubjectFixture(
            String oidcSubject,
            String email,
            String displayName,
            UUID userId,
            UUID householdId) {

        JwtRequestPostProcessor auth() {
            return identity(oidcSubject, email, displayName);
        }
    }
}
