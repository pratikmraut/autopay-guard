package in.autopayguard.api.commitment;

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
@Table(name = "commitment_occurrences")
class CommitmentOccurrenceEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "commitment_id", nullable = false, updatable = false)
    private UUID commitmentId;

    @Column(name = "scheduled_date", nullable = false, updatable = false)
    private LocalDate scheduledDate;

    @Column(name = "expected_amount_minor")
    private Long expectedAmountMinor;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "amount_kind", nullable = false, length = 24)
    private AmountKind amountKind;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false, length = 16)
    private OccurrenceState state;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected CommitmentOccurrenceEntity() {}

    static CommitmentOccurrenceEntity upcoming(
            CommitmentEntity commitment, LocalDate scheduledDate, Instant now) {
        CommitmentOccurrenceEntity occurrence = new CommitmentOccurrenceEntity();
        occurrence.id = UUID.randomUUID();
        occurrence.commitmentId = commitment.id();
        occurrence.scheduledDate = scheduledDate;
        occurrence.expectedAmountMinor = commitment.expectedAmountMinor();
        occurrence.currency = commitment.currency();
        occurrence.amountKind = commitment.amountKind();
        occurrence.state = OccurrenceState.UPCOMING;
        occurrence.createdAt = now;
        occurrence.updatedAt = now;
        return occurrence;
    }

    UUID id() {
        return id;
    }

    UUID commitmentId() {
        return commitmentId;
    }

    LocalDate scheduledDate() {
        return scheduledDate;
    }

    Long expectedAmountMinor() {
        return expectedAmountMinor;
    }

    String currency() {
        return currency;
    }

    AmountKind amountKind() {
        return amountKind;
    }

    OccurrenceState state() {
        return state;
    }
}
