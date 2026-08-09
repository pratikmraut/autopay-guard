package in.autopayguard.api.notification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "notification_deliveries")
class NotificationDeliveryEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "notification_id", nullable = false, unique = true, updatable = false)
    private UUID notificationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 24)
    private NotificationStatus status;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "available_at", nullable = false)
    private Instant availableAt;

    @Column(name = "lease_token")
    private UUID leaseToken;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "provider_message_id", length = 200)
    private String providerMessageId;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_category", length = 32)
    private NotificationFailureCategory failureCategory;

    @Column(name = "delivered_at")
    private Instant deliveredAt;

    @Column(name = "suppressed_at")
    private Instant suppressedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected NotificationDeliveryEntity() {}

    static NotificationDeliveryEntity pending(
            UUID notificationId, Instant availableAt, Instant now) {
        NotificationDeliveryEntity delivery = new NotificationDeliveryEntity();
        delivery.id = UUID.randomUUID();
        delivery.notificationId = Objects.requireNonNull(notificationId);
        delivery.status = NotificationStatus.PENDING;
        delivery.availableAt = Objects.requireNonNull(availableAt);
        delivery.createdAt = Objects.requireNonNull(now);
        delivery.updatedAt = now;
        return delivery;
    }

    static NotificationDeliveryEntity suppressed(
            UUID notificationId,
            Instant availableAt,
            NotificationFailureCategory category,
            Instant now) {
        NotificationDeliveryEntity delivery = pending(notificationId, availableAt, now);
        delivery.status = NotificationStatus.SUPPRESSED;
        delivery.failureCategory = Objects.requireNonNull(category);
        delivery.suppressedAt = now;
        return delivery;
    }

    UUID id() {
        return id;
    }

    UUID notificationId() {
        return notificationId;
    }

    NotificationStatus status() {
        return status;
    }

    int attemptCount() {
        return attemptCount;
    }

    Instant availableAt() {
        return availableAt;
    }

    UUID leaseToken() {
        return leaseToken;
    }

    String providerMessageId() {
        return providerMessageId;
    }

    NotificationFailureCategory failureCategory() {
        return failureCategory;
    }

    Instant deliveredAt() {
        return deliveredAt;
    }

    Instant suppressedAt() {
        return suppressedAt;
    }
}
