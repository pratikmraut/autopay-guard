package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class V2ToV3MigrationTest {

    @Test
    void upgradesAnActualV2DatabaseThroughV5WithoutOptInOrPriorDataLoss()
            throws Exception {
        String databaseName = "v2_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        String url =
                "jdbc:h2:mem:"
                        + databaseName
                        + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url, "sa", "");
        Connection keepAlive = DriverManager.getConnection(url, "sa", "");
        Flyway v2 =
                Flyway.configure()
                        .dataSource(dataSource)
                        .locations("classpath:db/migration")
                        .target("2")
                        .load();
        v2.migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        UUID userId = UUID.fromString("71000000-0000-4000-8000-000000000001");
        UUID householdId = UUID.fromString("72000000-0000-4000-8000-000000000001");
        OffsetDateTime timestamp =
                OffsetDateTime.of(2026, 7, 1, 8, 30, 0, 0, ZoneOffset.UTC);
        insertV2IdentitySnapshot(jdbc, userId, householdId, timestamp);

        Map<String, Integer> priorChecksums =
                jdbc.query(
                                """
                                SELECT version, checksum
                                FROM flyway_schema_history
                                WHERE version IN ('1', '2')
                                ORDER BY version
                                """,
                                (row, index) ->
                                        Map.entry(
                                                row.getString("version"),
                                                row.getInt("checksum")))
                        .stream()
                        .collect(
                                java.util.stream.Collectors.toMap(
                                        Map.Entry::getKey, Map.Entry::getValue));

        Flyway latest =
                Flyway.configure()
                        .dataSource(dataSource)
                        .locations("classpath:db/migration")
                        .load();
        latest.migrate();

        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("6");
        assertThat(
                        jdbc.query(
                                        """
                                        SELECT version, checksum
                                        FROM flyway_schema_history
                                        WHERE version IN ('1', '2')
                                        ORDER BY version
                                        """,
                                        (row, index) ->
                                                Map.entry(
                                                        row.getString("version"),
                                                        row.getInt("checksum")))
                                .stream()
                                .collect(
                                        java.util.stream.Collectors.toMap(
                                                Map.Entry::getKey,
                                                Map.Entry::getValue)))
                .isEqualTo(priorChecksums);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT oidc_subject FROM users WHERE id = ?",
                                String.class,
                                userId))
                .isEqualTo("existing-v2-subject");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT name FROM households WHERE id = ?",
                                String.class,
                                householdId))
                .isEqualTo("Existing V2 household");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM recurring_commitments",
                                Integer.class))
                .isZero();
        for (String table :
                List.of(
                        "notification_preferences",
                        "reminder_rule_sets",
                        "reminder_rules",
                        "notifications",
                        "notification_deliveries",
                        "outbox_events")) {
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM " + table, Integer.class))
                    .as(table + " remains empty after migration")
                    .isZero();
        }
        keepAlive.close();
    }

    private static void insertV2IdentitySnapshot(
            JdbcTemplate jdbc,
            UUID userId,
            UUID householdId,
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
                "existing-v2-subject",
                "existing-v2@example.test",
                "Existing V2 User",
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
                "Existing V2 household",
                userId,
                "INR",
                "Asia/Kolkata",
                timestamp,
                timestamp);
    }
}
