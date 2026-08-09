package in.autopayguard.api.notification;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class NotificationDeliveryContextRepository {

    private final JdbcTemplate jdbc;

    NotificationDeliveryContextRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Optional<DeliveryContext> find(UUID deliveryId) {
        return jdbc.query(
                        """
                        SELECT
                            d.id AS delivery_id,
                            d.status,
                            n.id AS notification_id,
                            n.recipient_user_id,
                            u.email AS recipient_email,
                            n.household_id,
                            h.timezone AS household_timezone,
                            n.commitment_id,
                            n.scheduled_date,
                            n.channel,
                            n.offset_days,
                            n.semantic_key,
                            n.planned_for,
                            c.status AS commitment_status,
                            c.optimistic_version AS commitment_version,
                            c.updated_at AS commitment_updated_at,
                            current_occurrence.id AS occurrence_id,
                            current_occurrence.created_at AS occurrence_created_at,
                            current_occurrence.id IS NOT NULL AS occurrence_valid
                        FROM notification_deliveries d
                        JOIN notifications n ON n.id = d.notification_id
                        JOIN users u ON u.id = n.recipient_user_id
                        JOIN households h ON h.id = n.household_id
                        JOIN recurring_commitments c ON c.id = n.commitment_id
                        LEFT JOIN commitment_occurrences current_occurrence
                          ON current_occurrence.commitment_id = n.commitment_id
                         AND current_occurrence.scheduled_date = n.scheduled_date
                         AND current_occurrence.state = 'UPCOMING'
                        WHERE d.id = ?
                        """,
                        NotificationDeliveryContextRepository::context,
                        deliveryId)
                .stream()
                .findFirst();
    }

    private static DeliveryContext context(ResultSet row, int ignored)
            throws SQLException {
        return new DeliveryContext(
                row.getObject("delivery_id", UUID.class),
                NotificationStatus.valueOf(row.getString("status")),
                row.getObject("notification_id", UUID.class),
                row.getObject("recipient_user_id", UUID.class),
                row.getString("recipient_email"),
                row.getObject("household_id", UUID.class),
                ZoneId.of(row.getString("household_timezone")),
                row.getObject("commitment_id", UUID.class),
                row.getObject("scheduled_date", LocalDate.class),
                NotificationChannel.valueOf(row.getString("channel")),
                row.getInt("offset_days"),
                row.getString("semantic_key").strip(),
                instant(row, "planned_for"),
                row.getLong("commitment_version"),
                instant(row, "commitment_updated_at"),
                row.getObject("occurrence_id", UUID.class),
                nullableInstant(row, "occurrence_created_at"),
                row.getString("commitment_status"),
                row.getBoolean("occurrence_valid"));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        return row.getObject(column, OffsetDateTime.class).toInstant();
    }

    private static Instant nullableInstant(ResultSet row, String column)
            throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    record DeliveryContext(
            UUID deliveryId,
            NotificationStatus status,
            UUID notificationId,
            UUID recipientUserId,
            String recipientEmail,
            UUID householdId,
            ZoneId householdTimezone,
            UUID commitmentId,
            LocalDate scheduledDate,
            NotificationChannel channel,
            int offsetDays,
            String semanticKey,
            Instant plannedFor,
            long commitmentVersion,
            Instant commitmentUpdatedAt,
            UUID occurrenceId,
            Instant occurrenceCreatedAt,
            String commitmentStatus,
            boolean occurrenceValid) {}
}
