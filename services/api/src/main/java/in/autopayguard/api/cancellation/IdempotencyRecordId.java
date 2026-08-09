package in.autopayguard.api.cancellation;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

final class IdempotencyRecordId implements Serializable {

    private UUID ownerUserId;
    private IdempotencyOperation operation;
    private String keyHash;

    IdempotencyRecordId() {}

    IdempotencyRecordId(UUID ownerUserId, IdempotencyOperation operation, String keyHash) {
        this.ownerUserId = ownerUserId;
        this.operation = operation;
        this.keyHash = keyHash;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof IdempotencyRecordId that)) {
            return false;
        }
        return Objects.equals(ownerUserId, that.ownerUserId)
                && operation == that.operation
                && Objects.equals(keyHash, that.keyHash);
    }

    @Override
    public int hashCode() {
        return Objects.hash(ownerUserId, operation, keyHash);
    }
}
