package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.AmountKind;
import in.autopayguard.api.commitment.CancellationOccurrenceSnapshot;
import in.autopayguard.api.commitment.RecurrenceCalculator;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
class SavingsCalculator {

    private final RecurrenceCalculator recurrenceCalculator;

    SavingsCalculator(RecurrenceCalculator recurrenceCalculator) {
        this.recurrenceCalculator = recurrenceCalculator;
    }

    SavingsProjection calculate(CancellationOccurrenceSnapshot occurrence) {
        LocalDate start = occurrence.scheduledDate();
        LocalDate end = start.plusYears(1).minusDays(1);
        if (occurrence.amountKind() == AmountKind.UNKNOWN_VARIABLE) {
            return new SavingsProjection(null, false, start, end);
        }
        List<LocalDate> recurrenceDates =
                recurrenceCalculator.datesBetween(
                        occurrence.commitment().recurrenceRule(), start, end);
        if (!recurrenceDates.contains(start)) {
            throw new IllegalStateException(
                    "The occurrence is not represented by its recurrence snapshot.");
        }
        long occurrenceCount = recurrenceDates.size();
        long amount =
                SavingsAmounts.multiplyExactBounded(
                        occurrence.expectedAmountMinor(), occurrenceCount);
        if (amount < 1) {
            throw new IllegalStateException(
                    "Projected savings must be a positive minor-unit amount.");
        }
        return new SavingsProjection(
                amount,
                occurrence.amountKind() == AmountKind.ESTIMATED,
                start,
                end);
    }
}
