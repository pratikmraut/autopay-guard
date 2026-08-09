package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

class V5ToV6MigrationTest {

    @Test
    void upgradesV5WithoutInferringImportsAndRejectsNullValidFields()
            throws Exception {
        String databaseName =
                "v5_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        String url =
                "jdbc:h2:mem:"
                        + databaseName
                        + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
        try (Connection keepAlive = DriverManager.getConnection(url, "sa", "")) {
            SingleConnectionDataSource dataSource =
                    new SingleConnectionDataSource(keepAlive, true);
            Flyway v5 =
                    Flyway.configure()
                            .dataSource(dataSource)
                            .locations("classpath:db/migration")
                            .target("5")
                            .load();
            v5.migrate();
            JdbcTemplate jdbc = new JdbcTemplate(dataSource);
            UUID userId = UUID.randomUUID();
            UUID householdId = UUID.randomUUID();
            UUID commitmentId = UUID.randomUUID();
            OffsetDateTime now =
                    OffsetDateTime.of(
                            2026, 7, 29, 12, 0, 0, 0, ZoneOffset.UTC);
            insertV5Rows(
                    jdbc, userId, householdId, commitmentId, now);
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
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM commitment_import_jobs",
                                    Integer.class))
                    .isZero();

            UUID importId = UUID.randomUUID();
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
                    "0".repeat(64),
                    now.plusHours(1),
                    now,
                    now,
                    now);
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
                                                total_item_count,
                                                valid_item_count,
                                                invalid_item_count,
                                                duplicate_item_count,
                                                selected_item_count,
                                                created_commitment_count,
                                                optimistic_version,
                                                confirmed_at, discarded_at,
                                                expired_at, created_at,
                                                updated_at
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
                                            now.plusHours(1),
                                            now,
                                            now,
                                            now,
                                            now))
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
                    now,
                    now);
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
                                                'Fixture', 'SUBSCRIPTION', 100,
                                                'INR', 'MONTHLY', NULL,
                                                'ANCHOR_DAY', 'UNKNOWN',
                                                NULL, NULL, NULL, NULL, ?, ?
                                            )
                                            """,
                                            UUID.randomUUID(),
                                            importId,
                                            "1".repeat(64),
                                            now,
                                            now))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }
    }

    private static Map<String, Integer> checksums(JdbcTemplate jdbc) {
        return jdbc.query(
                        """
                        SELECT version, checksum
                        FROM flyway_schema_history
                        WHERE version IN ('1', '2', '3', '4', '5')
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

    private static void insertV5Rows(
            JdbcTemplate jdbc,
            UUID userId,
            UUID householdId,
            UUID commitmentId,
            OffsetDateTime now) {
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at,
                    privacy_notice_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'Asia/Kolkata', 'en-IN', ?, ?, ?, ?, ?)
                """,
                userId,
                "m6-upgrade-subject",
                "m6-upgrade@example.test",
                "M6 Upgrade",
                now,
                now,
                "foundation-v1",
                now,
                now);
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone,
                    created_at, updated_at
                ) VALUES (?, 'M6 upgrade household', ?, 'INR',
                          'Asia/Kolkata', ?, ?)
                """,
                householdId,
                userId,
                now,
                now);
        jdbc.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'OWNER', 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                UUID.randomUUID(),
                householdId,
                userId,
                now,
                now,
                now);
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
                    ?, ?, ?, NULL, NULL, 'Existing V5 commitment',
                    'SUBSCRIPTION', 'UNKNOWN', 27500, NULL, 'INR',
                    'MONTHLY', 1, NULL, ?, 'ANCHOR_DAY', ?,
                    FALSE, NULL, 'MANUAL', NULL, 'PRIVATE', 'ACTIVE',
                    0, ?, ?
                )
                """,
                commitmentId,
                householdId,
                userId,
                LocalDate.of(2026, 7, 29),
                LocalDate.of(2026, 8, 29),
                now,
                now);
    }
}
