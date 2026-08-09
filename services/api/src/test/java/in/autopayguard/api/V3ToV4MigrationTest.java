package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class V3ToV4MigrationTest {

    @Test
    void upgradesARealV3SnapshotThroughV5WithoutRewritingPriorRowsOrChecksums()
            throws Exception {
        String databaseName =
                "v3_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        String url =
                "jdbc:h2:mem:"
                        + databaseName
                        + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
        DriverManagerDataSource dataSource =
                new DriverManagerDataSource(url, "sa", "");
        try (Connection keepAlive = DriverManager.getConnection(url, "sa", "")) {
            Flyway v3 =
                    Flyway.configure()
                            .dataSource(dataSource)
                            .locations("classpath:db/migration")
                            .target("3")
                            .load();
            v3.migrate();
            JdbcTemplate jdbc = new JdbcTemplate(dataSource);

            UUID userId =
                    UUID.fromString("91000000-0000-4000-8000-000000000001");
            UUID householdId =
                    UUID.fromString("92000000-0000-4000-8000-000000000001");
            UUID preferenceId =
                    UUID.fromString("93000000-0000-4000-8000-000000000001");
            OffsetDateTime timestamp =
                    OffsetDateTime.of(2026, 7, 27, 8, 30, 0, 0, ZoneOffset.UTC);
            insertV3Snapshot(jdbc, userId, householdId, preferenceId, timestamp);
            Map<String, Integer> priorChecksums = checksums(jdbc);

            Flyway latest =
                    Flyway.configure()
                            .dataSource(dataSource)
                            .locations("classpath:db/migration")
                            .load();
            latest.migrate();

            assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("6");
            assertThat(checksums(jdbc)).containsAllEntriesOf(priorChecksums);
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT oidc_subject FROM users WHERE id = ?",
                                    String.class,
                                    userId))
                    .isEqualTo("existing-v3-subject");
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT name FROM households WHERE id = ?",
                                    String.class,
                                    householdId))
                    .isEqualTo("Existing V3 household");
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT timezone FROM notification_preferences WHERE id = ?",
                                    String.class,
                                    preferenceId))
                    .isEqualTo("Asia/Kolkata");
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM cancellation_guides",
                                    Integer.class))
                    .isEqualTo(20);
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM cancellation_guide_steps",
                                    Integer.class))
                    .isEqualTo(80);
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
                                        "SELECT count(*) FROM " + table,
                                        Integer.class))
                        .as(table + " remains empty")
                        .isZero();
            }
        }
    }

    private static Map<String, Integer> checksums(JdbcTemplate jdbc) {
        return jdbc.query(
                        """
                        SELECT version, checksum
                        FROM flyway_schema_history
                        WHERE version IN ('1', '2', '3')
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

    private static void insertV3Snapshot(
            JdbcTemplate jdbc,
            UUID userId,
            UUID householdId,
            UUID preferenceId,
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
                "existing-v3-subject",
                "existing-v3@example.test",
                "Existing V3 User",
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
                "Existing V3 household",
                userId,
                "INR",
                "Asia/Kolkata",
                timestamp,
                timestamp);
        jdbc.update(
                """
                INSERT INTO notification_preferences (
                    id, user_id, enabled, in_app_enabled, email_enabled, timezone,
                    quiet_hours_enabled, quiet_start, quiet_end, enabled_at,
                    in_app_enabled_at, email_enabled_at, optimistic_version,
                    created_at, updated_at
                ) VALUES (?, ?, TRUE, TRUE, FALSE, ?, FALSE, NULL, NULL, ?, ?, NULL, 1, ?, ?)
                """,
                preferenceId,
                userId,
                "Asia/Kolkata",
                timestamp,
                timestamp,
                timestamp,
                timestamp);
    }
}
