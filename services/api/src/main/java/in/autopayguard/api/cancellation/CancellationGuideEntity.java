package in.autopayguard.api.cancellation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.Immutable;

@Entity
@Immutable
@Table(name = "cancellation_guides")
class CancellationGuideEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "merchant_id", nullable = false, updatable = false)
    private UUID merchantId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected CancellationGuideEntity() {}

    UUID id() {
        return id;
    }

    UUID merchantId() {
        return merchantId;
    }
}
