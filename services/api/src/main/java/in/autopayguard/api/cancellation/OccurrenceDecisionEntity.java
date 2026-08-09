package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.AmountKind;
import in.autopayguard.api.commitment.CancellationOccurrenceSnapshot;
import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.commitment.ReviewAction;
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
@Table(name = "occurrence_decisions")
class OccurrenceDecisionEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "owner_user_id", nullable = false, updatable = false)
    private UUID ownerUserId;

    @Column(name = "household_id", nullable = false, updatable = false)
    private UUID householdId;

    @Column(name = "commitment_id", nullable = false, updatable = false)
    private UUID commitmentId;

    @Column(name = "occurrence_id", nullable = false, updatable = false)
    private UUID occurrenceId;

    @Column(name = "scheduled_date", nullable = false, updatable = false)
    private LocalDate scheduledDate;

    @Column(name = "sequence_number", nullable = false, updatable = false)
    private int sequenceNumber;

    @Column(name = "commitment_version", nullable = false, updatable = false)
    private long commitmentVersion;

    @Column(name = "display_name", nullable = false, length = 160, updatable = false)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 40, updatable = false)
    private CommitmentCategory category;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_rail", nullable = false, length = 40, updatable = false)
    private PaymentRail paymentRail;

    @Column(name = "expected_amount_minor", updatable = false)
    private Long expectedAmountMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "amount_kind", nullable = false, length = 24, updatable = false)
    private AmountKind amountKind;

    @Column(name = "currency", nullable = false, length = 3, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "action", nullable = false, length = 40, updatable = false)
    private ReviewAction action;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected OccurrenceDecisionEntity() {}

    static OccurrenceDecisionEntity create(
            UUID ownerUserId,
            CancellationOccurrenceSnapshot occurrence,
            ReviewAction action,
            int sequenceNumber,
            Instant now) {
        OccurrenceDecisionEntity value = new OccurrenceDecisionEntity();
        value.id = UUID.randomUUID();
        value.ownerUserId = ownerUserId;
        value.householdId = occurrence.commitment().householdId();
        value.commitmentId = occurrence.commitment().id();
        value.occurrenceId = occurrence.id();
        value.scheduledDate = occurrence.scheduledDate();
        value.sequenceNumber = sequenceNumber;
        value.commitmentVersion = occurrence.commitment().version();
        value.displayName = occurrence.commitment().displayName();
        value.category = occurrence.commitment().category();
        value.paymentRail = occurrence.commitment().paymentRail();
        value.expectedAmountMinor = occurrence.expectedAmountMinor();
        value.amountKind = occurrence.amountKind();
        value.currency = occurrence.currency();
        value.action = action;
        value.createdAt = now;
        return value;
    }

    UUID id() {
        return id;
    }

    UUID ownerUserId() {
        return ownerUserId;
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

    LocalDate scheduledDate() {
        return scheduledDate;
    }

    int sequenceNumber() {
        return sequenceNumber;
    }

    ReviewAction action() {
        return action;
    }

    Instant createdAt() {
        return createdAt;
    }
}
