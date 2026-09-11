package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

class V6ToV7MigrationTest {
    @Test
    void preservesLegacyIdentityWithoutGuessingIssuerAndEnforcesNewUniqueness() throws Exception {
        String url = "jdbc:h2:mem:v7_" + UUID.randomUUID().toString().replace("-", "")
                + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
        try (Connection connection = DriverManager.getConnection(url, "sa", "")) {
            var source = new SingleConnectionDataSource(connection, true);
            Flyway.configure().dataSource(source).locations("classpath:db/migration").target("6").load().migrate();
            JdbcTemplate jdbc = new JdbcTemplate(source);
            UUID user = UUID.randomUUID();
            OffsetDateTime now = OffsetDateTime.parse("2026-09-11T12:00:00Z");
            jdbc.update("""
                    INSERT INTO users(id, oidc_subject, email, display_name, timezone, locale, created_at, updated_at)
                    VALUES (?, 'legacy-v6-subject', 'legacy-v6@example.test', 'Legacy', 'Asia/Kolkata', 'en-IN', ?, ?)
                    """, user, now, now);
            Flyway latest = Flyway.configure().dataSource(source).locations("classpath:db/migration").load();
            latest.migrate();
            assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("7");
            assertThat(jdbc.queryForMap("SELECT oidc_subject, oidc_issuer, email, display_name FROM users WHERE id = ?", user))
                    .containsEntry("oidc_subject", "legacy-v6-subject")
                    .containsEntry("oidc_issuer", null)
                    .containsEntry("email", "legacy-v6@example.test")
                    .containsEntry("display_name", "Legacy");
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM account_enrollment_lock", Integer.class)).isOne();
            assertThatThrownBy(() -> jdbc.update("INSERT INTO account_enrollment_lock(id) VALUES (2)"))
                    .isInstanceOf(DataIntegrityViolationException.class);
            assertThatThrownBy(() -> jdbc.update("""
                    INSERT INTO users(id, oidc_subject, email, display_name, timezone, locale, created_at, updated_at)
                    VALUES (?, 'duplicate-email', 'legacy-v6@example.test', 'Duplicate', 'Asia/Kolkata', 'en-IN', ?, ?)
                    """, UUID.randomUUID(), now, now)).isInstanceOf(DataIntegrityViolationException.class);
        }
    }
}
