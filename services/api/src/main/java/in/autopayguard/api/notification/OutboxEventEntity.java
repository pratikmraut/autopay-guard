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
@Table(name = "outbox_events")
class OutboxEventEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "delivery_id", nullable = false, unique = true, updatable = false)
    private UUID deliveryId;

    @Column(name = "idempotency_key", nullable = false, unique = true, length = 64, updatable = false)
    private String idempotencyKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, length = 32, updatable = false)
    private OutboxEventType eventType;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private OutboxStatus status;

    @Column(name = "available_at", nullable = false)
    private Instant availableAt;

    @Column(name = "lease_token")
    private UUID leaseToken;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Enumerated(EnumType.STRING)
    @Column(name = "last_failure_category", length = 32)
    private NotificationFailureCategory lastFailureCategory;

    @Column(name = "processed_at")
    private Instant processedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected OutboxEventEntity() {}

    static OutboxEventEntity pending(
            UUID deliveryId, String semanticKey, Instant availableAt, Instant now) {
        OutboxEventEntity event = new OutboxEventEntity();
        event.id = UUID.randomUUID();
        event.deliveryId = Objects.requireNonNull(deliveryId);
        event.idempotencyKey = Objects.requireNonNull(semanticKey);
        event.eventType = OutboxEventType.DELIVERY_REQUESTED;
        event.status = OutboxStatus.PENDING;
        event.availableAt = Objects.requireNonNull(availableAt);
        event.createdAt = Objects.requireNonNull(now);
        event.updatedAt = now;
        return event;
    }

    static OutboxEventEntity processed(
            UUID deliveryId,
            String semanticKey,
            Instant availableAt,
            NotificationFailureCategory category,
            Instant now) {
        OutboxEventEntity event = pending(deliveryId, semanticKey, availableAt, now);
        event.status = OutboxStatus.PROCESSED;
        event.lastFailureCategory = Objects.requireNonNull(category);
        event.processedAt = now;
        return event;
    }

    UUID id() {
        return id;
    }

    UUID deliveryId() {
        return deliveryId;
    }
}
