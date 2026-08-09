package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.AmountKind;
import in.autopayguard.api.commitment.CancellationOccurrenceSnapshot;
import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.commitment.CustomIntervalUnit;
import in.autopayguard.api.commitment.MonthDayPolicy;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.commitment.RecurrenceFrequency;
import in.autopayguard.api.commitment.RecurrenceRule;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "cancellation_attempts")
class CancellationAttemptEntity {

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

    @Column(name = "decision_id", nullable = false, updatable = false)
    private UUID decisionId;

    @Column(name = "guide_id", nullable = false, updatable = false)
    private UUID guideId;

    @Column(name = "guide_version", nullable = false, updatable = false)
    private int guideVersion;

    @Column(name = "scheduled_date", nullable = false, updatable = false)
    private LocalDate scheduledDate;

    @Column(name = "verification_due_date", nullable = false, updatable = false)
    private LocalDate verificationDueDate;

    @Column(name = "household_timezone", nullable = false, length = 64, updatable = false)
    private String householdTimezone;

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
    @Column(name = "frequency", nullable = false, length = 24, updatable = false)
    private RecurrenceFrequency frequency;

    @Column(name = "interval_count", nullable = false, updatable = false)
    private int intervalCount;

    @Enumerated(EnumType.STRING)
    @Column(name = "custom_interval_unit", length = 16, updatable = false)
    private CustomIntervalUnit customIntervalUnit;

