package in.autopayguard.api.privacy;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class PrivacyExportCanonicalFixtureTest {

    private static final Instant BASE =
            Instant.parse("2026-07-27T12:00:00Z");
    private static final UUID USER =
            UUID.fromString("e5000000-0000-4000-8000-000000000001");
    private static final UUID HOUSEHOLD =
            UUID.fromString("e5000000-0000-4000-8000-000000000002");
    private static final UUID MEMBERSHIP =
            UUID.fromString("e5000000-0000-4000-8000-000000000003");
    private static final UUID COMMITMENT =
            UUID.fromString("e5000000-0000-4000-8000-000000000004");
    private static final UUID OCCURRENCE =
            UUID.fromString("e5000000-0000-4000-8000-000000000005");
    private static final UUID PREFERENCE =
            UUID.fromString("e5000000-0000-4000-8000-000000000006");
    private static final UUID NOTIFICATION =
            UUID.fromString("e5000000-0000-4000-8000-000000000007");
    private static final UUID DELIVERY =
            UUID.fromString("e5000000-0000-4000-8000-000000000008");
    private static final UUID OUTBOX =
            UUID.fromString("e5000000-0000-4000-8000-000000000009");

    /*
     * This digest pins the exact canonical UTF-8 bytes produced by the
     * deterministic fixture below. A deliberate export-schema change must
     * update both this value and the applicable export inventory.
     */
    private static final String PINNED_SHA256 =
            "308d55b49e3da69a13f0ea6c0c846f3ed0e48e21a68ba916bd31dcd59b9b0dc4";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private PrivacyExportService exportService;
    @Autowired private ObjectMapper objectMapper;

    @Test
    void exactCanonicalFixtureBytesAndProvenanceStayPinned() throws Exception {
        insertFixture();

        PrivacyExportService.Artifact artifact =
                exportService.build(USER, BASE.plusSeconds(3_600));
        String text = new String(artifact.payload(), StandardCharsets.UTF_8);
        JsonNode manifest = objectMapper.readTree(text);

        assertThat(artifact.sha256()).isEqualTo(PINNED_SHA256);
        assertThat(text).doesNotStartWith("\uFEFF");
        assertThat(text).doesNotContain("\n", "\r", "  ");
        assertThat(objectMapper.writeValueAsString(manifest)).isEqualTo(text);
        assertThat(manifest.propertyNames())
                .containsExactly(
                        "auditEvents",
                        "cancellationData",
                        "consentEvents",
                        "generatedAt",
                        "households",
                        "importJobs",
                        "memberships",
                        "noticeAcknowledgements",
                        "notificationData",
                        "privacyRequests",
                        "schemaVersion",
                        "subject",
                        "supportGrants");
        assertThat(manifest.get("schemaVersion").asString())
                .isEqualTo("autopay-guard-export-v2");
        assertThat(manifest.get("importJobs").isArray()).isTrue();
        assertThat(manifest.get("importJobs").isEmpty()).isTrue();

        JsonNode commitment =
                manifest.get("households").get(0).get("commitments").get(0);
        assertThat(commitment.has("sourceConfidence")).isTrue();
        assertThat(commitment.get("sourceConfidence").isNull()).isTrue();
        assertThat(commitment.get("occurrences").get(0).get("updatedAt").asString())
                .isEqualTo(BASE.plusSeconds(480).toString());

        JsonNode delivery =
                manifest.get("notificationData")
                        .get("notifications")
                        .get(0)
                        .get("delivery");
        assertThat(delivery.get("failureCategory").asString())
                .isEqualTo("PROVIDER_PERMANENT");
        assertThat(delivery.get("outbox").get("lastFailureCategory").asString())
                .isEqualTo("PROVIDER_PERMANENT");
        assertThat(text)
                .doesNotContain(
                        "provider_message_id",
                        "providerMessageId",
                        "fake-provider-secret",
                        "rawPayload",
                        "contentFingerprint",
                        "originalFilename",
                        "fileName",
                        "scheduleFingerprint",
                        "idempotencyKey",
                        "leaseToken",
                        "leaseUntil");
    }

    private void insertFixture() {
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at,
                    privacy_notice_version, created_at, updated_at,
                    deleted_at, deletion_protected
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, FALSE)
                """,
                USER,
                "m5-canonical-export-fixture",
                "m5-canonical-export-fixture@example.test",
                "Canonical Export Fixture",
                "UTC",
                "en-IN",
                BASE,
                BASE.plusSeconds(60),
                "foundation-v1",
                BASE,
                BASE.plusSeconds(120));
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'INR', 'UTC', ?, ?)
                """,
                HOUSEHOLD,
                "Canonical fixture household",
                USER,
                BASE.plusSeconds(180),
                BASE.plusSeconds(240));
        jdbc.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'OWNER', 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                MEMBERSHIP,
                HOUSEHOLD,
                USER,
                BASE.plusSeconds(180),
                BASE.plusSeconds(180),
                BASE.plusSeconds(240));
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
                    ?, ?, ?, NULL, NULL, ?, 'SUBSCRIPTION', 'UNKNOWN',
                    12345, NULL, 'INR', 'MONTHLY', 1, NULL, ?,
                    'ANCHOR_DAY', ?, FALSE, NULL, 'MANUAL', NULL,
                    'PRIVATE', 'ACTIVE', 7, ?, ?
                )
                """,
                COMMITMENT,
                HOUSEHOLD,
                USER,
                "Canonical fixture commitment",
                LocalDate.parse("2026-07-15"),
                LocalDate.parse("2026-08-15"),
                BASE.plusSeconds(300),
                BASE.plusSeconds(360));
        jdbc.update(
                """
                INSERT INTO commitment_occurrences (
                    id, commitment_id, scheduled_date, expected_amount_minor,
                    currency, amount_kind, state, created_at, updated_at
                ) VALUES (?, ?, ?, 12345, 'INR', 'FIXED', 'UPCOMING', ?, ?)
                """,
                OCCURRENCE,
                COMMITMENT,
                LocalDate.parse("2026-08-15"),
                BASE.plusSeconds(420),
                BASE.plusSeconds(480));
        jdbc.update(
                """
                INSERT INTO notification_preferences (
                    id, user_id, enabled, in_app_enabled, email_enabled,
                    timezone, quiet_hours_enabled, quiet_start, quiet_end,
                    enabled_at, in_app_enabled_at, email_enabled_at,
                    optimistic_version, created_at, updated_at
                ) VALUES (
                    ?, ?, TRUE, TRUE, FALSE, 'UTC', FALSE, NULL, NULL,
                    ?, ?, NULL, 2, ?, ?
                )
                """,
                PREFERENCE,
                USER,
                BASE.plusSeconds(540),
                BASE.plusSeconds(540),
                BASE.plusSeconds(540),
                BASE.plusSeconds(600));
        jdbc.update(
                """
                INSERT INTO notifications (
                    id, recipient_user_id, household_id, commitment_id,
                    occurrence_id, reminder_rule_id, scheduled_date,
                    channel, offset_days, planned_for, semantic_key,
                    read_at, optimistic_version, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?, NULL, ?, 'EMAIL', 3, ?, ?, NULL, 2, ?, ?
                )
                """,
                NOTIFICATION,
                USER,
                HOUSEHOLD,
                COMMITMENT,
                OCCURRENCE,
                LocalDate.parse("2026-08-15"),
                BASE.plusSeconds(660),
                "1".repeat(64),
                BASE.plusSeconds(660),
                BASE.plusSeconds(720));
        jdbc.update(
                """
                INSERT INTO notification_deliveries (
                    id, notification_id, status, attempt_count, available_at,
                    lease_token, lease_until, provider_message_id,
                    failure_category, delivered_at, suppressed_at,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, 'DEAD', 3, ?, NULL, NULL, ?,
                    'PROVIDER_PERMANENT', NULL, NULL, ?, ?
                )
                """,
                DELIVERY,
                NOTIFICATION,
                BASE.plusSeconds(780),
                "fake-provider-secret",
                BASE.plusSeconds(780),
                BASE.plusSeconds(840));
        jdbc.update(
                """
                INSERT INTO outbox_events (
                    id, delivery_id, idempotency_key, event_type, status,
                    available_at, lease_token, lease_until, attempt_count,
                    last_failure_category, processed_at, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 'DELIVERY_REQUESTED', 'DEAD', ?,
                    NULL, NULL, 3, 'PROVIDER_PERMANENT', NULL, ?, ?
                )
                """,
                OUTBOX,
                DELIVERY,
                "2".repeat(64),
                BASE.plusSeconds(780),
                BASE.plusSeconds(780),
                BASE.plusSeconds(840));
    }
}
