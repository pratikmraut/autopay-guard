package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

class V4ToV5MigrationTest {

    @Test
    void upgradesARealV4SnapshotWithPrivateOwnerBackfillsOnly() throws Exception {
        String databaseName =
                "v4_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        String url =
                "jdbc:h2:mem:"
                        + databaseName
                        + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
        try (Connection keepAlive = DriverManager.getConnection(url, "sa", "")) {
            SingleConnectionDataSource dataSource =
                    new SingleConnectionDataSource(keepAlive, true);
            Flyway v3 =
                    Flyway.configure()
                            .dataSource(dataSource)
                            .locations("classpath:db/migration")
                            .target("3")
                            .load();
            v3.migrate();
            JdbcTemplate jdbc = new JdbcTemplate(dataSource);

            UUID userId = UUID.fromString("a1000000-0000-4000-8000-000000000001");
            UUID householdId =
                    UUID.fromString("a2000000-0000-4000-8000-000000000001");
            UUID commitmentId =
                    UUID.fromString("a3000000-0000-4000-8000-000000000001");
            OffsetDateTime timestamp =
                    OffsetDateTime.of(2026, 7, 27, 8, 30, 0, 0, ZoneOffset.UTC);
            insertV4Snapshot(
                    jdbc, userId, householdId, commitmentId, timestamp);
            Flyway v4 =
                    Flyway.configure()
                            .dataSource(dataSource)
                            .locations("classpath:db/migration")
                            .target("4")
                            .load();
            v4.migrate();
            Map<String, Integer> priorChecksums = checksums(jdbc);

            Flyway latest =
                    Flyway.configure()
                            .dataSource(dataSource)
                            .locations("classpath:db/migration")
                            .load();
            latest.migrate();

            assertThat(latest.info().current().getVersion().getVersion())
                    .isEqualTo("6");
            assertThat(checksums(jdbc)).containsAllEntriesOf(priorChecksums);
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
                                    SELECT data_owner_user_id, responsible_member_id, visibility
                                    FROM recurring_commitments
                                    WHERE id = ?
                                    """,
                                    commitmentId))
                    .containsEntry("data_owner_user_id", userId)
                    .containsEntry("responsible_member_id", null)
                    .containsEntry("visibility", "PRIVATE");
            assertThat(
                            jdbc.queryForMap(
                                    """
                                    SELECT user_id, notice_version, event_type, content_digest
                                    FROM privacy_notice_acknowledgements
                                    WHERE user_id = ?
                                    """,
                                    userId))
                    .containsEntry("user_id", userId)
                    .containsEntry("notice_version", "foundation-v1")
                    .containsEntry("event_type", "ACKNOWLEDGED")
                    .containsEntry(
                            "content_digest",
                            "f44a66e435a10f110c1b2eff19abcf60f4978053205c9068c08c6a8bae74b244");
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
                            "operation_rate_events")) {
                assertThat(
                                jdbc.queryForObject(
                                        "SELECT count(*) FROM " + table,
                                        Integer.class))
                        .as(table + " has no inferred operational rows")
                        .isZero();
            }
        }
    }

    private static Map<String, Integer> checksums(JdbcTemplate jdbc) {
        return jdbc.query(
                        """
                        SELECT version, checksum
                        FROM flyway_schema_history
                        WHERE version IN ('1', '2', '3', '4')
                        ORDER BY version
                        """,
                        (row, index) ->
                                Map.entry(
                                        row.getString("version"),
                                        row.getInt("checksum")))
                .stream()
                .collect(
                        Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    private static void insertV4Snapshot(
            JdbcTemplate jdbc,
            UUID userId,
            UUID householdId,
            UUID commitmentId,
            OffsetDateTime timestamp) {
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at, privacy_notice_version,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                userId,
                "existing-v4-subject",
                "existing-v4@example.test",
                "Existing V4 User",
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
                "Existing V4 household",
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
    }
}
