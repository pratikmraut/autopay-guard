package in.autopayguard.api.cancellation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@IdClass(IdempotencyRecordId.class)
@Table(name = "idempotency_records")
class IdempotencyRecordEntity {

    @Id
    @Column(name = "owner_user_id", nullable = false, updatable = false)
    private UUID ownerUserId;

    @Id
    @Enumerated(EnumType.STRING)
    @Column(name = "operation", nullable = false, length = 40, updatable = false)
    private IdempotencyOperation operation;

    @Id
    @Column(name = "key_hash", nullable = false, length = 64, updatable = false)
    private String keyHash;

    @Column(name = "request_hash", nullable = false, length = 64, updatable = false)
    private String requestHash;

    @Column(name = "resource_id", nullable = false, updatable = false)
    private UUID resourceId;

    @Column(name = "response_body", length = 20000, updatable = false)
    private String responseBody;

    @Column(name = "response_version", updatable = false)
    private Long responseVersion;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected IdempotencyRecordEntity() {}

    static IdempotencyRecordEntity create(
            UUID ownerUserId,
            IdempotencyOperation operation,
            String keyHash,
            String requestHash,
            UUID resourceId,
            String responseBody,
            Long responseVersion,
            Instant createdAt) {
        IdempotencyRecordEntity value = new IdempotencyRecordEntity();
        value.ownerUserId = ownerUserId;
        value.operation = operation;
        value.keyHash = keyHash;
        value.requestHash = requestHash;
        value.resourceId = resourceId;
        value.responseBody = responseBody;
        value.responseVersion = responseVersion;
        value.createdAt = createdAt;
        return value;
    }

    String requestHash() {
        return requestHash;
    }

    UUID resourceId() {
        return resourceId;
    }

    String responseBody() {
        return responseBody;
    }

    Long responseVersion() {
        return responseVersion;
    }
}
