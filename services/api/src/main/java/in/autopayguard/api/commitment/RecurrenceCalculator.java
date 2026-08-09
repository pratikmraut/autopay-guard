package in.autopayguard.api.commitment;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class RecurrenceCalculator {

    public LocalDate dateAt(RecurrenceRule rule, long index) {
        if (index < 0) {
            throw new IllegalArgumentException("index must be non-negative");
        }
        long dayStep = dayStep(rule);
        if (dayStep > 0) {
            return rule.anchorDate().plusDays(Math.multiplyExact(dayStep, index));
        }

        long monthStep = monthStep(rule);
        YearMonth target =
                YearMonth.from(rule.anchorDate())
                        .plusMonths(Math.multiplyExact(monthStep, index));
        if (rule.monthDayPolicy() == MonthDayPolicy.LAST_DAY) {
            return target.atEndOfMonth();
        }
        return target.atDay(
                Math.min(rule.anchorDate().getDayOfMonth(), target.lengthOfMonth()));
    }

    public LocalDate nextOnOrAfter(RecurrenceRule rule, LocalDate lowerBound) {
        return dateAt(rule, firstIndexOnOrAfter(rule, lowerBound));
    }

    public List<LocalDate> datesBetween(
            RecurrenceRule rule, LocalDate fromInclusive, LocalDate toInclusive) {
        if (toInclusive.isBefore(fromInclusive) || toInclusive.isBefore(rule.anchorDate())) {
            return List.of();
        }
        long index = firstIndexOnOrAfter(rule, fromInclusive);
        List<LocalDate> dates = new ArrayList<>();
        while (true) {
            LocalDate date = dateAt(rule, index);
            if (date.isAfter(toInclusive)) {
                return List.copyOf(dates);
            }
            dates.add(date);
            index = Math.incrementExact(index);
        }
    }

    private long firstIndexOnOrAfter(RecurrenceRule rule, LocalDate lowerBound) {
        if (!lowerBound.isAfter(rule.anchorDate())) {
            return 0;
        }
        long dayStep = dayStep(rule);
        if (dayStep > 0) {
            long days = ChronoUnit.DAYS.between(rule.anchorDate(), lowerBound);
            return Math.floorDiv(days + dayStep - 1, dayStep);
        }

        long step = monthStep(rule);
        long elapsedMonths =
                ChronoUnit.MONTHS.between(
                        YearMonth.from(rule.anchorDate()), YearMonth.from(lowerBound));
        long candidate = Math.max(0, Math.floorDiv(elapsedMonths, step) - 1);
        while (dateAt(rule, candidate).isBefore(lowerBound)) {
            candidate = Math.incrementExact(candidate);
        }
        while (candidate > 0 && !dateAt(rule, candidate - 1).isBefore(lowerBound)) {
            candidate--;
        }
        return candidate;
    }

    private static long dayStep(RecurrenceRule rule) {
        return switch (rule.frequency()) {
            case WEEKLY -> Math.multiplyExact(7L, rule.intervalCount());
            case CUSTOM ->
                    switch (rule.customIntervalUnit()) {
                        case DAYS -> rule.intervalCount();
                        case WEEKS -> Math.multiplyExact(7L, rule.intervalCount());
                        case MONTHS, YEARS -> 0;
                    };
            case MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY -> 0;
        };
    }

    private static long monthStep(RecurrenceRule rule) {
        return switch (rule.frequency()) {
            case MONTHLY -> rule.intervalCount();
            case QUARTERLY -> Math.multiplyExact(3L, rule.intervalCount());
            case HALF_YEARLY -> Math.multiplyExact(6L, rule.intervalCount());
            case YEARLY -> Math.multiplyExact(12L, rule.intervalCount());
            case CUSTOM ->
                    switch (rule.customIntervalUnit()) {
                        case MONTHS -> rule.intervalCount();
                        case YEARS -> Math.multiplyExact(12L, rule.intervalCount());
                        case DAYS, WEEKS ->
                                throw new IllegalArgumentException(
                                        "A day recurrence has no month step.");
                    };
            case WEEKLY ->
                    throw new IllegalArgumentException(
                            "A weekly recurrence has no month step.");
        };
    }
}
