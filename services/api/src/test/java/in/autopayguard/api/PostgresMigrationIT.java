package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockPart;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Testcontainers(disabledWithoutDocker = true)
class PostgresMigrationIT {

    @Container
    static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer("postgres:18.4-alpine")
                    .withDatabaseName("autopay_guard")
                    .withUsername("autopay_guard_test")
                    .withPassword("fake-test-password");

    @Autowired private Flyway flyway;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private MockMvc mockMvc;

    @DynamicPropertySource
    static void registerPostgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
    }

    @Test
    void v6MigratesAnEmptyPostgres18Database() throws SQLException {
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("6");

        try (Connection connection = POSTGRES.createConnection("")) {
            DatabaseMetaData metadata = connection.getMetaData();
            assertThat(metadata.getDatabaseMajorVersion()).isEqualTo(18);
            assertThat(publicDomainTables(metadata))
                    .containsExactlyInAnyOrder(
                            "users",
                            "households",
                            "merchants",
                            "merchant_aliases",
                            "recurring_commitments",
                            "commitment_occurrences",
                            "notification_preferences",
                            "reminder_rule_sets",
                            "reminder_rules",
                            "notifications",
                            "notification_deliveries",
                            "outbox_events",
                            "idempotency_records",
                            "occurrence_decisions",
                            "cancellation_target_allowlist",
                            "cancellation_target_locks",
                            "cancellation_guides",
                            "cancellation_guide_locks",
                            "cancellation_guide_versions",
                            "cancellation_published_version_locks",
                            "cancellation_guide_steps",
                            "cancellation_published_step_locks",
                            "cancellation_published_target_locks",
                            "cancellation_attempts",
                            "cancellation_attempt_verifications",
                            "savings_events",
                            "cancellation_guide_feedback",
                            "household_members",
                            "household_invitations",
                            "privacy_notice_acknowledgements",
                            "privacy_notice_acknowledgement_locks",
                            "consent_events",
                            "consent_event_locks",
                            "privacy_requests",
                            "privacy_request_events",
                            "privacy_request_event_locks",
                            "privacy_export_artifacts",
                            "deletion_tombstones",
                            "cancellation_guide_catalog_state",
                            "cancellation_guide_draft_states",
                            "guide_lifecycle_events",
                            "guide_lifecycle_event_locks",
                            "guide_feedback_reviews",
                            "audit_events",
                            "audit_event_locks",
                            "support_diagnostic_grants",
                            "m5_idempotency_records",
                            "operation_rate_events",
                            "commitment_import_jobs",
                            "commitment_import_items",
                            "commitment_import_item_errors",
                            "operation_rate_locks");
            assertThat(foreignKeys(metadata, "households"))
                    .contains("fk_households_owner");
            assertThat(foreignKeys(metadata, "recurring_commitments"))
                    .contains(
                            "fk_recurring_commitments_household",
                            "fk_recurring_commitments_merchant",
                            "fk_recurring_commitments_import_job",
                            "fk_recurring_commitments_import_item");
            assertThat(foreignKeys(metadata, "commitment_occurrences"))
                    .contains("fk_commitment_occurrences_commitment");
            assertThat(foreignKeys(metadata, "notification_preferences"))
                    .contains("fk_notification_preferences_user");
            assertThat(foreignKeys(metadata, "reminder_rule_sets"))
                    .contains(
                            "fk_reminder_rule_sets_household",
                            "fk_reminder_rule_sets_commitment");
            assertThat(foreignKeys(metadata, "notification_deliveries"))
                    .contains("fk_notification_deliveries_notification");
            assertThat(foreignKeys(metadata, "outbox_events"))
                    .contains("fk_outbox_events_delivery");
            assertThat(foreignKeys(metadata, "household_members"))
                    .contains(
                            "fk_household_members_household",
                            "fk_household_members_user");
            assertThat(foreignKeys(metadata, "privacy_export_artifacts"))
                    .contains(
                            "fk_privacy_export_artifacts_request",
                            "fk_privacy_export_artifacts_requester");
            assertThat(foreignKeys(metadata, "support_diagnostic_grants"))
                    .contains("fk_support_diagnostic_grants_owner_household");
            assertThat(foreignKeys(metadata, "commitment_import_jobs"))
                    .contains("fk_commitment_import_jobs_owner_household");
            assertThat(foreignKeys(metadata, "commitment_import_items"))
                    .contains(
                            "fk_commitment_import_items_job",
                            "fk_commitment_import_items_merchant",
                            "fk_commitment_import_items_created_commitment");
            assertThat(foreignKeys(metadata, "commitment_import_item_errors"))
                    .contains("fk_commitment_import_item_errors_item");
            assertThat(columns(metadata, "recurring_commitments"))
                    .contains(
                            "import_job_id",
                            "import_item_id",
                            "import_fingerprint");
        }
    }

    @Test
    void postgresImportDuplicateUsesAuthoritativeNextDueInsteadOfHistoricalLastDayAnchor()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-postgres-existing-owner",
                        "m6-postgres-existing-owner@example.test",
                        "Postgres Existing Owner");
        UUID householdId =
                createHousehold(owner, "M6 Postgres existing household");
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
                                                  "displayName": "Postgres exact existing",
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
                                                        .formatted(householdId)))
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
        mockMvc.perform(
                        get("/v1/commitments/{id}", commitmentId).with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.anchorDate").value("2024-01-31"))
                .andExpect(jsonPath("$.monthDayPolicy").value("LAST_DAY"))
                .andExpect(jsonPath("$.nextDueDate").value("2026-07-31"));

        String header =
                "name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label";
        String csv =
                header
                        + "\nPostgres exact existing,OTHER,10,INR,MONTHLY,2026-07-31,UNKNOWN,\n"
                        + "Postgres exact existing,OTHER,10,INR,MONTHLY,2026-07-31,UNKNOWN,\n"
                        + "Postgres exact existing,OTHER,10,INR,MONTHLY,2024-01-31,UNKNOWN,\n";
        MockPart householdPart =
                new MockPart(
                        "householdId",
                        householdId
                                .toString()
                                .getBytes(StandardCharsets.US_ASCII));
        householdPart.getHeaders().setContentType(MediaType.TEXT_PLAIN);
        MockPart file =
                new MockPart(
                        "file",
                        "controlled.csv",
                        csv.getBytes(StandardCharsets.UTF_8));
        file.getHeaders().setContentType(MediaType.parseMediaType("text/csv"));
        MvcResult uploaded =
                mockMvc.perform(
                                multipart("/v1/imports")
                                        .part(householdPart)
                                        .part(file)
                                        .contentType(
                                                MediaType.parseMediaType(
                                                        "multipart/form-data;boundary=AutopayGuardM6PostgresBoundary"))
                                        .with(owner)
                                        .header(
                                                "Idempotency-Key",
                                                "m6-postgres-existing-key-001"))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.totalItemCount").value(3))
                        .andExpect(jsonPath("$.validItemCount").value(3))
                        .andExpect(jsonPath("$.duplicateItemCount").value(2))
                        .andReturn();
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        mockMvc.perform(get("/v1/imports/{id}", importId).with(owner))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.items[0].duplicateKind")
                                .value("EXISTING"))
                .andExpect(
                        jsonPath("$.items[1].duplicateKind")
                                .value("EXISTING"))
                .andExpect(jsonPath("$.items[2].duplicateKind").value("NONE"));
    }

    @Test
    void upgradesARealV1PostgresSnapshotAndPreservesRowsAndChecksum() {
        String schema = "upgrade_" + UUID.randomUUID().toString().replace("-", "");
        String baseUrl = POSTGRES.getJdbcUrl();
        String url =
                baseUrl
                        + (baseUrl.contains("?") ? "&" : "?")
                        + "currentSchema="
                        + schema;
        DriverManagerDataSource dataSource =
                new DriverManagerDataSource(
                        url, POSTGRES.getUsername(), POSTGRES.getPassword());
        Flyway v1 =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .target("1")
                        .load();
        v1.migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Integer v1Checksum =
                jdbc.queryForObject(
                        """
                        SELECT checksum
                        FROM flyway_schema_history
                        WHERE version = '1'
                        """,
                        Integer.class);

        UUID userId = UUID.fromString("50000000-0000-4000-8000-000000000001");
        UUID householdId = UUID.fromString("60000000-0000-4000-8000-000000000001");
        OffsetDateTime timestamp =
                OffsetDateTime.of(2026, 7, 1, 8, 30, 0, 0, ZoneOffset.UTC);
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at, privacy_notice_version,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                userId,
                "postgres-v1-subject",
                "postgres-v1@example.test",
                "Postgres V1 User",
                "Asia/Kolkata",
                "en-IN",
                timestamp,
                timestamp,
                "foundation-v1",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                householdId,
                "Postgres V1 household",
                userId,
                "INR",
                "Asia/Kolkata",
                timestamp,
                timestamp);

        Flyway latest =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .load();
        latest.migrate();

        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("6");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT checksum FROM flyway_schema_history WHERE version = '1'",
                                Integer.class))
                .isEqualTo(v1Checksum);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT oidc_subject FROM users WHERE id = ?",
                                String.class,
                                userId))
                .isEqualTo("postgres-v1-subject");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT name FROM households WHERE id = ?",
                                String.class,
                                householdId))
                .isEqualTo("Postgres V1 household");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM recurring_commitments",
                                Integer.class))
                .isZero();
        assertThat(
                        jdbc.queryForList(
                                "SELECT website_host FROM merchants ORDER BY id",
                                String.class))
                .startsWith(
                        "streambox.example", "cloudnest.example", "fitclub.example")
                .hasSize(20);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notification_preferences",
                                Integer.class))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications", Integer.class))
                .isZero();
        assertNoV6OperationalRows(jdbc);
    }

    @Test
    void upgradesARealV2PostgresSnapshotWithoutOptInAndPreservesChecksums() {
        String schema = "upgrade_v2_" + UUID.randomUUID().toString().replace("-", "");
        String baseUrl = POSTGRES.getJdbcUrl();
        String url =
                baseUrl
                        + (baseUrl.contains("?") ? "&" : "?")
                        + "currentSchema="
                        + schema;
        DriverManagerDataSource dataSource =
                new DriverManagerDataSource(
                        url, POSTGRES.getUsername(), POSTGRES.getPassword());
        Flyway v2 =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .target("2")
                        .load();
        v2.migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Integer v1Checksum =
                jdbc.queryForObject(
                        "SELECT checksum FROM flyway_schema_history WHERE version = '1'",
                        Integer.class);
        Integer v2Checksum =
                jdbc.queryForObject(
                        "SELECT checksum FROM flyway_schema_history WHERE version = '2'",
                        Integer.class);

        UUID userId = UUID.fromString("81000000-0000-4000-8000-000000000001");
        UUID householdId = UUID.fromString("82000000-0000-4000-8000-000000000001");
        UUID commitmentId = UUID.fromString("83000000-0000-4000-8000-000000000001");
        OffsetDateTime timestamp =
                OffsetDateTime.of(2026, 7, 2, 8, 30, 0, 0, ZoneOffset.UTC);
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at, privacy_notice_version,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                userId,
                "postgres-v2-subject",
                "postgres-v2@example.test",
                "Postgres V2 User",
                "Asia/Kolkata",
                "en-IN",
                timestamp,
                timestamp,
                "foundation-v1",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                householdId,
                "Postgres V2 household",
                userId,
                "INR",
                "Asia/Kolkata",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO recurring_commitments (
                    id, household_id, merchant_id, display_name, category, payment_rail,
                    amount_minor, estimated_amount_minor, currency, frequency, interval_count,
                    custom_interval_unit, anchor_date, month_day_policy, next_due_date,
                    variable_amount, masked_payment_label, source, source_confidence,
                    visibility, status, optimistic_version, created_at, updated_at
                ) VALUES (
                    ?, ?, NULL, ?, 'SUBSCRIPTION', 'CARD_RECURRING',
                    999, NULL, 'INR', 'MONTHLY', 1,
                    NULL, ?, 'ANCHOR_DAY', ?,
                    FALSE, NULL, 'MANUAL', NULL,
                    'PRIVATE', 'ACTIVE', 0, ?, ?
                )
                """,
                commitmentId,
                householdId,
                "Postgres V2 commitment",
                LocalDate.of(2026, 7, 10),
                LocalDate.of(2026, 8, 10),
                timestamp,
                timestamp);

        Flyway latest =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .load();
        latest.migrate();

        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("6");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT checksum FROM flyway_schema_history WHERE version = '1'",
                                Integer.class))
                .isEqualTo(v1Checksum);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT checksum FROM flyway_schema_history WHERE version = '2'",
                                Integer.class))
                .isEqualTo(v2Checksum);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT display_name FROM recurring_commitments WHERE id = ?",
                                String.class,
                                commitmentId))
                .isEqualTo("Postgres V2 commitment");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notification_preferences",
                                Integer.class))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM reminder_rule_sets",
                                Integer.class))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM outbox_events", Integer.class))
                .isZero();
        assertNoV6OperationalRows(jdbc);
    }

    @Test
    void upgradesARealV3PostgresSnapshotAndLocksPublishedCatalogHistory() {
        String schema = "upgrade_v3_" + UUID.randomUUID().toString().replace("-", "");
        String baseUrl = POSTGRES.getJdbcUrl();
        String url =
                baseUrl
                        + (baseUrl.contains("?") ? "&" : "?")
                        + "currentSchema="
                        + schema;
        DriverManagerDataSource dataSource =
                new DriverManagerDataSource(
                        url, POSTGRES.getUsername(), POSTGRES.getPassword());
        Flyway v3 =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .target("3")
                        .load();
        v3.migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Map<String, Integer> priorChecksums =
                jdbc.query(
                                """
                                SELECT version, checksum
                                FROM flyway_schema_history
                                WHERE version IN ('1', '2', '3')
                                ORDER BY version
                                """,
                                (row, ignored) ->
                                        Map.entry(
                                                row.getString("version"),
                                                row.getInt("checksum")))
                        .stream()
                        .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

        UUID userId = UUID.fromString("94000000-0000-4000-8000-000000000001");
        UUID householdId =
                UUID.fromString("95000000-0000-4000-8000-000000000001");
        UUID preferenceId =
                UUID.fromString("96000000-0000-4000-8000-000000000001");
        UUID ruleSetId =
                UUID.fromString("97000000-0000-4000-8000-000000000001");
        UUID ruleId = UUID.fromString("98000000-0000-4000-8000-000000000001");
        OffsetDateTime timestamp =
                OffsetDateTime.of(2026, 7, 27, 8, 30, 0, 0, ZoneOffset.UTC);
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at,
                    privacy_notice_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                userId,
                "postgres-v3-subject",
                "postgres-v3@example.test",
                "Postgres V3 User",
                "Asia/Kolkata",
                "en-IN",
                timestamp,
                timestamp,
                "foundation-v1",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                householdId,
                "Postgres V3 household",
                userId,
                "INR",
                "Asia/Kolkata",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO notification_preferences (
                    id, user_id, enabled, in_app_enabled, email_enabled,
                    timezone, quiet_hours_enabled, quiet_start, quiet_end,
                    enabled_at, in_app_enabled_at, email_enabled_at,
                    optimistic_version, created_at, updated_at
                ) VALUES (
                    ?, ?, TRUE, TRUE, FALSE, ?, FALSE, NULL, NULL,
                    ?, ?, NULL, 1, ?, ?
                )
                """,
                preferenceId,
                userId,
                "Asia/Kolkata",
                timestamp,
                timestamp,
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO reminder_rule_sets (
                    id, household_id, commitment_id, scope_type,
                    scope_reference_id, mode, activated_at, optimistic_version,
                    created_at, updated_at
                ) VALUES (?, ?, NULL, 'HOUSEHOLD', ?, 'CUSTOM', ?, 1, ?, ?)
                """,
                ruleSetId,
                householdId,
                householdId,
                timestamp,
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO reminder_rules (
                    id, rule_set_id, channel, offset_days, local_send_time,
                    enabled, activated_at, created_at, updated_at
                ) VALUES (?, ?, 'IN_APP', 3, TIME '09:00:00', TRUE, ?, ?, ?)
                """,
                ruleId,
                ruleSetId,
                timestamp,
                timestamp,
                timestamp);

        Flyway latest =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .load();
        latest.migrate();

        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("6");
        assertThat(
                        jdbc.query(
                                        """
                                        SELECT version, checksum
                                        FROM flyway_schema_history
                                        WHERE version IN ('1', '2', '3')
                                        ORDER BY version
                                        """,
                                        (row, ignored) ->
                                                Map.entry(
                                                        row.getString("version"),
                                                        row.getInt("checksum")))
                                .stream()
                                .collect(
                                        Collectors.toMap(
                                                Map.Entry::getKey,
                                                Map.Entry::getValue)))
                .isEqualTo(priorChecksums);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT timezone FROM notification_preferences WHERE id = ?",
                                String.class,
                                preferenceId))
                .isEqualTo("Asia/Kolkata");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT offset_days FROM reminder_rules WHERE id = ?",
                                Integer.class,
                                ruleId))
                .isEqualTo(3);
        for (String table :
                List.of(
                        "idempotency_records",
                        "occurrence_decisions",
                        "cancellation_attempts",
                        "cancellation_attempt_verifications",
                        "savings_events",
                        "cancellation_guide_feedback")) {
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM " + table, Integer.class))
                    .as(table + " remains empty")
                    .isZero();
        }
        assertNoV6OperationalRows(jdbc);

        UUID guideId = UUID.fromString("40000000-0000-4000-8000-000000000001");
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        UPDATE cancellation_guide_versions
                                        SET risk_notice = 'Postgres overwrite'
                                        WHERE guide_id = ? AND version = 1
                                        """,
                                        guideId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        UPDATE cancellation_guide_steps
                                        SET instruction = 'Postgres overwrite'
                                        WHERE guide_id = ?
                                          AND guide_version = 1
                                          AND track = 'SERVICE'
                                          AND sequence_number = 1
                                        """,
                                        guideId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        UPDATE cancellation_target_allowlist
                                        SET host = 'evil.example'
                                        WHERE target_key = 'https-streambox-example'
                                        """))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        INSERT INTO cancellation_guide_steps (
                                            guide_id, guide_version, track,
                                            sequence_number, action_type, title,
                                            instruction, target_key, target_uri
                                        ) VALUES (
                                            ?, 1, 'SERVICE', 3, 'INFORMATION',
                                            'Injected third step',
                                            'Postgres must reject this insert.',
                                            NULL, NULL
                                        )
                                        """,
                                        guideId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void upgradesARealV4PostgresSnapshotWithPrivateOwnerBackfillsOnly() {
        String schema =
                "upgrade_v4_" + UUID.randomUUID().toString().replace("-", "");
        String baseUrl = POSTGRES.getJdbcUrl();
        String url =
                baseUrl
                        + (baseUrl.contains("?") ? "&" : "?")
                        + "currentSchema="
                        + schema;
        DriverManagerDataSource dataSource =
                new DriverManagerDataSource(
                        url, POSTGRES.getUsername(), POSTGRES.getPassword());
        Flyway v4 =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .target("4")
                        .load();
        v4.migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Map<String, Integer> priorChecksums =
                jdbc.query(
                                """
                                SELECT version, checksum
                                FROM flyway_schema_history
                                WHERE version IN ('1', '2', '3', '4')
                                ORDER BY version
                                """,
                                (row, ignored) ->
                                        Map.entry(
                                                row.getString("version"),
                                                row.getInt("checksum")))
                        .stream()
                        .collect(
                                Collectors.toMap(
                                        Map.Entry::getKey,
                                        Map.Entry::getValue));

        UUID userId =
                UUID.fromString("a1000000-0000-4000-8000-000000000001");
        UUID householdId =
                UUID.fromString("a2000000-0000-4000-8000-000000000001");
        UUID commitmentId =
                UUID.fromString("a3000000-0000-4000-8000-000000000001");
        OffsetDateTime timestamp =
                OffsetDateTime.of(2026, 7, 27, 8, 30, 0, 0, ZoneOffset.UTC);
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at,
                    privacy_notice_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                userId,
                "postgres-v4-subject",
                "postgres-v4@example.test",
                "Postgres V4 User",
                "Asia/Kolkata",
                "en-IN",
                timestamp,
                timestamp,
                "foundation-v1",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                householdId,
                "Postgres V4 household",
                userId,
                "INR",
                "Asia/Kolkata",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO recurring_commitments (
                    id, household_id, merchant_id, display_name, category,
                    payment_rail, amount_minor, estimated_amount_minor, currency,
                    frequency, interval_count, custom_interval_unit, anchor_date,
                    month_day_policy, next_due_date, variable_amount,
                    masked_payment_label, source, source_confidence, visibility,
                    status, optimistic_version, created_at, updated_at
                ) VALUES (
                    ?, ?, NULL, ?, 'SUBSCRIPTION', 'UNKNOWN',
                    27500, NULL, 'INR', 'MONTHLY', 1, NULL, ?,
                    'ANCHOR_DAY', ?, FALSE, NULL, 'MANUAL', NULL, 'PRIVATE',
                    'ACTIVE', 2, ?, ?
                )
                """,
                commitmentId,
                householdId,
                "Existing private V4 commitment",
                LocalDate.of(2026, 7, 27),
                LocalDate.of(2026, 8, 27),
                timestamp,
                timestamp);

        Flyway latest =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .load();
        latest.migrate();

        assertThat(latest.info().current().getVersion().getVersion())
                .isEqualTo("6");
        assertThat(
                        jdbc.query(
                                        """
                                        SELECT version, checksum
                                        FROM flyway_schema_history
                                        WHERE version IN ('1', '2', '3', '4')
                                        ORDER BY version
                                        """,
                                        (row, ignored) ->
                                                Map.entry(
                                                        row.getString("version"),
                                                        row.getInt("checksum")))
                                .stream()
                                .collect(
                                        Collectors.toMap(
                                                Map.Entry::getKey,
                                                Map.Entry::getValue)))
                .isEqualTo(priorChecksums);
        assertThat(
                        jdbc.queryForMap(
                                """
                                SELECT household_id, user_id, role, status
                                FROM household_members
                                WHERE household_id = ?
                                """,
                                householdId))
                .containsEntry("household_id", householdId)
                .containsEntry("user_id", userId)
                .containsEntry("role", "OWNER")
                .containsEntry("status", "ACTIVE");
        assertThat(
                        jdbc.queryForMap(
                                """
                                SELECT data_owner_user_id, responsible_member_id,
                                       visibility
                                FROM recurring_commitments
                                WHERE id = ?
                                """,
                                commitmentId))
                .containsEntry("data_owner_user_id", userId)
                .containsEntry("responsible_member_id", null)
                .containsEntry("visibility", "PRIVATE");
        Map<String, Object> acknowledgement =
                jdbc.queryForMap(
                        """
                        SELECT user_id, notice_version, event_type,
                               content_digest, acknowledged_at
                        FROM privacy_notice_acknowledgements
                        WHERE user_id = ?
                        """,
                        userId);
        assertThat(acknowledgement)
                .containsEntry("user_id", userId)
                .containsEntry("notice_version", "foundation-v1")
                .containsEntry("event_type", "ACKNOWLEDGED")
                .containsEntry(
                        "content_digest",
                        "f44a66e435a10f110c1b2eff19abcf60f4978053205c9068c08c6a8bae74b244");
        assertThat(
                        ((java.sql.Timestamp)
                                        acknowledgement.get("acknowledged_at"))
                                .toInstant())
                .isEqualTo(timestamp.toInstant());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM cancellation_guide_catalog_state",
                                Integer.class))
                .isEqualTo(20);
        for (String table :
                List.of(
                        "household_invitations",
                        "consent_events",
                        "privacy_requests",
                        "privacy_export_artifacts",
                        "audit_events",
                        "support_diagnostic_grants",
                        "cancellation_guide_draft_states",
                        "guide_feedback_reviews",
                        "m5_idempotency_records",
                        "operation_rate_events",
                        "commitment_import_jobs",
                        "commitment_import_items",
                        "commitment_import_item_errors",
                        "operation_rate_locks")) {
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM " + table, Integer.class))
                    .as(table + " has no inferred operational rows")
                    .isZero();
        }
        assertNoV6OperationalRows(jdbc);
    }

    @Test
    void upgradesARealPopulatedV5PostgresSnapshotWithoutInferringImports() {
        String schema =
                "upgrade_v5_" + UUID.randomUUID().toString().replace("-", "");
        String baseUrl = POSTGRES.getJdbcUrl();
        String url =
                baseUrl
                        + (baseUrl.contains("?") ? "&" : "?")
                        + "currentSchema="
                        + schema;
        DriverManagerDataSource dataSource =
                new DriverManagerDataSource(
                        url, POSTGRES.getUsername(), POSTGRES.getPassword());
        Flyway v5 =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .target("5")
                        .load();
        v5.migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Map<String, Integer> priorChecksums =
                jdbc.query(
                                """
                                SELECT version, checksum
                                FROM flyway_schema_history
                                WHERE version IN ('1', '2', '3', '4', '5')
                                ORDER BY version
                                """,
                                (row, ignored) ->
                                        Map.entry(
                                                row.getString("version"),
                                                row.getInt("checksum")))
                        .stream()
                        .collect(
                                Collectors.toMap(
                                        Map.Entry::getKey,
                                        Map.Entry::getValue));

        UUID userId =
                UUID.fromString("b1000000-0000-4000-8000-000000000001");
        UUID householdId =
                UUID.fromString("b2000000-0000-4000-8000-000000000001");
        UUID commitmentId =
                UUID.fromString("b3000000-0000-4000-8000-000000000001");
        UUID rateEventId =
                UUID.fromString("b4000000-0000-4000-8000-000000000001");
        OffsetDateTime timestamp =
                OffsetDateTime.of(2026, 7, 29, 12, 0, 0, 0, ZoneOffset.UTC);
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at,
                    privacy_notice_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'Asia/Kolkata', 'en-IN', ?, ?, ?, ?, ?)
                """,
                userId,
                "postgres-v5-subject",
                "postgres-v5@example.test",
                "Postgres V5 User",
                timestamp,
                timestamp,
                "foundation-v1",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone,
                    created_at, updated_at
                ) VALUES (?, 'Postgres V5 household', ?, 'INR',
                          'Asia/Kolkata', ?, ?)
                """,
                householdId,
                userId,
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'OWNER', 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                UUID.fromString("b5000000-0000-4000-8000-000000000001"),
                householdId,
                userId,
                timestamp,
                timestamp,
                timestamp);
        jdbc.update(
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
                    ?, ?, ?, NULL, NULL, 'Existing Postgres V5 commitment',
                    'SUBSCRIPTION', 'UNKNOWN', 27500, NULL, 'INR',
                    'MONTHLY', 1, NULL, ?, 'ANCHOR_DAY', ?,
                    FALSE, NULL, 'MANUAL', NULL, 'PRIVATE', 'ACTIVE',
                    4, ?, ?
                )
                """,
                commitmentId,
                householdId,
                userId,
                LocalDate.of(2026, 7, 29),
                LocalDate.of(2026, 8, 29),
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO m5_idempotency_records (
                    actor_user_id, operation, key_hash, request_hash,
                    resource_id, response_status, response_body,
                    response_version, created_at
                ) VALUES (?, 'CONSENT_EVENT', ?, ?, ?, 201, ?, 4, ?)
                """,
                userId,
                "1".repeat(64),
                "2".repeat(64),
                commitmentId,
                "{\"fixture\":\"v5\"}",
                timestamp);
        jdbc.update(
                """
                INSERT INTO operation_rate_events (
                    id, actor_key, operation, occurred_at
                ) VALUES (?, ?, 'SUPPORT_DIAGNOSTIC', ?)
                """,
                rateEventId,
                "3".repeat(64),
                timestamp);

        Map<String, Object> commitmentBefore =
                jdbc.queryForMap(
                        """
                        SELECT household_id, data_owner_user_id, display_name,
                               amount_minor, source, visibility, status,
                               optimistic_version, created_at, updated_at
                        FROM recurring_commitments
                        WHERE id = ?
                        """,
                        commitmentId);
        Map<String, Object> idempotencyBefore =
                jdbc.queryForMap(
                        """
                        SELECT actor_user_id, operation, key_hash, request_hash,
                               resource_id, response_status, response_body,
                               response_version, created_at
                        FROM m5_idempotency_records
                        WHERE actor_user_id = ? AND operation = 'CONSENT_EVENT'
                        """,
                        userId);
        Map<String, Object> rateBefore =
                jdbc.queryForMap(
                        """
                        SELECT id, actor_key, operation, occurred_at
                        FROM operation_rate_events
                        WHERE id = ?
                        """,
                        rateEventId);

        Flyway latest =
                Flyway.configure()
                        .dataSource(dataSource)
                        .schemas(schema)
                        .defaultSchema(schema)
                        .locations("classpath:db/migration")
                        .load();
        latest.migrate();

        assertThat(latest.info().current().getVersion().getVersion())
                .isEqualTo("6");
        assertThat(
                        jdbc.query(
                                        """
                                        SELECT version, checksum
                                        FROM flyway_schema_history
                                        WHERE version IN ('1', '2', '3', '4', '5')
                                        ORDER BY version
                                        """,
                                        (row, ignored) ->
                                                Map.entry(
                                                        row.getString("version"),
                                                        row.getInt("checksum")))
                                .stream()
                                .collect(
                                        Collectors.toMap(
                                                Map.Entry::getKey,
                                                Map.Entry::getValue)))
                .isEqualTo(priorChecksums);
        assertThat(
                        jdbc.queryForMap(
                                """
                                SELECT household_id, data_owner_user_id,
                                       display_name, amount_minor, source,
                                       visibility, status, optimistic_version,
                                       created_at, updated_at
                                FROM recurring_commitments
                                WHERE id = ?
                                """,
                                commitmentId))
                .isEqualTo(commitmentBefore);
        assertThat(
                        jdbc.queryForMap(
                                """
                                SELECT actor_user_id, operation, key_hash,
                                       request_hash, resource_id,
                                       response_status, response_body,
                                       response_version, created_at
                                FROM m5_idempotency_records
                                WHERE actor_user_id = ?
                                  AND operation = 'CONSENT_EVENT'
                                """,
                                userId))
                .isEqualTo(idempotencyBefore);
        assertThat(
                        jdbc.queryForMap(
                                """
                                SELECT id, actor_key, operation, occurred_at
                                FROM operation_rate_events
                                WHERE id = ?
                                """,
                                rateEventId))
                .isEqualTo(rateBefore);
        assertThat(
                        jdbc.queryForMap(
                                """
                                SELECT source, import_job_id, import_item_id,
                                       import_fingerprint
                                FROM recurring_commitments
                                WHERE id = ?
                                """,
                                commitmentId))
                .containsEntry("source", "MANUAL")
                .containsEntry("import_job_id", null)
                .containsEntry("import_item_id", null)
                .containsEntry("import_fingerprint", null);
        assertNoV6OperationalRows(jdbc);

        Set<String> v6ForeignKeys =
                new HashSet<>(
                        jdbc.queryForList(
                                """
                                SELECT constraint_name
                                FROM information_schema.table_constraints
                                WHERE table_schema = ?
                                  AND constraint_type = 'FOREIGN KEY'
                                  AND table_name IN (
                                    'commitment_import_jobs',
                                    'commitment_import_items',
                                    'commitment_import_item_errors',
                                    'recurring_commitments'
                                  )
                                """,
                                String.class,
                                schema));
        assertThat(v6ForeignKeys)
                .contains(
                        "fk_commitment_import_jobs_owner_household",
                        "fk_commitment_import_items_job",
                        "fk_commitment_import_items_merchant",
                        "fk_commitment_import_items_created_commitment",
                        "fk_commitment_import_item_errors_item",
                        "fk_recurring_commitments_import_job",
                        "fk_recurring_commitments_import_item");

        jdbc.update(
                """
                INSERT INTO m5_idempotency_records (
                    actor_user_id, operation, key_hash, request_hash,
                    resource_id, response_status, response_body,
                    response_version, created_at
                ) VALUES (?, 'IMPORT_CREATE', ?, ?, ?, 201, NULL, 0, ?)
                """,
                userId,
                "4".repeat(64),
                "5".repeat(64),
                commitmentId,
                timestamp.plusMinutes(1));
        jdbc.update(
                """
                INSERT INTO operation_rate_events (
                    id, actor_key, operation, occurred_at
                ) VALUES (?, ?, 'IMPORT_CONFIRM', ?)
                """,
                UUID.fromString("b6000000-0000-4000-8000-000000000001"),
                "6".repeat(64),
                timestamp.plusMinutes(1));

        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        INSERT INTO commitment_import_jobs (
                                            id, household_id, owner_user_id,
                                            status, raw_payload,
                                            raw_byte_count,
                                            content_fingerprint,
                                            preview_expires_at,
                                            raw_processed_at,
                                            total_item_count, valid_item_count,
                                            invalid_item_count,
                                            duplicate_item_count,
                                            selected_item_count,
                                            created_commitment_count,
                                            optimistic_version, confirmed_at,
                                            discarded_at, expired_at,
                                            created_at, updated_at
                                        ) VALUES (
                                            ?, ?, ?, 'PREVIEW_READY', NULL, 1,
                                            ?, ?, ?, 1, 1, 0, 0, 0, 0, 0,
                                            NULL, NULL, NULL, ?, ?
                                        )
                                        """,
                                        UUID.randomUUID(),
                                        householdId,
                                        UUID.randomUUID(),
                                        "7".repeat(64),
                                        timestamp.plusHours(1),
                                        timestamp,
                                        timestamp,
                                        timestamp))
                .isInstanceOf(DataIntegrityViolationException.class);

        UUID importId =
                UUID.fromString("b7000000-0000-4000-8000-000000000001");
        jdbc.update(
                """
                INSERT INTO commitment_import_jobs (
                    id, household_id, owner_user_id, status, raw_payload,
                    raw_byte_count, content_fingerprint,
                    preview_expires_at,
                    raw_processed_at, total_item_count, valid_item_count,
                    invalid_item_count, duplicate_item_count,
                    selected_item_count, created_commitment_count,
                    optimistic_version, confirmed_at, discarded_at,
                    expired_at, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 'PREVIEW_READY', NULL, 1, ?, ?, ?,
                    1, 1, 0, 0, 0, 0, 0, NULL, NULL, NULL, ?, ?
                )
                """,
                importId,
                householdId,
                userId,
                "8".repeat(64),
                timestamp.plusHours(1),
                timestamp,
                timestamp,
                timestamp);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        UPDATE commitment_import_jobs
                                        SET raw_payload = ?
                                        WHERE id = ?
                                        """,
                                        new byte[] {1},
                                        importId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        INSERT INTO commitment_import_jobs (
                                            id, household_id, owner_user_id,
                                            status, raw_payload,
                                            raw_byte_count,
                                            content_fingerprint,
                                            preview_expires_at,
                                            raw_processed_at,
                                            total_item_count, valid_item_count,
                                            invalid_item_count,
                                            duplicate_item_count,
                                            selected_item_count,
                                            created_commitment_count,
                                            optimistic_version,
                                            confirmed_at, discarded_at,
                                            expired_at, created_at, updated_at
                                        ) VALUES (
                                            ?, ?, ?, 'DISCARDED', ?, 1,
                                            ?, ?, ?, 1, 1, 0, 0, 0, 0, 1,
                                            NULL, ?, NULL, ?, ?
                                        )
                                        """,
                                        UUID.randomUUID(),
                                        householdId,
                                        userId,
                                        new byte[] {1},
                                        "a".repeat(64),
                                        timestamp.plusHours(1),
                                        timestamp,
                                        timestamp,
                                        timestamp,
                                        timestamp))
                .isInstanceOf(DataIntegrityViolationException.class);
        UUID resultItemId = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO commitment_import_items (
                    id, import_job_id, row_number, valid, duplicate_kind,
                    schedule_fingerprint, name, category, amount_minor,
                    currency, frequency, next_due_date, month_day_policy,
                    payment_rail, masked_payment_label, merchant_id,
                    selected, created_commitment_id, created_at, updated_at
                ) VALUES (
                    ?, ?, 3, TRUE, 'NONE', ?, 'Result fixture', 'OTHER',
                    100, 'INR', 'MONTHLY', ?, 'ANCHOR_DAY', 'UNKNOWN',
                    NULL, NULL, NULL, NULL, ?, ?
                )
                """,
                resultItemId,
                importId,
                "b".repeat(64),
                LocalDate.of(2026, 8, 1),
                timestamp,
                timestamp);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        UPDATE commitment_import_items
                                        SET selected = TRUE
                                        WHERE id = ?
                                        """,
                                        resultItemId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        INSERT INTO commitment_import_items (
                                            id, import_job_id, row_number,
                                            valid, duplicate_kind,
                                            schedule_fingerprint, name,
                                            category, amount_minor, currency,
                                            frequency, next_due_date,
                                            month_day_policy, payment_rail,
                                            masked_payment_label, merchant_id,
                                            selected, created_commitment_id,
                                            created_at, updated_at
                                        ) VALUES (
                                            ?, ?, 2, TRUE, 'NONE', ?,
                                            'Invalid fixture', 'SUBSCRIPTION',
                                            100, 'INR', 'MONTHLY', NULL,
                                            'ANCHOR_DAY', 'UNKNOWN', NULL,
                                            NULL, NULL, NULL, ?, ?
                                        )
                                        """,
                                        UUID.randomUUID(),
                                        importId,
                                        "9".repeat(64),
                                        timestamp,
                                        timestamp))
                .isInstanceOf(DataIntegrityViolationException.class);

        UUID importItemId =
                UUID.fromString("b8000000-0000-4000-8000-000000000001");
        jdbc.update(
                """
                INSERT INTO commitment_import_items (
                    id, import_job_id, row_number, valid, duplicate_kind,
                    schedule_fingerprint, name, category, amount_minor,
                    currency, frequency, next_due_date, month_day_policy,
                    payment_rail, masked_payment_label, merchant_id, selected,
                    created_commitment_id, created_at, updated_at
                ) VALUES (
                    ?, ?, 2, TRUE, 'NONE', ?, 'Valid fixture',
                    'SUBSCRIPTION', 100, 'INR', 'MONTHLY', ?,
                    'ANCHOR_DAY', 'UNKNOWN', NULL, NULL, NULL, NULL, ?, ?
                )
                """,
                importItemId,
                importId,
                "a".repeat(64),
                LocalDate.of(2026, 8, 29),
                timestamp,
                timestamp);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        """
                                        INSERT INTO recurring_commitments (
                                            id, household_id,
                                            data_owner_user_id,
                                            responsible_member_id,
                                            merchant_id, display_name,
                                            category, payment_rail,
                                            amount_minor,
                                            estimated_amount_minor, currency,
                                            frequency, interval_count,
                                            custom_interval_unit, anchor_date,
                                            month_day_policy, next_due_date,
                                            variable_amount,
                                            masked_payment_label, source,
                                            source_confidence, visibility,
                                            status, optimistic_version,
                                            import_job_id, import_item_id,
                                            import_fingerprint,
                                            created_at, updated_at
                                        ) VALUES (
                                            ?, ?, ?, NULL, NULL,
                                            'Invalid manual provenance',
                                            'SUBSCRIPTION', 'UNKNOWN', 100,
                                            NULL, 'INR', 'MONTHLY', 1, NULL,
                                            ?, 'ANCHOR_DAY', ?, FALSE, NULL,
                                            'MANUAL', NULL, 'PRIVATE',
                                            'ACTIVE', 0, ?, ?, ?, ?, ?
                                        )
                                        """,
                                        UUID.randomUUID(),
                                        householdId,
                                        userId,
                                        LocalDate.of(2026, 8, 29),
                                        LocalDate.of(2026, 8, 29),
                                        importId,
                                        importItemId,
                                        "b".repeat(64),
                                        timestamp,
                                        timestamp))
                .isInstanceOf(DataIntegrityViolationException.class);
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

    private static void assertNoV6OperationalRows(JdbcTemplate jdbc) {
        for (String table :
                List.of(
                        "commitment_import_jobs",
                        "commitment_import_items",
                        "commitment_import_item_errors",
                        "operation_rate_locks")) {
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM " + table, Integer.class))
                    .as(table + " has no inferred V6 operational rows")
                    .isZero();
        }
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM recurring_commitments
                                WHERE source = 'CSV'
                                   OR import_job_id IS NOT NULL
                                   OR import_item_id IS NOT NULL
                                   OR import_fingerprint IS NOT NULL
                                """,
                                Integer.class))
                .as("no existing commitment receives inferred CSV provenance")
                .isZero();
    }

    private static Set<String> publicDomainTables(DatabaseMetaData metadata) throws SQLException {
        Set<String> tables = new HashSet<>();
        try (ResultSet rows = metadata.getTables(null, "public", "%", new String[] {"TABLE"})) {
            while (rows.next()) {
                String table = rows.getString("TABLE_NAME");
                if (!"flyway_schema_history".equals(table)) {
                    tables.add(table);
                }
            }
        }
        return tables;
    }

    private static Set<String> foreignKeys(DatabaseMetaData metadata, String table)
            throws SQLException {
        Set<String> foreignKeys = new HashSet<>();
        try (ResultSet rows = metadata.getImportedKeys(null, "public", table)) {
            while (rows.next()) {
                foreignKeys.add(rows.getString("FK_NAME"));
            }
        }
        return foreignKeys;
    }

    private static Set<String> columns(DatabaseMetaData metadata, String table)
            throws SQLException {
        Set<String> columns = new HashSet<>();
        try (ResultSet rows = metadata.getColumns(null, "public", table, "%")) {
            while (rows.next()) {
                columns.add(rows.getString("COLUMN_NAME"));
            }
        }
        return columns;
    }
}
