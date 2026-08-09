package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(
        properties =
                "spring.datasource.url=jdbc:h2:mem:flyway_m5_catalog;"
                        + "MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE")
@ActiveProfiles("test")
class FlywayMigrationIntegrationTest {

    @Autowired private Flyway flyway;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void v6CreatesOnlyTheAuthorizedDomainTablesAndFictionalCatalog() {
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("6");

        List<String> domainTables =
                jdbcTemplate.queryForList(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'public'
                          AND table_type = 'BASE TABLE'
                          AND table_name <> 'flyway_schema_history'
                        ORDER BY table_name
                        """,
                        String.class);
        assertThat(domainTables)
                .containsExactly(
                        "audit_event_locks",
                        "audit_events",
                        "cancellation_attempt_verifications",
                        "cancellation_attempts",
                        "cancellation_guide_catalog_state",
                        "cancellation_guide_draft_states",
                        "cancellation_guide_feedback",
                        "cancellation_guide_locks",
                        "cancellation_guide_steps",
                        "cancellation_guide_versions",
                        "cancellation_guides",
                        "cancellation_published_step_locks",
                        "cancellation_published_target_locks",
                        "cancellation_published_version_locks",
                        "cancellation_target_allowlist",
                        "cancellation_target_locks",
                        "commitment_import_item_errors",
                        "commitment_import_items",
                        "commitment_import_jobs",
                        "commitment_occurrences",
                        "consent_event_locks",
                        "consent_events",
                        "deletion_tombstones",
                        "guide_feedback_reviews",
                        "guide_lifecycle_event_locks",
                        "guide_lifecycle_events",
                        "household_invitations",
                        "household_members",
                        "households",
                        "idempotency_records",
                        "m5_idempotency_records",
                        "merchant_aliases",
                        "merchants",
                        "notification_deliveries",
                        "notification_preferences",
                        "notifications",
                        "occurrence_decisions",
                        "operation_rate_events",
                        "operation_rate_locks",
                        "outbox_events",
                        "privacy_export_artifacts",
                        "privacy_notice_acknowledgement_locks",
                        "privacy_notice_acknowledgements",
                        "privacy_request_event_locks",
                        "privacy_request_events",
                        "privacy_requests",
                        "recurring_commitments",
                        "reminder_rule_sets",
                        "reminder_rules",
                        "savings_events",
                        "support_diagnostic_grants",
                        "users");

        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM notification_preferences",
                                Integer.class))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM notifications", Integer.class))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM outbox_events", Integer.class))
                .isZero();
        for (String table :
                List.of(
                        "idempotency_records",
                        "occurrence_decisions",
                        "cancellation_attempts",
                        "cancellation_attempt_verifications",
                        "savings_events",
                        "cancellation_guide_feedback")) {
            assertThat(
                            jdbcTemplate.queryForObject(
                                    "SELECT count(*) FROM " + table, Integer.class))
                    .as(table + " is empty after migration")
                    .isZero();
        }
        for (String table :
                List.of(
                        "commitment_import_jobs",
                        "commitment_import_items",
                        "commitment_import_item_errors",
                        "operation_rate_locks")) {
            assertThat(
                            jdbcTemplate.queryForObject(
                                    "SELECT count(*) FROM " + table, Integer.class))
                    .as(table + " is empty after migration")
                    .isZero();
        }

        List<String> merchantFixtures =
                jdbcTemplate.queryForList(
                        """
                        SELECT canonical_name || '|' || website_host
                        FROM merchants
                        ORDER BY id
                        """,
                        String.class);
        assertThat(merchantFixtures)
                .startsWith(
                        "StreamBox Demo|streambox.example",
                        "CloudNest Demo|cloudnest.example",
                        "FitClub Demo|fitclub.example")
                .hasSize(20);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM merchant_aliases", Integer.class))
                .isEqualTo(6);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM cancellation_guides", Integer.class))
                .isEqualTo(20);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM cancellation_guide_versions
                                WHERE status = 'PUBLISHED'
                                  AND version = 1
                                  AND review_interval_days BETWEEN 30 AND 90
                                """,
                                Integer.class))
                .isEqualTo(20);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM cancellation_guide_steps", Integer.class))
                .isEqualTo(80);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM cancellation_published_version_locks",
                                Integer.class))
                .isEqualTo(20);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM cancellation_published_step_locks",
                                Integer.class))
                .isEqualTo(80);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM cancellation_published_target_locks",
                                Integer.class))
                .isEqualTo(40);

        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        """
                                        INSERT INTO cancellation_target_allowlist (
                                            target_key, action_type, scheme, host,
                                            path_prefix, enabled, created_at
                                        ) VALUES (
                                            'bad-empty-label', 'SAFE_LINK', 'https',
                                            'service..example', '/manage/', TRUE, CURRENT_TIMESTAMP
                                        )
                                        """))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        """
                                        INSERT INTO cancellation_guide_steps (
                                            guide_id, guide_version, track,
                                            sequence_number, action_type, title,
                                            instruction, target_key, target_uri
                                        ) VALUES (
                                            CAST(
                                                '40000000-0000-4000-8000-000000000001'
                                                AS UUID
                                            ),
                                            1,
                                            'SERVICE',
                                            3,
                                            'INFORMATION',
                                            'Injected third step',
                                            'This fixed manifest must reject a third step.',
                                            NULL,
                                            NULL
                                        )
                                        """))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        """
                                        UPDATE cancellation_guide_versions
                                        SET risk_notice = 'rewritten published history'
                                        WHERE guide_id = CAST(
                                            '40000000-0000-4000-8000-000000000001'
                                            AS UUID
                                        )
                                          AND version = 1
                                        """))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        """
                                        UPDATE cancellation_guide_steps
                                        SET instruction = 'rewritten published step'
                                        WHERE guide_id = CAST(
                                            '40000000-0000-4000-8000-000000000001'
                                            AS UUID
                                        )
                                          AND guide_version = 1
                                          AND track = 'SERVICE'
                                          AND sequence_number = 1
                                        """))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        """
                                        DELETE FROM cancellation_guide_steps
                                        WHERE guide_id = CAST(
                                            '40000000-0000-4000-8000-000000000001'
                                            AS UUID
                                        )
                                          AND guide_version = 1
                                          AND track = 'SERVICE'
                                          AND sequence_number = 2
                                        """))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        """
                                        UPDATE cancellation_target_allowlist
                                        SET host = 'evil.example'
                                        WHERE target_key = 'https-streambox-example'
                                        """))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        """
                                        INSERT INTO cancellation_target_allowlist (
                                            target_key, action_type, scheme, host,
                                            path_prefix, enabled, created_at
                                        ) VALUES (
                                            'bad-double-slash', 'SAFE_LINK', 'https',
                                            'valid.example', '/manage//', TRUE, CURRENT_TIMESTAMP
                                        )
                                        """))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
