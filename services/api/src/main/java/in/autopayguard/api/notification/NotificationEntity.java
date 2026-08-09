package in.autopayguard.api.notification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "notifications")
class NotificationEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "recipient_user_id", nullable = false, updatable = false)
    private UUID recipientUserId;

    @Column(name = "household_id", nullable = false, updatable = false)
    private UUID householdId;

    @Column(name = "commitment_id", nullable = false, updatable = false)
    private UUID commitmentId;

    @Column(name = "occurrence_id")
    private UUID occurrenceId;

    @Column(name = "reminder_rule_id")
    private UUID reminderRuleId;

    @Column(name = "scheduled_date", nullable = false, updatable = false)
    private LocalDate scheduledDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "channel", nullable = false, length = 16, updatable = false)
    private NotificationChannel channel;

    @Column(name = "offset_days", nullable = false, updatable = false)
    private int offsetDays;

    @Column(name = "planned_for", nullable = false)
    private Instant plannedFor;

    @Column(name = "semantic_key", nullable = false, length = 64, updatable = false)
    private String semanticKey;

    @Column(name = "read_at")
    private Instant readAt;

    @Version
    @Column(name = "optimistic_version", nullable = false)
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected NotificationEntity() {}

    static NotificationEntity create(
            UUID recipientUserId,
            UUID householdId,
            UUID commitmentId,
            UUID occurrenceId,
            UUID reminderRuleId,
            LocalDate scheduledDate,
            NotificationChannel channel,
            int offsetDays,
            Instant plannedFor,
            String semanticKey,
            Instant now) {
        NotificationEntity notification = new NotificationEntity();
        notification.id = UUID.randomUUID();
        notification.recipientUserId = Objects.requireNonNull(recipientUserId);
        notification.householdId = Objects.requireNonNull(householdId);
        notification.commitmentId = Objects.requireNonNull(commitmentId);
        notification.occurrenceId = occurrenceId;
        notification.reminderRuleId = reminderRuleId;
        notification.scheduledDate = Objects.requireNonNull(scheduledDate);
        notification.channel = Objects.requireNonNull(channel);
        notification.offsetDays = offsetDays;
        notification.plannedFor = Objects.requireNonNull(plannedFor);
        notification.semanticKey = Objects.requireNonNull(semanticKey);
        notification.createdAt = Objects.requireNonNull(now);
        notification.updatedAt = now;
        return notification;
    }

    void markRead(boolean read, Instant now) {
        if (read && readAt == null) {
            readAt = Objects.requireNonNull(now);
            updatedAt = now;
        } else if (!read && readAt != null) {
            readAt = null;
            updatedAt = Objects.requireNonNull(now);
        }
    }

    UUID id() {
        return id;
    }

    UUID recipientUserId() {
        return recipientUserId;
    }

    UUID householdId() {
        return householdId;
    }

    UUID commitmentId() {
        return commitmentId;
    }

    UUID occurrenceId() {
        return occurrenceId;
    }

    UUID reminderRuleId() {
        return reminderRuleId;
    }

    LocalDate scheduledDate() {
        return scheduledDate;
    }

    NotificationChannel channel() {
        return channel;
    }

    int offsetDays() {
        return offsetDays;
    }

    Instant plannedFor() {
        return plannedFor;
    }

    String semanticKey() {
        return semanticKey;
    }

    boolean read() {
        return readAt != null;
    }

    long version() {
        return version == null ? 0 : version;
    }

    Instant createdAt() {
        return createdAt;
    }
}
