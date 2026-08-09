package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class V1ToV2MigrationTest {

    @Test
    void upgradesAnActualV1DatabaseThroughV6WithoutChangingExistingRows()
            throws Exception {
        String databaseName = "v1_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        String url =
                "jdbc:h2:mem:"
                        + databaseName
                        + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
        DriverManagerDataSource dataSource =
                new DriverManagerDataSource(url, "sa", "");
        Connection keepAlive = DriverManager.getConnection(url, "sa", "");

        Flyway v1 =
                Flyway.configure()
                        .dataSource(dataSource)
                        .locations("classpath:db/migration")
                        .target("1")
                        .load();
        v1.migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        UUID userId = UUID.fromString("30000000-0000-4000-8000-000000000001");
        UUID householdId = UUID.fromString("40000000-0000-4000-8000-000000000001");
        OffsetDateTime createdAt =
                OffsetDateTime.of(2026, 7, 1, 10, 15, 0, 0, ZoneOffset.UTC);
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at, privacy_notice_version,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                userId,
                "existing-v1-subject",
                "existing-v1@example.test",
                "Existing V1 User",
                "Asia/Kolkata",
                "en-IN",
                createdAt,
                createdAt,
                "foundation-v1",
                createdAt,
                createdAt);
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                householdId,
                "Existing V1 household",
                userId,
                "INR",
                "Asia/Kolkata",
                createdAt,
                createdAt);

        Flyway latest =
                Flyway.configure()
                        .dataSource(dataSource)
                        .locations("classpath:db/migration")
                        .load();
        latest.migrate();

        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("6");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT oidc_subject FROM users WHERE id = ?",
                                String.class,
                                userId))
                .isEqualTo("existing-v1-subject");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT name FROM households WHERE id = ?",
                                String.class,
                                householdId))
                .isEqualTo("Existing V1 household");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM recurring_commitments",
                                Integer.class))
                .isZero();
        assertThat(
                        jdbc.queryForList(
                                """
                                SELECT version
                                FROM flyway_schema_history
                                WHERE version IS NOT NULL
                                ORDER BY installed_rank
                                """,
                                String.class))
                .containsExactly("1", "2", "3", "4", "5", "6");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM commitment_import_jobs",
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
                                "SELECT count(*) FROM reminder_rule_sets",
                                Integer.class))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications", Integer.class))
                .isZero();
        keepAlive.close();
    }
}
