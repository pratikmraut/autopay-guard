package in.autopayguard.api.cancellation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "cancellation_attempt_verifications")
class CancellationAttemptVerificationEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "attempt_id", nullable = false, updatable = false)
    private UUID attemptId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", nullable = false, length = 24, updatable = false)
    private CancellationVerificationStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", nullable = false, length = 24, updatable = false)
    private CancellationVerificationStatus toStatus;

    @Column(name = "verification_basis", nullable = false, length = 24, updatable = false)
    private String verificationBasis;

    @Column(name = "attempt_version", nullable = false, updatable = false)
    private long attemptVersion;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected CancellationAttemptVerificationEntity() {}

    static CancellationAttemptVerificationEntity create(
            UUID attemptId,
            CancellationVerificationStatus fromStatus,
            CancellationVerificationStatus toStatus,
            long attemptVersion,
            Instant now) {
        CancellationAttemptVerificationEntity value =
                new CancellationAttemptVerificationEntity();
        value.id = UUID.randomUUID();
        value.attemptId = attemptId;
        value.fromStatus = fromStatus;
        value.toStatus = toStatus;
        value.verificationBasis = "USER_ATTESTED";
        value.attemptVersion = attemptVersion;
        value.createdAt = now;
        return value;
    }
}
