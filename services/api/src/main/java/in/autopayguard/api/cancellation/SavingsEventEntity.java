package in.autopayguard.api.cancellation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "savings_events")
class SavingsEventEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "attempt_id", nullable = false, updatable = false)
    private UUID attemptId;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, length = 24, updatable = false)
    private SavingsState eventType;

    @Enumerated(EnumType.STRING)
    @Column(name = "reversal_reason", length = 24, updatable = false)
    private SavingsReversalReason reversalReason;

    @Column(name = "amount_minor", nullable = false, updatable = false)
    private long amountMinor;

    @Column(name = "currency", nullable = false, length = 3, updatable = false)
    private String currency;

    @Column(name = "estimated", nullable = false, updatable = false)
    private boolean estimated;

    @Column(name = "period_start", nullable = false, updatable = false)
    private LocalDate periodStart;

    @Column(name = "period_end", nullable = false, updatable = false)
    private LocalDate periodEnd;

    @Column(name = "method", nullable = false, length = 24, updatable = false)
    private String method;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected SavingsEventEntity() {}

    static SavingsEventEntity create(
            CancellationAttemptEntity attempt,
            SavingsState state,
            SavingsReversalReason reversalReason,
            Instant now) {
        if (attempt.projectedSavingsMinor() == null) {
            throw new IllegalArgumentException(
                    "Unquantified attempts cannot create monetary savings events.");
        }
        SavingsEventEntity value = new SavingsEventEntity();
        value.id = UUID.randomUUID();
        value.attemptId = attempt.id();
        value.eventType = state;
        value.reversalReason = reversalReason;
        value.amountMinor = attempt.projectedSavingsMinor();
        value.currency = attempt.currency();
        value.estimated = attempt.savingsEstimated();
        value.periodStart = attempt.savingsPeriodStart();
        value.periodEnd = attempt.savingsPeriodEnd();
        value.method = "CANCEL";
        value.createdAt = now;
        return value;
    }
}
