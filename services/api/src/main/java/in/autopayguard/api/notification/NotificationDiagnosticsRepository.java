package in.autopayguard.api.notification;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class NotificationDiagnosticsRepository {

    private final JdbcTemplate jdbc;

    NotificationDiagnosticsRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    DiagnosticCounts counts(
            UUID callerUserId, UUID ownerUserId, UUID householdId) {
        return jdbc.queryForObject(
                """
                SELECT
                    COALESCE(SUM(CASE WHEN d.status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_count,
                    COALESCE(SUM(CASE WHEN d.status = 'PROCESSING' THEN 1 ELSE 0 END), 0) AS processing_count,
                    COALESCE(SUM(CASE WHEN d.status = 'RETRY_SCHEDULED' THEN 1 ELSE 0 END), 0) AS retry_count,
                    COALESCE(SUM(CASE WHEN d.status = 'DELIVERED' THEN 1 ELSE 0 END), 0) AS delivered_count,
                    COALESCE(SUM(CASE WHEN d.status = 'DEAD' THEN 1 ELSE 0 END), 0) AS dead_count,
                    COALESCE(SUM(CASE WHEN d.status = 'SUPPRESSED' THEN 1 ELSE 0 END), 0) AS suppressed_count,
                    MIN(CASE
                        WHEN d.status IN ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED')
                        THEN d.created_at
                        ELSE NULL
                    END) AS oldest_pending_at,
                    MIN(CASE
                        WHEN d.status = 'RETRY_SCHEDULED'
                        THEN d.available_at
                        ELSE NULL
                    END) AS next_retry_at
                FROM notification_deliveries d
                JOIN notifications n ON n.id = d.notification_id
                JOIN recurring_commitments c ON c.id = n.commitment_id
                JOIN household_members m
                  ON m.household_id = c.household_id
                 AND m.user_id = ?
                 AND m.status = 'ACTIVE'
                WHERE n.recipient_user_id = ?
                  AND n.household_id = ?
                  AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                """,
                NotificationDiagnosticsRepository::counts,
                callerUserId,
                ownerUserId,
                householdId);
    }

    List<NotificationFailureCountResponse> failures(
            UUID callerUserId, UUID ownerUserId, UUID householdId) {
        return jdbc.query(
                """
                SELECT d.failure_category, COUNT(*) AS failure_count
                FROM notification_deliveries d
                JOIN notifications n ON n.id = d.notification_id
                JOIN recurring_commitments c ON c.id = n.commitment_id
                JOIN household_members m
                  ON m.household_id = c.household_id
                 AND m.user_id = ?
                 AND m.status = 'ACTIVE'
                WHERE n.recipient_user_id = ?
                  AND n.household_id = ?
                  AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                  AND d.failure_category IS NOT NULL
                GROUP BY d.failure_category
                ORDER BY d.failure_category ASC
                """,
                (row, ignored) ->
                        new NotificationFailureCountResponse(
                                NotificationFailureCategory.valueOf(
                                        row.getString("failure_category")),
                                row.getLong("failure_count")),
                callerUserId,
                ownerUserId,
                householdId);
    }

    private static DiagnosticCounts counts(ResultSet row, int ignored)
            throws SQLException {
        return new DiagnosticCounts(
                row.getLong("pending_count"),
                row.getLong("processing_count"),
                row.getLong("retry_count"),
                row.getLong("delivered_count"),
                row.getLong("dead_count"),
                row.getLong("suppressed_count"),
                instant(row, "oldest_pending_at"),
                instant(row, "next_retry_at"));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    record DiagnosticCounts(
            long pending,
            long processing,
            long retryScheduled,
            long delivered,
            long dead,
            long suppressed,
            Instant oldestPendingAt,
            Instant nextRetryAt) {}
}
