package in.autopayguard.api.reminder;

import in.autopayguard.api.notification.NotificationChannel;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "reminder_rules")
class ReminderRuleEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "rule_set_id", nullable = false, updatable = false)
    private UUID ruleSetId;

    @Enumerated(EnumType.STRING)
    @Column(name = "channel", nullable = false, length = 16, updatable = false)
    private NotificationChannel channel;

    @Column(name = "offset_days", nullable = false, updatable = false)
    private int offsetDays;

    @Column(name = "local_send_time", nullable = false, updatable = false)
    @JdbcTypeCode(SqlTypes.LOCAL_TIME)
    private LocalTime localSendTime;

    @Column(name = "enabled", nullable = false, updatable = false)
    private boolean enabled;

    @Column(name = "activated_at", nullable = false, updatable = false)
    private Instant activatedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected ReminderRuleEntity() {}

    private ReminderRuleEntity(
            UUID ruleSetId,
            NotificationChannel channel,
            int offsetDays,
            LocalTime localSendTime,
            boolean enabled,
            Instant now) {
        this.id = UUID.randomUUID();
        this.ruleSetId = Objects.requireNonNull(ruleSetId);
        this.channel = Objects.requireNonNull(channel);
        this.offsetDays = offsetDays;
        this.localSendTime = Objects.requireNonNull(localSendTime);
        this.enabled = enabled;
        this.activatedAt = Objects.requireNonNull(now);
        this.createdAt = now;
        this.updatedAt = now;
    }

    static ReminderRuleEntity create(
            UUID ruleSetId,
            NotificationChannel channel,
            int offsetDays,
            LocalTime localSendTime,
            boolean enabled,
            Instant now) {
        return new ReminderRuleEntity(
                ruleSetId, channel, offsetDays, localSendTime, enabled, now);
    }

    UUID id() {
        return id;
    }

    UUID ruleSetId() {
        return ruleSetId;
    }

    NotificationChannel channel() {
        return channel;
    }

    int offsetDays() {
        return offsetDays;
    }

    LocalTime localSendTime() {
        return localSendTime;
    }

    boolean enabled() {
        return enabled;
    }

    Instant activatedAt() {
        return activatedAt;
    }

    ReminderRuleSnapshot toSnapshot() {
        return new ReminderRuleSnapshot(
                id, channel, offsetDays, localSendTime, enabled, activatedAt);
    }
}
