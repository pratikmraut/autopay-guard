package in.autopayguard.api.importing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import in.autopayguard.api.common.security.OpaqueCodes;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockPart;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CommitmentImportApiIntegrationTest {

    private static final String HEADER =
            "name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label";
    private static final MediaType SAFE_MULTIPART_FORM_DATA =
            MediaType.parseMediaType(
                    "multipart/form-data;boundary=AutopayGuardM6TestBoundary");

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private CommitmentImportService importService;
    @Autowired private Environment environment;

    @Test
    void multipartRequestCapRemainsMemoryBounded() {
        assertThat(
                        environment.getRequiredProperty(
                                "spring.servlet.multipart.max-file-size"))
                .isEqualTo("256KB");
        assertThat(
                        environment.getRequiredProperty(
                                "spring.servlet.multipart.max-request-size"))
                .isEqualTo("320KB");
        assertThat(
                        environment.getRequiredProperty(
                                "spring.servlet.multipart.file-size-threshold"))
                .isEqualTo("320KB");
    }

    @Test
    void previewCreatesNothingAndConfirmIsAtomicReplayableWithoutCommittedRaw()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-import-owner",
                        "m6-import-owner@example.test",
                        "Import Owner");
        JwtRequestPostProcessor foreign =
                identity(
                        "m6-import-foreign",
                        "m6-import-foreign@example.test",
                        "Import Foreign");
        UUID household = createHousehold(owner, "M6 import household");
        createHousehold(foreign, "M6 foreign household");
        String csv =
                HEADER
                        + "\nCloudNest Demo,SOFTWARE,12.00,INR,MONTHLY,2026-08-15,CARD_RECURRING,\n"
                        + "CloudNest Demo,SOFTWARE,12.00,INR,MONTHLY,2026-08-15,CARD_RECURRING,\n"
                        + "Unsafe password,SUBSCRIPTION,1e3,inr,CUSTOM,2026-8-1,bad,\n";

        MvcResult uploaded =
                upload(owner, household, csv, "m6-upload-key-0001")
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                        .andExpect(jsonPath("$.status").value("PREVIEW_READY"))
                        .andExpect(jsonPath("$.totalItemCount").value(3))
                        .andExpect(jsonPath("$.validItemCount").value(2))
                        .andExpect(jsonPath("$.invalidItemCount").value(1))
                        .andExpect(jsonPath("$.duplicateItemCount").value(1))
                        .andReturn();
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        assertThat(commitmentCount(household)).isZero();
        assertThat(rawPayload(importId)).isNull();
        String persistedFingerprint =
                jdbcTemplate.queryForObject(
                        """
                        SELECT content_fingerprint
                        FROM commitment_import_jobs
                        WHERE id = ?
                        """,
                        String.class,
                        importId);
        assertThat(persistedFingerprint)
                .matches("[0-9a-f]{64}")
                .isNotEqualTo(OpaqueCodes.sha256(csv));
        assertThat(uploaded.getResponse().getContentAsString())
                .doesNotContain(persistedFingerprint);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT raw_processed_at IS NOT NULL
                                FROM commitment_import_jobs
                                WHERE id = ?
                                """,
                                Boolean.class,
                                importId))
                .isTrue();

        MvcResult preview =
                mockMvc.perform(get("/v1/imports/{id}", importId).with(owner))
                        .andExpect(status().isOk())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                        .andExpect(
                                header().string(
                                        HttpHeaders.CACHE_CONTROL,
                                        "no-store"))
                        .andExpect(jsonPath("$.items[0].duplicateKind").value("NONE"))
                        .andExpect(jsonPath("$.items[1].duplicateKind").value("IN_FILE"))
                        .andExpect(jsonPath("$.items[2].valid").value(false))
                        .andExpect(jsonPath("$.items[2].preview").value(nullValue()))
                        .andExpect(jsonPath("$.items[2].errors.length()").value(6))
                        .andReturn();
        List<String> itemIds =
                JsonPath.read(
                        preview.getResponse().getContentAsString(),
                        "$.items[?(@.valid == true)].id");
        String originalRawProcessedAt =
                JsonPath.read(
                        preview.getResponse().getContentAsString(),
                        "$.rawProcessedAt");
        String confirmBody =
                objectMapper.writeValueAsString(
                        java.util.Map.of("selectedItemIds", itemIds));

        upload(
                        foreign,
                        household,
                        csv,
                        "m6-foreign-upload-001")
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/v1/imports/{id}", importId).with(foreign))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .with(foreign)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-foreign-confirm-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmBody))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        delete("/v1/imports/{id}", importId)
                                .with(foreign)
                                .header(HttpHeaders.IF_MATCH, "\"0\""))
                .andExpect(status().isNotFound());

        MvcResult confirmed =
                mockMvc.perform(
                                post("/v1/imports/{id}/confirm", importId)
                                        .with(owner)
                                        .header(HttpHeaders.IF_MATCH, "\"0\"")
                                        .header(
                                                "Idempotency-Key",
                                                "m6-confirm-key-0001")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(confirmBody))
                        .andExpect(status().isOk())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                        .andExpect(jsonPath("$.status").value("CONFIRMED"))
                        .andExpect(jsonPath("$.createdCommitmentCount").value(2))
                        .andExpect(
                                jsonPath("$.rawProcessedAt")
                                         .value(originalRawProcessedAt))
                         .andReturn();
        List<String> confirmedCommitmentIds =
                JsonPath.read(
                        confirmed.getResponse().getContentAsString(),
                        "$.commitmentIds");
        assertThat(commitmentCount(household)).isEqualTo(2);
        assertThat(rawPayload(importId)).isNull();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM recurring_commitments
                                WHERE household_id = ? AND source = 'CSV'
                                  AND visibility = 'PRIVATE'
                                  AND status = 'ACTIVE'
                                """,
                                Integer.class,
                                household))
                .isEqualTo(2);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM commitment_occurrences o
                                JOIN recurring_commitments c
                                  ON c.id = o.commitment_id
                                WHERE c.import_job_id = ?
                                """,
                                Integer.class,
                                importId))
                .isPositive();

        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-confirm-key-0001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmBody))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(
                        jsonPath("$.commitmentIds")
                                .value(confirmedCommitmentIds));
        assertThat(commitmentCount(household)).isEqualTo(2);

        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-confirm-key-0002")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmBody))
                .andExpect(status().isPreconditionFailed());
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM audit_events
                                WHERE resource_type = 'IMPORT_JOB'
                                  AND resource_id = ?
                                """,
                                Integer.class,
                                importId))
                .isEqualTo(2);
    }

    @Test
    void directMultipartBoundaryRejectsExtraPartsTraversalAndWrongMime()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-boundary-owner",
                        "m6-boundary-owner@example.test",
                        "Boundary Owner");
        UUID household = createHousehold(owner, "M6 boundary household");
        String csv =
                HEADER
                        + "\nSafe,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n";

        uploadWith(
                        owner,
                        household,
                        csv,
                        "../escape.csv",
                        "text/csv",
                        "m6-boundary-key-01")
                .andExpect(status().isBadRequest());
        uploadWith(
                        owner,
                        household,
                        csv,
                        "IMPORT.CSV",
                        "application/csv",
                        "m6-boundary-key-02")
                .andExpect(status().isBadRequest());

        MockPart householdPart =
                new MockPart(
                        "householdId",
                        household.toString().getBytes(StandardCharsets.US_ASCII));
        householdPart.getHeaders().setContentType(MediaType.TEXT_PLAIN);
        MockPart file =
                new MockPart(
                        "file",
                        "safe.CsV",
                        csv.getBytes(StandardCharsets.UTF_8));
        file.getHeaders().setContentType(MediaType.parseMediaType("text/csv"));
        MockPart extra = new MockPart("extra", new byte[] {1});
        extra.getHeaders().setContentType(MediaType.TEXT_PLAIN);
        mockMvc.perform(
                        multipart("/v1/imports")
                                .part(householdPart)
                                .part(file)
                                .part(extra)
                                .contentType(SAFE_MULTIPART_FORM_DATA)
                                .with(owner)
                                .header(
                                        "Idempotency-Key",
                                        "m6-boundary-key-03"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        multipart("/v1/imports")
                                .part(householdPart)
                                .part(file)
                                .contentType(
                                        MediaType.parseMediaType(
                                                "multipart/mixed;boundary=SafeBoundary123"))
                                .with(owner)
                                .header(
                                        "Idempotency-Key",
                                        "m6-boundary-key-04"))
                .andExpect(status().isUnsupportedMediaType());

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM commitment_import_jobs
                                WHERE household_id = ?
                                """,
                                Integer.class,
                                household))
                .isZero();
    }

    @Test
    void existingActiveMatchUsesAuthoritativeNextDueInsteadOfHistoricalLastDayAnchor()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-existing-owner",
                        "m6-existing-owner@example.test",
                        "Existing Owner");
        UUID household = createHousehold(owner, "M6 existing household");
        MvcResult created =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(owner)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "householdId": "%s",
                                                  "merchantId": null,
                                                  "displayName": "Exact existing",
                                                  "category": "OTHER",
                                                  "paymentRail": "UNKNOWN",
                                                  "amountMinor": 1000,
                                                  "estimatedAmountMinor": null,
                                                  "currency": "INR",
                                                  "frequency": "MONTHLY",
                                                  "intervalCount": 1,
                                                  "customIntervalUnit": null,
                                                  "anchorDate": "2024-01-31",
                                                  "monthDayPolicy": "LAST_DAY",
                                                  "variableAmount": false,
                                                  "maskedPaymentLabel": null
                                                }
                                                """
                                                        .formatted(household)))
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID commitmentId =
                UUID.fromString(
                        JsonPath.read(
                                created.getResponse().getContentAsString(),
                                "$.id"));
        jdbcTemplate.update(
                """
                UPDATE recurring_commitments
                SET anchor_date = ?, month_day_policy = 'LAST_DAY',
                    next_due_date = ?
                WHERE id = ?
                """,
                LocalDate.of(2024, 1, 31),
                LocalDate.of(2026, 7, 31),
                commitmentId);
        mockMvc.perform(get("/v1/commitments/{id}", commitmentId).with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.anchorDate").value("2024-01-31"))
                .andExpect(jsonPath("$.monthDayPolicy").value("LAST_DAY"))
                .andExpect(jsonPath("$.nextDueDate").value("2026-07-31"));

        String csv =
                HEADER
                        + "\nExact existing,OTHER,10,INR,MONTHLY,2026-07-31,UNKNOWN,\n"
                        + "Exact existing,OTHER,10,INR,MONTHLY,2026-07-31,UNKNOWN,\n"
                        + "Exact existing,OTHER,10,INR,MONTHLY,2024-01-31,UNKNOWN,\n";
        MvcResult uploaded =
                upload(owner, household, csv, "m6-existing-key-001")
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.duplicateItemCount").value(2))
                        .andReturn();
        String importId =
                JsonPath.read(
                        uploaded.getResponse().getContentAsString(),
                        "$.id");

        mockMvc.perform(get("/v1/imports/{id}", importId).with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].duplicateKind").value("EXISTING"))
                .andExpect(jsonPath("$.items[1].duplicateKind").value("EXISTING"))
                .andExpect(jsonPath("$.items[2].duplicateKind").value("NONE"));
    }

    @Test
    void discardMarksNormalizedPreviewAndRecordsOneTerminalAudit()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-discard-owner",
                        "m6-discard-owner@example.test",
                        "Discard Owner");
        UUID household = createHousehold(owner, "M6 discard household");
        String csv =
                HEADER
                        + "\nDiscard,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n";
        MvcResult uploaded =
                upload(owner, household, csv, "m6-discard-key-001")
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));

        mockMvc.perform(
                        delete("/v1/imports/{id}", importId)
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\""))
                .andExpect(status().isNoContent());

        assertThat(rawPayload(importId)).isNull();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT status FROM commitment_import_jobs WHERE id = ?",
                                String.class,
                                importId))
                .isEqualTo("DISCARDED");
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM audit_events
                                WHERE resource_type = 'IMPORT_JOB'
                                  AND resource_id = ?
                                """,
                                Integer.class,
                                importId))
                .isEqualTo(2);
    }

    @Test
    void lazyObservationExpiresPreviewBeforeTwentyFourHours()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-expiry-owner",
                        "m6-expiry-owner@example.test",
                        "Expiry Owner");
        UUID household = createHousehold(owner, "M6 expiry household");
        String csv =
                HEADER
                        + "\nExpiry,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n";
        MvcResult uploaded =
                upload(owner, household, csv, "m6-expiry-key-0001")
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        var times =
                jdbcTemplate.queryForMap(
                        """
                        SELECT created_at, preview_expires_at, raw_processed_at
                        FROM commitment_import_jobs WHERE id = ?
                        """,
                        importId);
        Instant created =
                ((OffsetDateTime) times.get("created_at")).toInstant();
        Instant expires =
                ((OffsetDateTime) times.get("preview_expires_at")).toInstant();
        Instant originallyProcessed =
                ((OffsetDateTime) times.get("raw_processed_at")).toInstant();
        assertThat(Duration.between(created, expires))
                .isPositive()
                .isLessThanOrEqualTo(Duration.ofHours(24));

        Instant now = Instant.now();
        jdbcTemplate.update(
                """
                UPDATE commitment_import_jobs
                SET created_at = ?, preview_expires_at = ?, updated_at = ?
                WHERE id = ?
                """,
                now.minus(Duration.ofHours(2)),
                now.minus(Duration.ofHours(1)),
                now.minus(Duration.ofHours(1)),
                importId);
        mockMvc.perform(get("/v1/imports/{id}", importId).with(owner))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.status").value("EXPIRED"))
                .andExpect(jsonPath("$.rawProcessedAt").isNotEmpty());
        assertThat(rawPayload(importId)).isNull();
        Instant processedAfterExpiry =
                jdbcTemplate.queryForObject(
                        """
                        SELECT raw_processed_at
                        FROM commitment_import_jobs
                        WHERE id = ?
                        """,
                        (row, rowNumber) ->
                                row.getObject(
                                                "raw_processed_at",
                                                OffsetDateTime.class)
                                        .toInstant(),
                        importId);
        assertThat(processedAfterExpiry).isEqualTo(originallyProcessed);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM audit_events
                                WHERE resource_type = 'IMPORT_JOB'
                                  AND resource_id = ?
                                """,
                                Integer.class,
                                importId))
                .isEqualTo(2);
    }

    @Test
    void scheduledExpiryRacingConfirmationLeavesOneExpiredTerminalState()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m6-expiry-confirm-race-" + suffix,
                        "m6-expiry-confirm-race-" + suffix + "@example.test",
                        "Expiry Confirm Race Owner");
        UUID household =
                createHousehold(owner, "M6 expiry confirm race household");
        MvcResult uploaded =
                upload(
                                owner,
                                household,
                                HEADER
                                        + "\nExpiry confirmation race,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n",
                                "m6-expiry-confirm-race-upload")
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        String itemId =
                jdbcTemplate.queryForObject(
                                """
                                SELECT id FROM commitment_import_items
                                WHERE import_job_id = ?
                                """,
                                UUID.class,
                                importId)
                        .toString();
        expireNow(importId);
        String body =
                objectMapper.writeValueAsString(
                        java.util.Map.of(
                                "selectedItemIds", List.of(itemId)));

        MvcResult result =
                raceWithScheduledExpiry(
                        () ->
                                mockMvc.perform(
                                                post(
                                                                "/v1/imports/{id}/confirm",
                                                                importId)
                                                        .with(owner)
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"0\"")
                                                        .header(
                                                                "Idempotency-Key",
                                                                "m6-expiry-confirm-race-key")
                                                        .contentType(
                                                                MediaType.APPLICATION_JSON)
                                                        .content(body))
                                        .andReturn());

        assertThat(result.getResponse().getStatus()).isEqualTo(412);
        assertExpiredRaceOutcome(importId, household);
    }

    @Test
    void scheduledExpiryRacingDiscardLeavesOneExpiredTerminalState()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m6-expiry-discard-race-" + suffix,
                        "m6-expiry-discard-race-" + suffix + "@example.test",
                        "Expiry Discard Race Owner");
        UUID household =
                createHousehold(owner, "M6 expiry discard race household");
        MvcResult uploaded =
                upload(
                                owner,
                                household,
                                HEADER
                                        + "\nExpiry discard race,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n",
                                "m6-expiry-discard-race-upload")
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        expireNow(importId);

        MvcResult result =
                raceWithScheduledExpiry(
                        () ->
                                mockMvc.perform(
                                                delete(
                                                                "/v1/imports/{id}",
                                                                importId)
                                                        .with(owner)
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"0\""))
                                        .andReturn());

        assertThat(result.getResponse().getStatus()).isEqualTo(412);
        assertExpiredRaceOutcome(importId, household);
    }

    @Test
    void fileFatalFailurePersistsNoJobIdempotencyAuditOrCommitment()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-fatal-owner-" + UUID.randomUUID(),
                        "m6-fatal-owner-" + UUID.randomUUID() + "@example.test",
                        "Fatal Owner");
        UUID household = createHousehold(owner, "M6 fatal household");
        int idempotencyBefore =
                jdbcTemplate.queryForObject(
                        """
                        SELECT count(*) FROM m5_idempotency_records
                        WHERE operation = 'IMPORT_CREATE'
                        """,
                        Integer.class);
        int auditsBefore =
                jdbcTemplate.queryForObject(
                        """
                        SELECT count(*) FROM audit_events
                        WHERE resource_type = 'IMPORT_JOB'
                        """,
                        Integer.class);

        upload(
                        owner,
                        household,
                        HEADER + "\n",
                        "m6-file-fatal-key-001")
                .andExpect(status().isBadRequest());

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM commitment_import_jobs
                                WHERE household_id = ?
                                """,
                                Integer.class,
                                household))
                .isZero();
        assertThat(commitmentCount(household)).isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM m5_idempotency_records
                                WHERE operation = 'IMPORT_CREATE'
                                """,
                                Integer.class))
                .isEqualTo(idempotencyBefore);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM audit_events
                                WHERE resource_type = 'IMPORT_JOB'
                                """,
                                Integer.class))
                .isEqualTo(auditsBefore);
    }

    @Test
    void parallelSameKeyUploadAndConfirmReplayOneDurableResult()
            throws Exception {
        String subject = "m6-parallel-owner-" + UUID.randomUUID();
        JwtRequestPostProcessor owner =
                identity(
                        subject,
                        subject + "@example.test",
                        "Parallel Owner");
        UUID household = createHousehold(owner, "M6 parallel household");
        String csv =
                HEADER
                        + "\nParallel,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n";

        List<MvcResult> uploadResults =
                runInParallel(
                        5,
                        () ->
                                upload(
                                                owner,
                                                household,
                                                csv,
                                                "m6-parallel-upload-key")
                                        .andExpect(status().isCreated())
                                        .andReturn());
        Set<String> importIds = new HashSet<>();
        for (MvcResult result : uploadResults) {
            importIds.add(
                    JsonPath.read(
                            result.getResponse().getContentAsString(),
                            "$.id"));
        }
        assertThat(importIds).hasSize(1);
        UUID importId = UUID.fromString(importIds.iterator().next());
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM commitment_import_jobs
                                WHERE household_id = ?
                                """,
                                Integer.class,
                                household))
                .isEqualTo(1);
        assertThat(
                        rateEventCount(
                                subject, "IMPORT_CREATE"))
                .isEqualTo(1);

        String itemId =
                jdbcTemplate.queryForObject(
                                """
                                SELECT id FROM commitment_import_items
                                WHERE import_job_id = ?
                                """,
                                UUID.class,
                                importId)
                        .toString();
        String confirmBody =
                objectMapper.writeValueAsString(
                        java.util.Map.of(
                                "selectedItemIds", List.of(itemId)));
        List<MvcResult> confirmResults =
                runInParallel(
                        5,
                        () ->
                                mockMvc.perform(
                                                post(
                                                                "/v1/imports/{id}/confirm",
                                                                importId)
                                                        .with(owner)
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"0\"")
                                                        .header(
                                                                "Idempotency-Key",
                                                                "m6-parallel-confirm-key")
                                                        .contentType(
                                                                MediaType.APPLICATION_JSON)
                                                        .content(confirmBody))
                                        .andExpect(status().isOk())
                                        .andReturn());
        Set<String> commitmentIds = new HashSet<>();
        for (MvcResult result : confirmResults) {
            commitmentIds.add(
                    JsonPath.read(
                            result.getResponse().getContentAsString(),
                            "$.commitmentIds[0]"));
        }
        assertThat(commitmentIds).hasSize(1);
        assertThat(commitmentCount(household)).isEqualTo(1);
        assertThat(
                        rateEventCount(
                                subject, "IMPORT_CONFIRM"))
                .isEqualTo(1);
    }

    @Test
    void concurrentUploadsBeyondPoolSizeDoNotStarveConnections()
            throws Exception {
        int callers = 12;
        List<PoolUploadFixture> fixtures = new java.util.ArrayList<>(callers);
        for (int index = 0; index < callers; index++) {
            String subject =
                    "m6-pool-owner-" + index + "-" + UUID.randomUUID();
            JwtRequestPostProcessor owner =
                    identity(
                            subject,
                            subject + "@example.test",
                            "Pool Owner " + index);
            fixtures.add(
                    new PoolUploadFixture(
                            owner,
                            createHousehold(
                                    owner,
                                    "M6 pool household " + index),
                            subject,
                            index));
        }
        AtomicInteger nextFixture = new AtomicInteger();

        List<MvcResult> results =
                runInParallel(
                        callers,
                        () -> {
                            PoolUploadFixture fixture =
                                    fixtures.get(
                                            nextFixture.getAndIncrement());
                            return upload(
                                            fixture.owner(),
                                            fixture.householdId(),
                                            HEADER
                                                    + "\nPool "
                                                    + fixture.index()
                                                    + ",OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n",
                                            "m6-pool-upload-key-"
                                                    + fixture.index())
                                    .andExpect(status().isCreated())
                                    .andReturn();
                        });

        assertThat(results).hasSize(callers);
        for (PoolUploadFixture fixture : fixtures) {
            assertThat(
                            jdbcTemplate.queryForObject(
                                    """
                                    SELECT count(*)
                                    FROM commitment_import_jobs
                                    WHERE household_id = ?
                                    """,
                                    Integer.class,
                                    fixture.householdId()))
                    .isEqualTo(1);
            assertThat(
                            rateEventCount(
                                    fixture.subject(),
                                    "IMPORT_CREATE"))
                    .isEqualTo(1);
        }
    }

    @Test
    void urlAndOtpCanariesAreNeverEchoedOrRetainedAfterConfirmation()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-canary-owner-" + UUID.randomUUID(),
                        "m6-canary-owner-" + UUID.randomUUID() + "@example.test",
                        "Canary Owner");
        UUID household = createHousehold(owner, "M6 canary household");
        String canary = "M6URLCANARY";
        String csv =
                HEADER
                        + "\nSafe row,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,Card ending 4242\n"
                        + "https://evil.example/"
                        + canary
                        + ",OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,123456\n";

        MvcResult uploaded =
                upload(owner, household, csv, "m6-canary-upload-01")
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.validItemCount").value(1))
                        .andExpect(jsonPath("$.invalidItemCount").value(1))
                        .andReturn();
        assertThat(uploaded.getResponse().getContentAsString())
                .doesNotContain(canary, "evil.example", "123456");
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        assertThat(rawPayload(importId)).isNull();

        MvcResult preview =
                mockMvc.perform(get("/v1/imports/{id}", importId).with(owner))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items[1].valid").value(false))
                        .andExpect(jsonPath("$.items[1].preview").value(nullValue()))
                        .andReturn();
        String previewBody = preview.getResponse().getContentAsString();
        assertThat(previewBody)
                .doesNotContain(canary, "evil.example", "123456");
        String selectedId =
                JsonPath.read(previewBody, "$.items[0].id");
        String confirmBody =
                objectMapper.writeValueAsString(
                        java.util.Map.of(
                                "selectedItemIds", List.of(selectedId)));

        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-canary-confirm-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmBody))
                .andExpect(status().isOk());

        assertThat(rawPayload(importId)).isNull();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM commitment_import_items
                                WHERE import_job_id = ?
                                  AND (
                                    name LIKE '%M6URLCANARY%'
                                    OR masked_payment_label LIKE '%123456%'
                                  )
                                """,
                                Integer.class,
                                importId))
                .isZero();
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                // Keep scanner-shaped fixtures fragmented in source. Java joins them at runtime,
                // so the import guard still receives and rejects each complete credential pattern.
                "sk_" + "live_" + "0123456789abcdef0123456789",
                "sk_" + "test_" + "abcdef0123456789abcdef0123",
                "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz123456",
                "github_" + "pat_" + "abcdefghijklmnopqrstuvwxyz_123456",
                "Bear" + "er " + "abcdefghijklmnopqrstuvwxyz123456",
                "eyJhbGciOiJIUzI1NiJ9."
                        + "eyJzdWIiOiJzdWJqZWN0In0."
                        + "signatureABCDEFG",
                "pass" + "word=correct-horse-battery",
                "pass" + "wd=correct-horse-battery",
                "api_" + "key=correct-horse-battery",
                "sec" + "ret=correct-horse-battery",
                "to" + "ken=correct-horse-battery",
                "Password Manager Subscription",
                "Secret Garden Membership"
            })
    void obviousCredentialPatternsAreRejectedInNamesAndMaskedLabels(
            String credential) throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m6-credential-owner-" + suffix,
                        "m6-credential-owner-" + suffix + "@example.test",
                        "Input Screening Owner");
        UUID household = createHousehold(owner, "M6 input screening household");
        String csv =
                HEADER
                        + "\n"
                        + credential
                        + ",OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n"
                        + "Safe credential control,OTHER,10,INR,MONTHLY,2026-08-02,UNKNOWN,"
                        + credential
                        + "\n";

        MvcResult uploaded =
                upload(
                                owner,
                                household,
                                csv,
                                "m6-credential-upload-" + suffix)
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.validItemCount").value(0))
                        .andExpect(jsonPath("$.invalidItemCount").value(2))
                        .andReturn();
        String uploadBody = uploaded.getResponse().getContentAsString();
        assertThat(uploadBody).doesNotContain(credential);
        UUID importId =
                UUID.fromString(JsonPath.read(uploadBody, "$.id"));

        mockMvc.perform(get("/v1/imports/{id}", importId).with(owner))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.items[0].errors[0].code")
                                .value("NAME_SENSITIVE"))
                .andExpect(
                        jsonPath("$.items[1].errors[0].code")
                                .value("MASKED_LABEL_SENSITIVE"))
                .andExpect(jsonPath("$.items[0].preview").value(nullValue()))
                .andExpect(jsonPath("$.items[1].preview").value(nullValue()));
    }

    @Test
    void benignCredentialVocabularySurvivesPreviewAndConfirmation()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m6-benign-vocabulary-" + suffix,
                        "m6-benign-vocabulary-" + suffix + "@example.test",
                        "Benign Vocabulary Owner");
        UUID household = createHousehold(owner, "M6 word boundary household");
        String csv =
                HEADER
                        + "\nToken Transit Pass,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,API key reference\n"
                        + "Bearer Fitness Club,MEMBERSHIP,20,INR,MONTHLY,2026-08-02,UNKNOWN,sk_test sandbox label\n";

        MvcResult uploaded =
                upload(
                                owner,
                                household,
                                csv,
                                "m6-benign-vocabulary-upload-" + suffix)
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.validItemCount").value(2))
                        .andExpect(jsonPath("$.invalidItemCount").value(0))
                        .andReturn();
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        MvcResult preview =
                mockMvc.perform(get("/v1/imports/{id}", importId).with(owner))
                        .andExpect(status().isOk())
                        .andReturn();
        List<String> itemIds =
                JsonPath.read(
                        preview.getResponse().getContentAsString(),
                        "$.items[*].id");

        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-benign-vocabulary-confirm-" + suffix)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        objectMapper.writeValueAsString(
                                                java.util.Map.of(
                                                        "selectedItemIds",
                                                        itemIds))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.createdCommitmentCount").value(2));
    }

    @Test
    void activeMemberReceivesNotFoundForPreviewConfirmAndDiscard()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m6-member-owner-" + suffix,
                        "m6-member-owner-" + suffix + "@example.test",
                        "Member Owner");
        JwtRequestPostProcessor member =
                identity(
                        "m6-active-member-" + suffix,
                        "m6-active-member-" + suffix + "@example.test",
                        "Active Member");
        UUID household = createHousehold(owner, "M6 member household");
        mockMvc.perform(get("/v1/me").with(member)).andExpect(status().isOk());
        UUID memberUserId =
                jdbcTemplate.queryForObject(
                        "SELECT id FROM users WHERE email = ?",
                        UUID.class,
                        "m6-active-member-" + suffix + "@example.test");
        Instant now = Instant.now();
        jdbcTemplate.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'MEMBER', 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                UUID.randomUUID(),
                household,
                memberUserId,
                now,
                now,
                now);
        String csv =
                HEADER
                        + "\nMember private,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n";
        MvcResult uploaded =
                upload(owner, household, csv, "m6-member-upload-01")
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        String selectedId =
                jdbcTemplate.queryForObject(
                        """
                        SELECT id FROM commitment_import_items
                        WHERE import_job_id = ?
                        """,
                        UUID.class,
                        importId)
                        .toString();
        String confirmBody =
                objectMapper.writeValueAsString(
                        java.util.Map.of(
                                "selectedItemIds", List.of(selectedId)));

        mockMvc.perform(get("/v1/imports/{id}", importId).with(member))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .with(member)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-member-confirm-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmBody))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        delete("/v1/imports/{id}", importId)
                                .with(member)
                                .header(HttpHeaders.IF_MATCH, "\"0\""))
                .andExpect(status().isNotFound());
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "ROLE_GUIDE_ADMIN",
                "ROLE_PRIVACY_ADMIN",
                "ROLE_AUDIT_READ",
                "ROLE_SUPPORT_READ"
            })
    void staffOnlyRolesReceiveForbiddenAcrossImportRoutes(String role)
            throws Exception {
        JwtRequestPostProcessor staff = staffIdentity(role);
        UUID importId = UUID.randomUUID();
        UUID itemId = UUID.randomUUID();
        String body =
                objectMapper.writeValueAsString(
                        java.util.Map.of(
                                "selectedItemIds", List.of(itemId)));

        upload(
                        staff,
                        UUID.randomUUID(),
                        HEADER
                                + "\nDenied,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n",
                        "m6-staff-upload-" + role.toLowerCase())
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/v1/imports/{id}", importId).with(staff))
                .andExpect(status().isForbidden());
        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .with(staff)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-staff-confirm-"
                                                + role.toLowerCase())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isForbidden());
        mockMvc.perform(
                        delete("/v1/imports/{id}", importId)
                                .with(staff)
                                .header(HttpHeaders.IF_MATCH, "\"0\""))
                .andExpect(status().isForbidden());
    }

    @Test
    void unauthenticatedRequestsReceiveUnauthorizedAcrossImportRoutes()
            throws Exception {
        UUID importId = UUID.randomUUID();
        String body =
                objectMapper.writeValueAsString(
                        java.util.Map.of(
                                "selectedItemIds", List.of(UUID.randomUUID())));
        MockPart householdPart =
                new MockPart(
                        "householdId",
                        UUID.randomUUID()
                                .toString()
                                .getBytes(StandardCharsets.US_ASCII));
        householdPart.getHeaders().setContentType(MediaType.TEXT_PLAIN);
        MockPart file =
                new MockPart(
                        "file",
                        "controlled.csv",
                        (HEADER
                                        + "\nDenied,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n")
                                .getBytes(StandardCharsets.UTF_8));
        file.getHeaders().setContentType(MediaType.parseMediaType("text/csv"));

        mockMvc.perform(
                        multipart("/v1/imports")
                                .part(householdPart)
                                .part(file)
                                .contentType(SAFE_MULTIPART_FORM_DATA)
                                .header(
                                        "Idempotency-Key",
                                        "m6-anonymous-upload-01"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/v1/imports/{id}", importId))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-anonymous-confirm-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(
                        delete("/v1/imports/{id}", importId)
                                .header(HttpHeaders.IF_MATCH, "\"0\""))
                .andExpect(status().isUnauthorized());
    }

    private static <T> List<T> runInParallel(
            int callers, ThrowingSupplier<T> action) throws Exception {
        CountDownLatch ready = new CountDownLatch(callers);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(callers)) {
            List<Future<T>> futures =
                    java.util.stream.IntStream.range(0, callers)
                            .mapToObj(
                                    ignored ->
                                            executor.submit(
                                                    () -> {
                                                        ready.countDown();
                                                        start.await();
                                                        return action.get();
                                                    }))
                            .toList();
            ready.await();
            start.countDown();
            List<T> results = new java.util.ArrayList<>(callers);
            for (Future<T> future : futures) {
                results.add(future.get());
            }
            return List.copyOf(results);
        }
    }

    private MvcResult raceWithScheduledExpiry(
            ThrowingSupplier<MvcResult> request) throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<Void> expiry =
                    executor.submit(
                            () -> {
                                ready.countDown();
                                start.await();
                                importService.expireDueImports();
                                return null;
                            });
            Future<MvcResult> endpoint =
                    executor.submit(
                            () -> {
                                ready.countDown();
                                start.await();
                                return request.get();
                            });
            ready.await();
            start.countDown();
            expiry.get();
            return endpoint.get();
        }
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

    private void assertExpiredRaceOutcome(
            UUID importId, UUID householdId) {
        var job =
                jdbcTemplate.queryForMap(
                        """
                        SELECT status, raw_payload, raw_processed_at, expired_at,
                               optimistic_version, selected_item_count,
                               created_commitment_count
                        FROM commitment_import_jobs
                        WHERE id = ?
                        """,
                        importId);
        assertThat(job.get("status")).isEqualTo("EXPIRED");
        assertThat(job.get("raw_payload")).isNull();
        assertThat(job.get("raw_processed_at")).isNotNull();
        assertThat(job.get("expired_at")).isNotNull();
        assertThat(((Number) job.get("optimistic_version")).longValue())
                .isEqualTo(1);
        assertThat(((Number) job.get("selected_item_count")).intValue())
                .isZero();
        assertThat(((Number) job.get("created_commitment_count")).intValue())
                .isZero();
        assertThat(commitmentCount(householdId)).isZero();
        assertThat(
                        jdbcTemplate.queryForList(
                                """
                                SELECT action FROM audit_events
                                WHERE resource_type = 'IMPORT_JOB'
                                  AND resource_id = ?
                                ORDER BY occurred_at ASC, id ASC
                                """,
                                String.class,
                                importId))
                .containsExactly(
                        "IMPORT_PREVIEW_CREATED",
                        "IMPORT_PREVIEW_EXPIRED");
    }

    private int rateEventCount(String subject, String operation) {
        return jdbcTemplate.queryForObject(
                """
                SELECT count(*) FROM operation_rate_events
                WHERE actor_key = ? AND operation = ?
                """,
                Integer.class,
                OperationRateLimiter.actorKeyForSubject(subject),
                operation);
    }

    private org.springframework.test.web.servlet.ResultActions upload(
            JwtRequestPostProcessor owner,
            UUID household,
            String csv,
            String key)
            throws Exception {
        return uploadWith(
                owner, household, csv, "controlled.csv", "text/csv", key);
    }

    private org.springframework.test.web.servlet.ResultActions uploadWith(
            JwtRequestPostProcessor owner,
            UUID household,
            String csv,
            String filename,
            String mediaType,
            String key)
            throws Exception {
        MockPart householdPart =
                new MockPart(
                        "householdId",
                        household.toString().getBytes(StandardCharsets.US_ASCII));
        householdPart.getHeaders().setContentType(MediaType.TEXT_PLAIN);
        MockPart file =
                new MockPart(
                        "file",
                        filename,
                        csv.getBytes(StandardCharsets.UTF_8));
        file.getHeaders().setContentType(MediaType.parseMediaType(mediaType));
        return mockMvc.perform(
                multipart("/v1/imports")
                        .part(householdPart)
                        .part(file)
                        .contentType(SAFE_MULTIPART_FORM_DATA)
                        .with(owner)
                        .header("Idempotency-Key", key));
    }

    private UUID createHousehold(
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
        return UUID.fromString(
                JsonPath.read(result.getResponse().getContentAsString(), "$.id"));
    }

    private int commitmentCount(UUID householdId) {
        return jdbcTemplate.queryForObject(
                "SELECT count(*) FROM recurring_commitments WHERE household_id = ?",
                Integer.class,
                householdId);
    }

    private byte[] rawPayload(UUID importId) {
        return jdbcTemplate.queryForObject(
                "SELECT raw_payload FROM commitment_import_jobs WHERE id = ?",
                byte[].class,
                importId);
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

    private static JwtRequestPostProcessor staffIdentity(String role) {
        String suffix = role.toLowerCase() + "-" + UUID.randomUUID();
        return jwt()
                .jwt(
                        token ->
                                token.subject("m6-staff-" + suffix)
                                        .claim(
                                                "email",
                                                "m6-staff-"
                                                        + suffix
                                                        + "@example.test")
                                        .claim("name", "M6 Staff"))
                .authorities(
                        new org.springframework.security.core.authority.SimpleGrantedAuthority(
                                role));
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws Exception;
    }

    private record PoolUploadFixture(
            JwtRequestPostProcessor owner,
            UUID householdId,
            String subject,
            int index) {}
}
