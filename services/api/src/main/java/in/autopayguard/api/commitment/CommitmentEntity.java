package in.autopayguard.api.commitment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "recurring_commitments")
class CommitmentEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "household_id", nullable = false, updatable = false)
    private UUID householdId;

    @Column(name = "data_owner_user_id", nullable = false, updatable = false)
    private UUID dataOwnerUserId;

    @Column(name = "responsible_member_id")
    private UUID responsibleMemberId;

    @Column(name = "merchant_id")
    private UUID merchantId;

    @Column(name = "display_name", nullable = false, length = 160)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 40)
    private CommitmentCategory category;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_rail", nullable = false, length = 40)
    private PaymentRail paymentRail;

    @Column(name = "amount_minor")
    private Long amountMinor;

    @Column(name = "estimated_amount_minor")
    private Long estimatedAmountMinor;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "frequency", nullable = false, length = 24)
    private RecurrenceFrequency frequency;

    @Column(name = "interval_count", nullable = false)
    private int intervalCount;

    @Enumerated(EnumType.STRING)
    @Column(name = "custom_interval_unit", length = 16)
    private CustomIntervalUnit customIntervalUnit;

    @Column(name = "anchor_date", nullable = false)
    private LocalDate anchorDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "month_day_policy", nullable = false, length = 16)
    private MonthDayPolicy monthDayPolicy;

    @Column(name = "next_due_date")
    private LocalDate nextDueDate;

    @Column(name = "variable_amount", nullable = false)
    private boolean variableAmount;

    @Column(name = "masked_payment_label", length = 64)
    private String maskedPaymentLabel;

    @Enumerated(EnumType.STRING)
    @Column(name = "source", nullable = false, length = 16, updatable = false)
    private CommitmentSource source;

    @Column(name = "source_confidence", updatable = false)
    private Integer sourceConfidence;

    @Column(name = "import_job_id", updatable = false)
    private UUID importJobId;

    @Column(name = "import_item_id", updatable = false)
    private UUID importItemId;

    @Column(name = "import_fingerprint", length = 64, updatable = false)
    private String importFingerprint;

    @Enumerated(EnumType.STRING)
    @Column(name = "visibility", nullable = false, length = 24)
    private CommitmentVisibility visibility;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private CommitmentStatus status;

    @Version
    @Column(name = "optimistic_version", nullable = false)
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected CommitmentEntity() {}

    private CommitmentEntity(
            UUID householdId,
            UUID dataOwnerUserId,
            UUID merchantId,
            String displayName,
            CommitmentCategory category,
            PaymentRail paymentRail,
            Long amountMinor,
            Long estimatedAmountMinor,
            String currency,
            RecurrenceFrequency frequency,
            int intervalCount,
            CustomIntervalUnit customIntervalUnit,
            LocalDate anchorDate,
            MonthDayPolicy monthDayPolicy,
            boolean variableAmount,
            String maskedPaymentLabel,
            Instant now) {
        this.id = UUID.randomUUID();
        this.householdId = Objects.requireNonNull(householdId);
        this.dataOwnerUserId = Objects.requireNonNull(dataOwnerUserId);
        this.responsibleMemberId = null;
        applyEditable(
                merchantId,
                displayName,
                category,
                paymentRail,
                amountMinor,
                estimatedAmountMinor,
                currency,
                frequency,
                intervalCount,
                customIntervalUnit,
                anchorDate,
                monthDayPolicy,
                variableAmount,
                maskedPaymentLabel,
                CommitmentStatus.ACTIVE,
                now);
        this.source = CommitmentSource.MANUAL;
        this.sourceConfidence = null;
        this.importJobId = null;
        this.importItemId = null;
        this.importFingerprint = null;
        this.visibility = CommitmentVisibility.PRIVATE;
        this.createdAt = Objects.requireNonNull(now);
    }

    static CommitmentEntity create(
            UUID householdId,
            UUID dataOwnerUserId,
            UUID merchantId,
            String displayName,
            CommitmentCategory category,
            PaymentRail paymentRail,
            Long amountMinor,
            Long estimatedAmountMinor,
            String currency,
            RecurrenceFrequency frequency,
            int intervalCount,
            CustomIntervalUnit customIntervalUnit,
            LocalDate anchorDate,
            MonthDayPolicy monthDayPolicy,
            boolean variableAmount,
            String maskedPaymentLabel,
            Instant now) {
        return new CommitmentEntity(
                householdId,
                dataOwnerUserId,
                merchantId,
                displayName,
                category,
                paymentRail,
                amountMinor,
                estimatedAmountMinor,
                currency,
                frequency,
                intervalCount,
                customIntervalUnit,
                anchorDate,
                monthDayPolicy,
                variableAmount,
                maskedPaymentLabel,
                now);
    }

    static CommitmentEntity createImported(
            UUID householdId,
            UUID dataOwnerUserId,
            UUID merchantId,
            String displayName,
            CommitmentCategory category,
            PaymentRail paymentRail,
            long amountMinor,
            String currency,
            RecurrenceFrequency frequency,
            LocalDate anchorDate,
            MonthDayPolicy monthDayPolicy,
            String maskedPaymentLabel,
            UUID importJobId,
            UUID importItemId,
            String importFingerprint,
            Instant now) {
        CommitmentEntity commitment =
                new CommitmentEntity(
                        householdId,
                        dataOwnerUserId,
                        merchantId,
                        displayName,
                        category,
                        paymentRail,
                        amountMinor,
                        null,
                        currency,
                        frequency,
                        1,
                        null,
                        anchorDate,
                        monthDayPolicy,
                        false,
                        maskedPaymentLabel,
                        now);
        commitment.source = CommitmentSource.CSV;
        commitment.importJobId = Objects.requireNonNull(importJobId);
        commitment.importItemId = Objects.requireNonNull(importItemId);
        commitment.importFingerprint = Objects.requireNonNull(importFingerprint);
        return commitment;
    }

    void update(UpdateCommitmentRequest request, Instant now) {
        applyEditable(
                request.merchantId(),
                request.displayName(),
                request.category(),
                request.paymentRail(),
                request.amountMinor(),
                request.estimatedAmountMinor(),
                request.currency(),
                request.frequency(),
                request.intervalCount(),
                request.customIntervalUnit(),
                request.anchorDate(),
                request.monthDayPolicy(),
                request.variableAmount(),
                request.maskedPaymentLabel(),
                CommitmentStatus.valueOf(request.status().name()),
                now);
    }

    void archive(Instant now) {
        status = CommitmentStatus.ARCHIVED;
        nextDueDate = null;
        updatedAt = Objects.requireNonNull(now);
    }

    void updateSharing(
            CommitmentVisibility visibility,
            UUID responsibleMemberId,
            Instant now) {
        this.visibility = Objects.requireNonNull(visibility);
        this.responsibleMemberId =
                visibility == CommitmentVisibility.PRIVATE
                        ? null
                        : responsibleMemberId;
        this.updatedAt = Objects.requireNonNull(now);
    }

    private void applyEditable(
            UUID merchantId,
            String displayName,
            CommitmentCategory category,
            PaymentRail paymentRail,
            Long amountMinor,
            Long estimatedAmountMinor,
            String currency,
            RecurrenceFrequency frequency,
            int intervalCount,
            CustomIntervalUnit customIntervalUnit,
            LocalDate anchorDate,
            MonthDayPolicy monthDayPolicy,
            boolean variableAmount,
            String maskedPaymentLabel,
            CommitmentStatus status,
            Instant now) {
        this.merchantId = merchantId;
        this.displayName = Objects.requireNonNull(displayName);
        this.category = Objects.requireNonNull(category);
        this.paymentRail = Objects.requireNonNull(paymentRail);
        this.amountMinor = amountMinor;
        this.estimatedAmountMinor = estimatedAmountMinor;
        this.currency = Objects.requireNonNull(currency);
        this.frequency = Objects.requireNonNull(frequency);
        this.intervalCount = intervalCount;
        this.customIntervalUnit = customIntervalUnit;
        this.anchorDate = Objects.requireNonNull(anchorDate);
        this.monthDayPolicy = Objects.requireNonNull(monthDayPolicy);
        this.variableAmount = variableAmount;
        this.maskedPaymentLabel = maskedPaymentLabel;
        this.status = Objects.requireNonNull(status);
        this.updatedAt = Objects.requireNonNull(now);
    }

    UUID id() {
        return id;
    }

    UUID householdId() {
        return householdId;
    }

    UUID dataOwnerUserId() {
        return dataOwnerUserId;
    }

    UUID responsibleMemberId() {
        return responsibleMemberId;
    }

    UUID merchantId() {
        return merchantId;
    }

    String displayName() {
        return displayName;
    }

    CommitmentCategory category() {
        return category;
    }

    PaymentRail paymentRail() {
        return paymentRail;
    }

    Long amountMinor() {
        return amountMinor;
    }

    Long estimatedAmountMinor() {
        return estimatedAmountMinor;
    }

    String currency() {
        return currency;
    }

    RecurrenceFrequency frequency() {
        return frequency;
    }

    int intervalCount() {
        return intervalCount;
    }

    CustomIntervalUnit customIntervalUnit() {
        return customIntervalUnit;
    }

    LocalDate anchorDate() {
        return anchorDate;
    }

    MonthDayPolicy monthDayPolicy() {
        return monthDayPolicy;
    }

    LocalDate nextDueDate() {
        return nextDueDate;
    }

    void nextDueDate(LocalDate nextDueDate) {
        this.nextDueDate = nextDueDate;
    }

    boolean variableAmount() {
        return variableAmount;
    }

    String maskedPaymentLabel() {
        return maskedPaymentLabel;
    }

    CommitmentSource source() {
        return source;
    }

    Integer sourceConfidence() {
        return sourceConfidence;
    }

    CommitmentVisibility visibility() {
        return visibility;
    }

    CommitmentStatus status() {
        return status;
    }

    long version() {
        return version == null ? 0 : version;
    }

    Instant createdAt() {
        return createdAt;
    }

    Instant updatedAt() {
        return updatedAt;
    }

    AmountKind amountKind() {
        if (!variableAmount) {
            return AmountKind.FIXED;
        }
        return estimatedAmountMinor == null
                ? AmountKind.UNKNOWN_VARIABLE
                : AmountKind.ESTIMATED;
    }

    Long expectedAmountMinor() {
        return variableAmount ? estimatedAmountMinor : amountMinor;
    }
}
