package in.autopayguard.api.cancellation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import in.autopayguard.api.commitment.AmountKind;
import in.autopayguard.api.commitment.CancellationCommitmentSnapshot;
import in.autopayguard.api.commitment.CancellationOccurrenceSnapshot;
import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.commitment.CommitmentStatus;
import in.autopayguard.api.commitment.MonthDayPolicy;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.commitment.RecurrenceCalculator;
import in.autopayguard.api.commitment.RecurrenceFrequency;
import in.autopayguard.api.commitment.RecurrenceRule;
import in.autopayguard.api.common.error.RequestConflictException;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SavingsCalculatorTest {

    private final SavingsCalculator calculator =
            new SavingsCalculator(new RecurrenceCalculator());

    @Test
    void sumsExactMonthlyBoundaryDatesWithoutFrequencyMultipliers() {
        CancellationOccurrenceSnapshot occurrence =
                occurrence(
                        LocalDate.of(2026, 1, 31),
                        100L,
                        AmountKind.FIXED,
                        false,
                        null);

        SavingsProjection result = calculator.calculate(occurrence);

        assertThat(result.periodStart()).isEqualTo(LocalDate.of(2026, 1, 31));
        assertThat(result.periodEnd()).isEqualTo(LocalDate.of(2027, 1, 30));
        assertThat(result.amountMinor()).isEqualTo(1_200L);
        assertThat(result.estimated()).isFalse();
    }

    @Test
    void keepsEstimatedSavingsVisiblyEstimated() {
        CancellationOccurrenceSnapshot occurrence =
                occurrence(
                        LocalDate.of(2026, 1, 31),
                        250L,
                        AmountKind.ESTIMATED,
                        true,
                        250L);

        SavingsProjection result = calculator.calculate(occurrence);

        assertThat(result.amountMinor()).isEqualTo(3_000L);
        assertThat(result.estimated()).isTrue();
    }

    @Test
    void representsUnknownVariableAsUnquantifiedRatherThanZero() {
        CancellationOccurrenceSnapshot occurrence =
                occurrence(
                        LocalDate.of(2026, 1, 31),
                        null,
                        AmountKind.UNKNOWN_VARIABLE,
                        true,
                        null);

        SavingsProjection result = calculator.calculate(occurrence);

        assertThat(result.amountMinor()).isNull();
        assertThat(result.estimated()).isFalse();
    }

    @Test
    void rejectsAnOccurrenceDateMissingFromItsPinnedRecurrence() {
        CancellationOccurrenceSnapshot occurrence =
                occurrence(
                        LocalDate.of(2026, 2, 15),
                        100L,
                        AmountKind.FIXED,
                        false,
                        null);

        assertThatThrownBy(() -> calculator.calculate(occurrence))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("not represented");
    }

    @Test
    void rejectsArithmeticOverflowInsteadOfWrappingProjectedMoney() {
        CancellationOccurrenceSnapshot occurrence =
                occurrence(
                        LocalDate.of(2026, 1, 31),
                        Long.MAX_VALUE,
                        AmountKind.FIXED,
                        false,
                        null);

        assertThatThrownBy(() -> calculator.calculate(occurrence))
                .isInstanceOf(RequestConflictException.class)
                .hasMessageContaining("exact supported");
    }

    private static CancellationOccurrenceSnapshot occurrence(
            LocalDate scheduledDate,
            Long expectedAmount,
            AmountKind amountKind,
            boolean variable,
            Long estimatedAmount) {
        UUID commitmentId = UUID.randomUUID();
        CancellationCommitmentSnapshot commitment =
                new CancellationCommitmentSnapshot(
                        commitmentId,
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        "Demo commitment",
                        CommitmentCategory.SUBSCRIPTION,
                        PaymentRail.CARD_RECURRING,
                        variable ? null : expectedAmount,
                        estimatedAmount,
                        "INR",
                        new RecurrenceRule(
                                LocalDate.of(2026, 1, 31),
                                RecurrenceFrequency.MONTHLY,
                                1,
                                null,
                                MonthDayPolicy.ANCHOR_DAY),
                        variable,
                        CommitmentStatus.ACTIVE,
                        0);
        return new CancellationOccurrenceSnapshot(
                UUID.randomUUID(),
                scheduledDate,
                expectedAmount,
                "INR",
                amountKind,
                commitment);
    }
}
