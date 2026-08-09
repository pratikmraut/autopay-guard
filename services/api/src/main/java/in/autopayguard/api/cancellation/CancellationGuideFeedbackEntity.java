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
@Table(name = "cancellation_guide_feedback")
class CancellationGuideFeedbackEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "owner_user_id", nullable = false, updatable = false)
    private UUID ownerUserId;

    @Column(name = "household_id", nullable = false, updatable = false)
    private UUID householdId;

    @Column(name = "commitment_id", nullable = false, updatable = false)
    private UUID commitmentId;

    @Column(name = "guide_id", nullable = false, updatable = false)
    private UUID guideId;

    @Column(name = "guide_version", nullable = false, updatable = false)
    private int guideVersion;

    @Enumerated(EnumType.STRING)
    @Column(name = "outcome", nullable = false, length = 32, updatable = false)
    private GuideFeedbackOutcome outcome;

    @Column(name = "note", length = 500, updatable = false)
    private String note;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected CancellationGuideFeedbackEntity() {}

    static CancellationGuideFeedbackEntity create(
            UUID ownerUserId,
            UUID householdId,
            UUID commitmentId,
            UUID guideId,
            int guideVersion,
            GuideFeedbackOutcome outcome,
            String note,
            Instant now) {
        CancellationGuideFeedbackEntity value = new CancellationGuideFeedbackEntity();
        value.id = UUID.randomUUID();
        value.ownerUserId = ownerUserId;
        value.householdId = householdId;
        value.commitmentId = commitmentId;
        value.guideId = guideId;
        value.guideVersion = guideVersion;
        value.outcome = outcome;
        value.note = note;
        value.createdAt = now;
        return value;
    }

    UUID id() {
        return id;
    }
}
