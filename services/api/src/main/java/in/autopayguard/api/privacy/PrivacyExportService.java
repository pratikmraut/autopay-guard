package in.autopayguard.api.privacy;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
class PrivacyExportService {

    static final String SCHEMA_VERSION = "autopay-guard-export-v2";
    static final int MAX_BYTES = 5 * 1024 * 1024;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final PrivacyNoticeService privacyNoticeService;

    PrivacyExportService(
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            PrivacyNoticeService privacyNoticeService) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.privacyNoticeService = privacyNoticeService;
    }

    Artifact build(UUID subjectUserId, Instant generatedAt) {
        Map<String, Object> manifest = new TreeMap<>();
        manifest.put("auditEvents", auditEvents(subjectUserId));
        manifest.put("cancellationData", cancellationData(subjectUserId));
        manifest.put("consentEvents", consentEvents(subjectUserId));
        manifest.put("generatedAt", generatedAt.toString());
        manifest.put("households", households(subjectUserId));
        manifest.put("importJobs", importJobs(subjectUserId));
        manifest.put("memberships", memberships(subjectUserId));
        manifest.put("noticeAcknowledgements", noticeAcknowledgements(subjectUserId));
        manifest.put("notificationData", notificationData(subjectUserId));
        manifest.put("privacyRequests", privacyRequests(subjectUserId));
        manifest.put("schemaVersion", SCHEMA_VERSION);
        manifest.put("subject", subject(subjectUserId));
        manifest.put("supportGrants", supportGrants(subjectUserId));

        byte[] payload;
        try {
            payload = objectMapper.writeValueAsBytes(manifest);
        } catch (Exception exception) {
            throw new IllegalStateException("The privacy export could not be serialized.", exception);
        }
        if (payload.length > MAX_BYTES) {
            throw new ExportTooLargeException();
        }
        return new Artifact(payload, sha256(payload));
    }

    private Map<String, Object> subject(UUID userId) {
        Map<String, Object> subject =
                single(
                """
                SELECT id, email, display_name, timezone, locale,
                       age_confirmed_at, privacy_notice_accepted_at,
                       privacy_notice_version, created_at, updated_at
                FROM users
                WHERE id = ? AND deleted_at IS NULL
                """,
                userId);
        subject.put("invitations", invitations(userId));
        return subject;
    }

    private List<Map<String, Object>> noticeAcknowledgements(UUID userId) {
        return rows(
                """
                SELECT id, notice_version, content_digest, event_type,
                       acknowledged_at, created_at
                FROM privacy_notice_acknowledgements
                WHERE user_id = ?
                ORDER BY acknowledged_at, id
                """,
                userId);
    }

    private List<Map<String, Object>> consentEvents(UUID userId) {
        return rows(
                """
                SELECT id, purpose, purpose_version, action, occurred_at, created_at
                FROM consent_events
                WHERE user_id = ?
                ORDER BY occurred_at, id
                """,
                userId);
    }

    private List<Map<String, Object>> memberships(UUID userId) {
        return rows(
                """
                SELECT id, household_id, role, status, optimistic_version,
                       joined_at, removed_at, created_at, updated_at
                FROM household_members
                WHERE user_id = ?
                ORDER BY created_at, id
                """,
                userId);
    }

    private List<Map<String, Object>> households(UUID userId) {
        List<Map<String, Object>> householdRows =
                rows(
                        """
                        SELECT h.id, h.name, h.owner_user_id, h.default_currency,
                               h.timezone, h.created_at, h.updated_at,
                               hm.id AS membership_id, hm.role AS membership_role,
                               hm.status AS membership_status
                        FROM household_members hm
                        JOIN households h ON h.id = hm.household_id
                        WHERE hm.user_id = ? AND hm.status = 'ACTIVE'
                        ORDER BY h.created_at, h.id
                        """,
                        userId);
        boolean requesterConsent = sharingGranted(userId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : householdRows) {
            UUID householdId = UUID.fromString(row.get("id").toString());
            UUID ownerUserId = UUID.fromString(row.get("ownerUserId").toString());
            boolean owner = ownerUserId.equals(userId);
            boolean memberCanRead = requesterConsent && sharingGranted(ownerUserId);
            List<Map<String, Object>> commitments =
                    visibleCommitments(
                            userId,
                            householdId,
                            owner || memberCanRead);
            row.put("commitments", commitments);
            row.put(
                    "reminderRuleSets",
                    owner
                            ? reminderRuleSets(householdId, null)
                            : List.of());
            result.add(row);
        }
        return result;
    }

    private List<Map<String, Object>> visibleCommitments(
            UUID userId, UUID householdId, boolean sharingAllowed) {
        List<Map<String, Object>> commitments =
                rows(
                        """
                        SELECT id, household_id, data_owner_user_id,
                               responsible_member_id, merchant_id, display_name,
                               category, payment_rail, masked_payment_label,
                               variable_amount, amount_minor, estimated_amount_minor,
                               currency, frequency, interval_count,
                               custom_interval_unit, anchor_date, month_day_policy,
                               next_due_date, status, source, source_confidence,
                               visibility,
                               optimistic_version, created_at, updated_at
                        FROM recurring_commitments
                        WHERE household_id = ?
                          AND (
                              data_owner_user_id = ?
                              OR (visibility = 'HOUSEHOLD' AND ?)
                          )
                        ORDER BY created_at, id
                        """,
                        householdId,
                        userId,
                        sharingAllowed);
        for (Map<String, Object> commitment : commitments) {
            UUID commitmentId = UUID.fromString(commitment.get("id").toString());
            commitment.put(
                    "occurrences",
                    rows(
                            """
                            SELECT id, scheduled_date, expected_amount_minor,
                                   amount_kind, currency, state, created_at,
                                   updated_at
                            FROM commitment_occurrences
                            WHERE commitment_id = ?
                            ORDER BY scheduled_date, id
                            """,
                            commitmentId));
            commitment.put(
                    "reminderRuleSets",
                    userId.toString()
                                    .equals(commitment.get("dataOwnerUserId").toString())
                            ? reminderRuleSets(householdId, commitmentId)
                            : List.of());
        }
        return commitments;
    }

    private List<Map<String, Object>> invitations(UUID userId) {
        return rows(
                """
                SELECT i.id, i.household_id,
                       CASE
                           WHEN lower(i.invitee_email) = lower(subject.email)
                               THEN i.invitee_email
                           ELSE NULL
                       END AS invitee_email,
                       i.role,
                       i.status, i.optimistic_version, i.expires_at,
                       i.accepted_at, i.revoked_at, i.created_at, i.updated_at,
                       CASE
                           WHEN h.owner_user_id = ? THEN 'SENT'
                           ELSE 'RECEIVED'
                       END AS subject_relationship
                FROM household_invitations i
                JOIN households h ON h.id = i.household_id
                JOIN users subject ON subject.id = ?
                WHERE h.owner_user_id = ?
                   OR lower(i.invitee_email) = lower(subject.email)
                   OR i.accepted_by_user_id = ?
                ORDER BY i.created_at, i.id
                """,
                userId,
                userId,
                userId,
                userId);
    }

    private List<Map<String, Object>> reminderRuleSets(
            UUID householdId, UUID commitmentId) {
        List<Map<String, Object>> sets;
        if (commitmentId == null) {
            sets =
                    rows(
                            """
                            SELECT id, household_id, commitment_id, scope_type,
                                   scope_reference_id, mode, activated_at,
                                   optimistic_version, created_at, updated_at
                            FROM reminder_rule_sets
                            WHERE household_id = ? AND scope_type = 'HOUSEHOLD'
                            ORDER BY created_at, id
                            """,
                            householdId);
        } else {
            sets =
                    rows(
                            """
                            SELECT id, household_id, commitment_id, scope_type,
                                   scope_reference_id, mode, activated_at,
                                   optimistic_version, created_at, updated_at
                            FROM reminder_rule_sets
                            WHERE household_id = ? AND commitment_id = ?
                            ORDER BY created_at, id
                            """,
                            householdId,
                            commitmentId);
        }
        for (Map<String, Object> set : sets) {
            UUID setId = UUID.fromString(set.get("id").toString());
            set.put(
                    "rules",
                    rows(
                            """
                            SELECT id, channel, offset_days, local_send_time,
                                   enabled, activated_at, created_at, updated_at
                            FROM reminder_rules
                            WHERE rule_set_id = ?
                            ORDER BY channel, offset_days, id
                            """,
                            setId));
        }
        return sets;
    }

    private Map<String, Object> notificationData(UUID userId) {
        Map<String, Object> result = new TreeMap<>();
        result.put(
                "preferences",
                optionalSingle(
                        """
                        SELECT id, enabled, in_app_enabled, email_enabled,
                               timezone, quiet_hours_enabled, quiet_start, quiet_end,
                               enabled_at, in_app_enabled_at, email_enabled_at,
                               optimistic_version, created_at, updated_at
                        FROM notification_preferences
                        WHERE user_id = ?
                        """,
                        userId));
        List<Map<String, Object>> notifications =
                rows(
                        """
                        SELECT id, household_id, commitment_id, occurrence_id,
                               reminder_rule_id, scheduled_date, channel,
                               offset_days, planned_for, read_at,
                               optimistic_version, created_at, updated_at
                        FROM notifications
                        WHERE recipient_user_id = ?
                        ORDER BY created_at, id
                        """,
                        userId);
        for (Map<String, Object> notification : notifications) {
            UUID notificationId = UUID.fromString(notification.get("id").toString());
            Map<String, Object> delivery =
                    optionalSingle(
                            """
                            SELECT id, status, attempt_count, available_at,
                                   delivered_at, suppressed_at, failure_category,
                                   created_at, updated_at
                            FROM notification_deliveries
                            WHERE notification_id = ?
                            """,
                            notificationId);
            if (delivery != null) {
                UUID deliveryId = UUID.fromString(delivery.get("id").toString());
                delivery.put(
                        "outbox",
                        optionalSingle(
                                """
                                SELECT id, event_type, status, available_at,
                                       attempt_count, processed_at,
                                       last_failure_category,
                                       created_at, updated_at
                                FROM outbox_events
                                WHERE delivery_id = ?
                                """,
                                deliveryId));
            }
            notification.put("delivery", delivery);
        }
        result.put("notifications", notifications);
        return result;
    }

    private Map<String, Object> cancellationData(UUID userId) {
        Map<String, Object> result = new TreeMap<>();
        result.put(
                "decisions",
                rows(
                        """
                        SELECT id, household_id, commitment_id, occurrence_id,
                               scheduled_date, sequence_number, commitment_version,
                               display_name, category, payment_rail,
                               expected_amount_minor, amount_kind, currency,
                               action, created_at
                        FROM occurrence_decisions
                        WHERE owner_user_id = ?
                        ORDER BY created_at, id
                        """,
                        userId));
        List<Map<String, Object>> attempts =
                rows(
                        """
                        SELECT id, household_id, commitment_id, occurrence_id,
                               decision_id, guide_id, guide_version, scheduled_date,
                               verification_due_date, household_timezone,
                               commitment_version, display_name, category,
                               payment_rail, expected_amount_minor, amount_kind,
                               currency, frequency, interval_count,
                               custom_interval_unit, anchor_date, month_day_policy,
                               variable_amount, amount_minor, estimated_amount_minor,
                               service_status, payment_mandate_required,
                               payment_mandate_status, verification_status,
                               savings_period_start, savings_period_end,
                               projected_savings_minor, savings_estimated, note,
                               completed_at, abandoned_at, optimistic_version,
                               created_at, updated_at
                        FROM cancellation_attempts
                        WHERE owner_user_id = ?
                        ORDER BY created_at, id
                        """,
                        userId);
        for (Map<String, Object> attempt : attempts) {
            UUID attemptId = UUID.fromString(attempt.get("id").toString());
            attempt.put(
                    "verifications",
                    rows(
                            """
                            SELECT id, from_status, to_status, verification_basis,
                                   attempt_version, created_at
                            FROM cancellation_attempt_verifications
                            WHERE attempt_id = ?
                            ORDER BY created_at, id
                            """,
                            attemptId));
            attempt.put(
                    "savingsEvents",
                    rows(
                            """
                            SELECT id, event_type, reversal_reason, amount_minor,
                                   currency, estimated, period_start, period_end,
                                   method, created_at
                            FROM savings_events
                            WHERE attempt_id = ?
                            ORDER BY created_at, id
                            """,
                            attemptId));
        }
        result.put("attempts", attempts);
        result.put(
                "guideFeedback",
                rows(
                        """
                        SELECT f.id, f.household_id, f.commitment_id, f.guide_id,
                               f.guide_version, f.outcome, f.note, f.created_at,
                               r.disposition AS review_disposition,
                               r.optimistic_version AS review_version,
                               r.reviewed_at, r.updated_at AS review_updated_at
                        FROM cancellation_guide_feedback f
                        LEFT JOIN guide_feedback_reviews r ON r.feedback_id = f.id
                        WHERE f.owner_user_id = ?
                        ORDER BY f.created_at, f.id
                        """,
                        userId));
        return result;
    }

    private List<Map<String, Object>> privacyRequests(UUID userId) {
        List<Map<String, Object>> requests =
                rows(
                        """
                        SELECT r.id, r.request_type, r.status, r.correction_field,
                               r.correction_value, r.optimistic_version, r.created_at,
                               r.updated_at, r.completed_at,
                               a.schema_version AS export_schema_version,
                               a.payload_sha256 AS export_sha256,
                               a.byte_count AS export_byte_count,
                               a.generated_at AS export_generated_at,
                               a.expires_at AS export_expires_at,
                               a.purged_at AS export_purged_at
                        FROM privacy_requests r
                        LEFT JOIN privacy_export_artifacts a ON a.request_id = r.id
                        WHERE r.requester_user_id = ?
                        ORDER BY r.created_at, r.id
                        """,
                        userId);
        for (Map<String, Object> request : requests) {
            UUID requestId = UUID.fromString(request.get("id").toString());
            request.put(
                    "events",
                    rows(
                            """
                            SELECT id,
                                   NULLIF(from_status, 'NONE') AS from_status,
                                   to_status,
                                   NULLIF(reason_code, 'NONE') AS reason_code,
                                   occurred_at, created_at
                            FROM privacy_request_events
                            WHERE request_id = ?
                            ORDER BY occurred_at, id
                            """,
                            requestId));
        }
        return requests;
    }

    private List<Map<String, Object>> auditEvents(UUID userId) {
        return rows(
                """
                SELECT id, actor_role, action, resource_type, resource_id,
                       outcome, correlation_id, occurred_at, created_at
                FROM audit_events
                WHERE actor_user_id = ?
                   OR (
                       resource_type = 'PRIVACY_REQUEST'
                       AND resource_id IN (
                           SELECT id FROM privacy_requests
                           WHERE requester_user_id = ?
                       )
                   )
                   OR (
                       resource_type = 'NOTICE_ACKNOWLEDGEMENT'
                       AND resource_id IN (
                           SELECT id FROM privacy_notice_acknowledgements
                           WHERE user_id = ?
                       )
                   )
                   OR (
                       resource_type = 'CONSENT_EVENT'
                       AND resource_id IN (
                           SELECT id FROM consent_events
                           WHERE user_id = ?
                       )
                   )
                   OR (
                       resource_type = 'HOUSEHOLD_MEMBER'
                       AND resource_id IN (
                           SELECT id FROM household_members
                           WHERE user_id = ?
                       )
                   )
                   OR (
                       resource_type = 'HOUSEHOLD_INVITATION'
                       AND resource_id IN (
                           SELECT i.id
                           FROM household_invitations i
                           JOIN households h ON h.id = i.household_id
                           JOIN users subject ON subject.id = ?
                           WHERE h.owner_user_id = ?
                              OR lower(i.invitee_email) = lower(subject.email)
                              OR i.accepted_by_user_id = ?
                       )
                   )
                   OR (
                       resource_type = 'RECURRING_COMMITMENT'
                       AND resource_id IN (
                           SELECT c.id
                           FROM recurring_commitments c
                           LEFT JOIN household_members responsible
                             ON responsible.household_id = c.household_id
                            AND responsible.id = c.responsible_member_id
                           WHERE c.data_owner_user_id = ?
                              OR responsible.user_id = ?
                       )
                   )
                   OR (
                       resource_type = 'GUIDE_FEEDBACK'
                       AND resource_id IN (
                           SELECT id FROM cancellation_guide_feedback
                           WHERE owner_user_id = ?
                       )
                   )
                   OR (
                       resource_type = 'SUPPORT_GRANT'
                       AND resource_id IN (
                           SELECT id FROM support_diagnostic_grants
                           WHERE owner_user_id = ?
                       )
                   )
                   OR (
                       resource_type = 'IMPORT_JOB'
                       AND resource_id IN (
                           SELECT id FROM commitment_import_jobs
                           WHERE owner_user_id = ?
                       )
                   )
                ORDER BY occurred_at, id
                """,
                userId,
                userId,
                userId,
                userId,
                userId,
                userId,
                userId,
                userId,
                userId,
                userId,
                userId,
                userId,
                userId);
    }

    private List<Map<String, Object>> supportGrants(UUID userId) {
        return rows(
                """
                SELECT id, household_id, status, optimistic_version,
                       expires_at, revoked_at, created_at, updated_at
                FROM support_diagnostic_grants
                WHERE owner_user_id = ?
                ORDER BY created_at, id
                """,
                userId);
    }

    private List<Map<String, Object>> importJobs(UUID userId) {
        List<Map<String, Object>> jobs =
                rows(
                        """
                        SELECT id, household_id, status, raw_byte_count,
                               preview_expires_at, raw_processed_at,
                               total_item_count,
                               valid_item_count, invalid_item_count,
                               duplicate_item_count, selected_item_count,
                               created_commitment_count, optimistic_version,
                               confirmed_at, discarded_at, expired_at,
                               created_at, updated_at
                        FROM commitment_import_jobs
                        WHERE owner_user_id = ?
                        ORDER BY created_at, id
                        """,
                        userId);
        for (Map<String, Object> job : jobs) {
            UUID importId = UUID.fromString(job.get("id").toString());
            List<Map<String, Object>> items =
                    rows(
                            """
                            SELECT id, row_number, valid, duplicate_kind, name,
                                   category, amount_minor, currency, frequency,
                                   next_due_date, month_day_policy, payment_rail,
                                   masked_payment_label, merchant_id, selected,
                                   created_commitment_id, created_at, updated_at
                            FROM commitment_import_items
                            WHERE import_job_id = ?
                            ORDER BY row_number, id
                            """,
                            importId);
            for (Map<String, Object> item : items) {
                UUID itemId = UUID.fromString(item.get("id").toString());
                boolean valid = Boolean.TRUE.equals(item.get("valid"));
                if (!valid) {
                    item.keySet()
                            .removeAll(
                                    List.of(
                                            "duplicateKind",
                                            "name",
                                            "category",
                                            "amountMinor",
                                            "currency",
                                            "frequency",
                                            "nextDueDate",
                                            "monthDayPolicy",
                                            "paymentRail",
                                            "maskedPaymentLabel",
                                            "merchantId",
                                            "selected",
                                            "createdCommitmentId"));
                    item.put(
                            "errorCodes",
                            jdbcTemplate.queryForList(
                                    """
                                    SELECT error_code
                                    FROM commitment_import_item_errors
                                    WHERE import_item_id = ?
                                    ORDER BY sequence_number
                                    """,
                                    String.class,
                                    itemId));
                }
            }
            job.put("items", items);
        }
        return jobs;
    }

    private boolean sharingGranted(UUID userId) {
        if (!privacyNoticeService.hasCurrentAcknowledgement(userId)) {
            return false;
        }
        List<String> actions =
                jdbcTemplate.query(
                        """
                        SELECT action
                        FROM consent_events
                        WHERE user_id = ?
                          AND purpose = 'HOUSEHOLD_SHARING'
                          AND purpose_version = ?
                        ORDER BY occurred_at DESC, id DESC
                        LIMIT 1
                        """,
                        (resultSet, rowNumber) -> resultSet.getString("action"),
                        userId,
                        privacyNoticeService.currentVersion());
        return !actions.isEmpty() && "GRANTED".equals(actions.getFirst());
    }

    private Map<String, Object> single(String sql, Object... arguments) {
        List<Map<String, Object>> result = rows(sql, arguments);
        if (result.size() != 1) {
            throw new IllegalStateException("The privacy export subject scope is incomplete.");
        }
        return result.getFirst();
    }

    private Map<String, Object> optionalSingle(String sql, Object... arguments) {
        List<Map<String, Object>> result = rows(sql, arguments);
        if (result.size() > 1) {
            throw new IllegalStateException("The privacy export subject scope is ambiguous.");
        }
        return result.isEmpty() ? null : result.getFirst();
    }

    private List<Map<String, Object>> rows(String sql, Object... arguments) {
        return jdbcTemplate.query(sql, PrivacyExportService::canonicalRow, arguments);
    }

    private static Map<String, Object> canonicalRow(ResultSet resultSet, int rowNumber)
            throws SQLException {
        ResultSetMetaData metadata = resultSet.getMetaData();
        Map<String, Object> row = new TreeMap<>();
        for (int column = 1; column <= metadata.getColumnCount(); column++) {
            row.put(
                    snakeToCamel(metadata.getColumnLabel(column)),
                    canonicalScalar(resultSet.getObject(column)));
        }
        return row;
    }

    private static Object canonicalScalar(Object value) {
        if (value == null
                || value instanceof String
                || value instanceof Number
                || value instanceof Boolean) {
            return value;
        }
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime.toInstant().toString();
        }
        if (value instanceof Instant instant) {
            return instant.toString();
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant().toString();
        }
        if (value instanceof java.sql.Date date) {
            return date.toLocalDate().toString();
        }
        if (value instanceof LocalDate localDate) {
            return localDate.toString();
        }
        if (value instanceof java.sql.Time time) {
            return time.toLocalTime().toString();
        }
        if (value instanceof LocalTime localTime) {
            return localTime.toString();
        }
        if (value instanceof UUID uuid) {
            return uuid.toString();
        }
        throw new IllegalStateException(
                "Unsupported privacy export scalar: " + value.getClass().getName());
    }

    private static String snakeToCamel(String value) {
        String lower = value.toLowerCase(java.util.Locale.ROOT);
        StringBuilder result = new StringBuilder(lower.length());
        boolean upper = false;
        for (int index = 0; index < lower.length(); index++) {
            char character = lower.charAt(index);
            if (character == '_') {
                upper = true;
            } else if (upper) {
                result.append(Character.toUpperCase(character));
                upper = false;
            } else {
                result.append(character);
            }
        }
        return result.toString();
    }

    private static String sha256(byte[] payload) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(payload));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable.", exception);
        }
    }

    record Artifact(byte[] payload, String sha256) {

        String text() {
            return new String(payload, StandardCharsets.UTF_8);
        }
    }

    static final class ExportTooLargeException extends RuntimeException {}
}