    @Column(name = "anchor_date", nullable = false, updatable = false)
    private LocalDate anchorDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "month_day_policy", nullable = false, length = 16, updatable = false)
    private MonthDayPolicy monthDayPolicy;

    @Column(name = "variable_amount", nullable = false, updatable = false)
    private boolean variableAmount;

    @Column(name = "amount_minor", updatable = false)
    private Long amountMinor;

    @Column(name = "estimated_amount_minor", updatable = false)
    private Long estimatedAmountMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "service_status", nullable = false, length = 24)
    private CancellationTrackStatus serviceStatus;

    @Column(name = "payment_mandate_required", nullable = false, updatable = false)
    private boolean paymentMandateRequired;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_mandate_status", nullable = false, length = 24)
    private CancellationTrackStatus paymentMandateStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "verification_status", nullable = false, length = 24)
    private CancellationVerificationStatus verificationStatus;

    @Column(name = "savings_period_start", nullable = false, updatable = false)
    private LocalDate savingsPeriodStart;

    @Column(name = "savings_period_end", nullable = false, updatable = false)
    private LocalDate savingsPeriodEnd;

    @Column(name = "projected_savings_minor", updatable = false)
    private Long projectedSavingsMinor;

    @Column(name = "savings_estimated", nullable = false, updatable = false)
    private boolean savingsEstimated;

    @Column(name = "note", length = 500, updatable = false)
    private String note;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "abandoned_at")
    private Instant abandonedAt;

    @Column(name = "unresolved_key", length = 64)
    private String unresolvedKey;

    @Version
    @Column(name = "optimistic_version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected CancellationAttemptEntity() {}

    static CancellationAttemptEntity create(
            UUID ownerUserId,
            CancellationOccurrenceSnapshot occurrence,
            OccurrenceDecisionEntity decision,
            CancellationGuideService.GuideSelection guide,
            String householdTimezone,
            boolean paymentMandateRequired,
            SavingsProjection savings,
            String note,
            String unresolvedKey,
            Instant now) {
        CancellationAttemptEntity value = new CancellationAttemptEntity();
        value.id = UUID.randomUUID();
        value.ownerUserId = ownerUserId;
        value.householdId = occurrence.commitment().householdId();
        value.commitmentId = occurrence.commitment().id();
        value.occurrenceId = occurrence.id();
        value.decisionId = decision.id();
        value.guideId = guide.guide().id();
        value.guideVersion = guide.version().version();
        value.scheduledDate = occurrence.scheduledDate();
        value.verificationDueDate = occurrence.scheduledDate().plusDays(1);
        value.householdTimezone = householdTimezone;
        value.commitmentVersion = occurrence.commitment().version();
        value.displayName = occurrence.commitment().displayName();
        value.category = occurrence.commitment().category();
        value.paymentRail = occurrence.commitment().paymentRail();
        value.expectedAmountMinor = occurrence.expectedAmountMinor();
        value.amountKind = occurrence.amountKind();
        value.currency = occurrence.currency();
        RecurrenceRule recurrence = occurrence.commitment().recurrenceRule();
        value.frequency = recurrence.frequency();
        value.intervalCount = recurrence.intervalCount();
        value.customIntervalUnit = recurrence.customIntervalUnit();
        value.anchorDate = recurrence.anchorDate();
        value.monthDayPolicy = recurrence.monthDayPolicy();
        value.variableAmount = occurrence.commitment().variableAmount();
        value.amountMinor = occurrence.commitment().amountMinor();
        value.estimatedAmountMinor = occurrence.commitment().estimatedAmountMinor();
        value.serviceStatus = CancellationTrackStatus.NOT_STARTED;
        value.paymentMandateRequired = paymentMandateRequired;
        value.paymentMandateStatus =
                paymentMandateRequired
                        ? CancellationTrackStatus.NOT_STARTED
                        : CancellationTrackStatus.NOT_REQUIRED;
        value.verificationStatus = CancellationVerificationStatus.PENDING;
        value.savingsPeriodStart = savings.periodStart();
        value.savingsPeriodEnd = savings.periodEnd();
        value.projectedSavingsMinor = savings.amountMinor();
        value.savingsEstimated = savings.estimated();
        value.note = note;
        value.unresolvedKey = unresolvedKey;
        value.version = 0;
        value.createdAt = now;
        value.updatedAt = now;
        return value;
    }

    void replaceTracks(
            CancellationTrackStatus newServiceStatus,
            CancellationTrackStatus newPaymentMandateStatus,
            Instant now) {
        requireTrackTransition(serviceStatus, newServiceStatus, true);
        requireTrackTransition(
                paymentMandateStatus, newPaymentMandateStatus, paymentMandateRequired);
        serviceStatus = newServiceStatus;
        paymentMandateStatus = newPaymentMandateStatus;
        if (completedAt == null && tracksComplete()) {
            completedAt = now;
        }
        updatedAt = now;
    }

    void abandon(Instant now) {
        if (abandonedAt != null
                || verificationStatus == CancellationVerificationStatus.VERIFIED
                || verificationStatus == CancellationVerificationStatus.DISPUTED) {
            throw new in.autopayguard.api.common.error.RequestConflictException(
                    "The cancellation attempt is already closed.");
        }
        abandonedAt = now;
        unresolvedKey = null;
        updatedAt = now;
    }

    void verify(CancellationVerificationStatus newStatus, Instant now) {
        if (abandonedAt != null) {
            throw new in.autopayguard.api.common.error.RequestConflictException(
                    "An abandoned cancellation attempt cannot be verified.");
        }
        if (!validVerificationTransition(verificationStatus, newStatus)) {
            throw new in.autopayguard.api.common.error.RequestConflictException(
                    "The requested verification transition is not allowed.");
        }
        verificationStatus = newStatus;
        if (newStatus == CancellationVerificationStatus.VERIFIED
                || newStatus == CancellationVerificationStatus.DISPUTED) {
            unresolvedKey = null;
        }
        updatedAt = now;
    }

    boolean tracksComplete() {
        return serviceStatus == CancellationTrackStatus.CONFIRMED
                && (paymentMandateStatus == CancellationTrackStatus.CONFIRMED
                        || paymentMandateStatus == CancellationTrackStatus.NOT_REQUIRED);
    }

    SavingsState savingsState() {
        if (abandonedAt != null
                || verificationStatus == CancellationVerificationStatus.DISPUTED) {
            return SavingsState.REVERSED;
        }
        return switch (verificationStatus) {
            case PENDING -> SavingsState.POTENTIAL;
            case SELF_REPORTED -> SavingsState.SELF_REPORTED;
            case VERIFIED -> SavingsState.VERIFIED;
            case DISPUTED -> SavingsState.REVERSED;
        };
    }

    SavingsReversalReason reversalReason() {
        if (abandonedAt != null) {
            return SavingsReversalReason.ABANDONED;
        }
        return verificationStatus == CancellationVerificationStatus.DISPUTED
                ? SavingsReversalReason.DEBIT_OCCURRED
                : null;
    }

    private static void requireTrackTransition(
            CancellationTrackStatus current,
            CancellationTrackStatus requested,
            boolean required) {
        if (requested == null) {
            throw new jakarta.validation.ValidationException(
                    "Both cancellation track statuses are required.");
        }
        if (!required) {
            if (current != CancellationTrackStatus.NOT_REQUIRED
                    || requested != CancellationTrackStatus.NOT_REQUIRED) {
                throw new jakarta.validation.ValidationException(
                        "A non-required payment mandate track must remain NOT_REQUIRED.");
            }
            return;
        }
        if (requested == CancellationTrackStatus.NOT_REQUIRED) {
            throw new jakarta.validation.ValidationException(
                    "A required cancellation track cannot be NOT_REQUIRED.");
        }
        boolean valid =
                requested == current
                        || switch (current) {
                            case NOT_STARTED ->
                                    requested == CancellationTrackStatus.REQUESTED
                                            || requested
                                                    == CancellationTrackStatus.CONFIRMED;
                            case REQUESTED ->
                                    requested == CancellationTrackStatus.CONFIRMED
                                            || requested == CancellationTrackStatus.FAILED;
                            case FAILED ->
                                    requested == CancellationTrackStatus.REQUESTED
                                            || requested
                                                    == CancellationTrackStatus.CONFIRMED;
                            case CONFIRMED, NOT_REQUIRED -> false;
                        };
        if (!valid) {
            throw new in.autopayguard.api.common.error.RequestConflictException(
                    "The requested cancellation track transition is not allowed.");
        }
    }

    private static boolean validVerificationTransition(
            CancellationVerificationStatus current,
            CancellationVerificationStatus requested) {
        return switch (current) {
            case PENDING ->
                    requested == CancellationVerificationStatus.SELF_REPORTED
                            || requested == CancellationVerificationStatus.VERIFIED
                            || requested == CancellationVerificationStatus.DISPUTED;
            case SELF_REPORTED ->
                    requested == CancellationVerificationStatus.VERIFIED
                            || requested == CancellationVerificationStatus.DISPUTED;
            case VERIFIED -> requested == CancellationVerificationStatus.DISPUTED;
            case DISPUTED -> false;
        };
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

    UUID decisionId() {
        return decisionId;
    }

    UUID guideId() {
        return guideId;
    }

    int guideVersion() {
        return guideVersion;
    }

    LocalDate scheduledDate() {
        return scheduledDate;
    }

    LocalDate verificationDueDate() {
        return verificationDueDate;
    }

    String householdTimezone() {
        return householdTimezone;
    }

    String displayName() {
        return displayName;
    }

    AmountKind amountKind() {
        return amountKind;
    }

    String currency() {
        return currency;
    }

    CancellationTrackStatus serviceStatus() {
        return serviceStatus;
    }

    CancellationTrackStatus paymentMandateStatus() {
        return paymentMandateStatus;
    }

    CancellationVerificationStatus verificationStatus() {
        return verificationStatus;
    }

    LocalDate savingsPeriodStart() {
        return savingsPeriodStart;
    }

    LocalDate savingsPeriodEnd() {
        return savingsPeriodEnd;
    }

    Long projectedSavingsMinor() {
        return projectedSavingsMinor;
    }

    boolean savingsEstimated() {
        return savingsEstimated;
    }

    Instant completedAt() {
        return completedAt;
    }

    boolean abandoned() {
        return abandonedAt != null;
    }

    long version() {
        return version;
    }

    Instant createdAt() {
        return createdAt;
    }

    Instant updatedAt() {
        return updatedAt;
    }
}
