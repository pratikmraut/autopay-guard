package in.autopayguard.api.notification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "notification_preferences")
class NotificationPreferenceEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false, unique = true)
    private UUID userId;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "in_app_enabled", nullable = false)
    private boolean inAppEnabled;

    @Column(name = "email_enabled", nullable = false)
    private boolean emailEnabled;

    @Column(name = "timezone", nullable = false, length = 64)
    private String timezone;

    @Column(name = "quiet_hours_enabled", nullable = false)
    private boolean quietHoursEnabled;

    @Column(name = "quiet_start")
    @JdbcTypeCode(SqlTypes.LOCAL_TIME)
    private LocalTime quietStart;

    @Column(name = "quiet_end")
    @JdbcTypeCode(SqlTypes.LOCAL_TIME)
    private LocalTime quietEnd;

    @Column(name = "enabled_at")
    private Instant enabledAt;

    @Column(name = "in_app_enabled_at")
    private Instant inAppEnabledAt;

    @Column(name = "email_enabled_at")
    private Instant emailEnabledAt;

    @Column(name = "optimistic_version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected NotificationPreferenceEntity() {}

    private NotificationPreferenceEntity(
            UUID userId,
            boolean enabled,
            boolean inAppEnabled,
            boolean emailEnabled,
            String timezone,
            boolean quietHoursEnabled,
            LocalTime quietStart,
            LocalTime quietEnd,
            Instant now) {
        this.id = UUID.randomUUID();
        this.userId = Objects.requireNonNull(userId);
        this.version = 1;
        this.createdAt = Objects.requireNonNull(now);
        apply(
                enabled,
                inAppEnabled,
                emailEnabled,
                timezone,
                quietHoursEnabled,
                quietStart,
                quietEnd,
                now,
                false);
    }

    static NotificationPreferenceEntity create(
            UUID userId,
            boolean enabled,
            boolean inAppEnabled,
            boolean emailEnabled,
            String timezone,
            boolean quietHoursEnabled,
            LocalTime quietStart,
            LocalTime quietEnd,
            Instant now) {
        return new NotificationPreferenceEntity(
                userId,
                enabled,
                inAppEnabled,
                emailEnabled,
                timezone,
                quietHoursEnabled,
                quietStart,
                quietEnd,
                now);
    }

    void update(
            boolean enabled,
            boolean inAppEnabled,
            boolean emailEnabled,
            String timezone,
            boolean quietHoursEnabled,
            LocalTime quietStart,
            LocalTime quietEnd,
            Instant now) {
        apply(
                enabled,
                inAppEnabled,
                emailEnabled,
                timezone,
                quietHoursEnabled,
                quietStart,
                quietEnd,
                now,
                true);
    }

    private void apply(
            boolean newEnabled,
            boolean newInAppEnabled,
            boolean newEmailEnabled,
            String newTimezone,
            boolean newQuietHoursEnabled,
            LocalTime newQuietStart,
            LocalTime newQuietEnd,
            Instant now,
            boolean incrementVersion) {
        if (newEnabled && !enabled) {
            enabledAt = now;
        }
        if (newInAppEnabled && !inAppEnabled) {
            inAppEnabledAt = now;
        }
        if (newEmailEnabled && !emailEnabled) {
            emailEnabledAt = now;
        }
        enabled = newEnabled;
        inAppEnabled = newInAppEnabled;
        emailEnabled = newEmailEnabled;
        timezone = Objects.requireNonNull(newTimezone);
        quietHoursEnabled = newQuietHoursEnabled;
        quietStart = newQuietStart;
        quietEnd = newQuietEnd;
        updatedAt = Objects.requireNonNull(now);
        if (incrementVersion) {
            version++;
        }
    }

    UUID id() {
        return id;
    }

    UUID userId() {
        return userId;
    }

    boolean enabled() {
        return enabled;
    }

    boolean inAppEnabled() {
        return inAppEnabled;
    }

    boolean emailEnabled() {
        return emailEnabled;
    }

    String timezone() {
        return timezone;
    }

    boolean quietHoursEnabled() {
        return quietHoursEnabled;
    }

    LocalTime quietStart() {
        return quietStart;
    }

    LocalTime quietEnd() {
        return quietEnd;
    }

    Instant enabledAt() {
        return enabledAt;
    }

    Instant inAppEnabledAt() {
        return inAppEnabledAt;
    }

    Instant emailEnabledAt() {
        return emailEnabledAt;
    }

    long version() {
        return version;
    }

    Instant updatedAt() {
        return updatedAt;
    }

    NotificationPreferenceSnapshot toSnapshot() {
        return new NotificationPreferenceSnapshot(
                id,
                userId,
                enabled,
                inAppEnabled,
                emailEnabled,
                ZoneId.of(timezone),
                quietHoursEnabled,
                quietStart,
                quietEnd,
                enabledAt,
                inAppEnabledAt,
                emailEnabledAt,
                version);
    }
}
