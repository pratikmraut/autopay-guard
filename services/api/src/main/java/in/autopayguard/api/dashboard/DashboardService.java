package in.autopayguard.api.dashboard;

import in.autopayguard.api.commitment.AmountKind;
import in.autopayguard.api.commitment.CommitmentProjection;
import in.autopayguard.api.commitment.CommitmentService;
import in.autopayguard.api.commitment.OccurrenceReconciliationService;
import in.autopayguard.api.commitment.OwnedCommitmentProjections;
import in.autopayguard.api.commitment.RecurrenceCalculator;
import in.autopayguard.api.commitment.UpcomingItemResponse;
import in.autopayguard.api.commitment.UpcomingListResponse;
import in.autopayguard.api.common.error.RequestConflictException;
import jakarta.validation.ValidationException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {

    private static final long JAVASCRIPT_MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    private final CommitmentService commitmentService;
    private final RecurrenceCalculator recurrenceCalculator;

    DashboardService(
            CommitmentService commitmentService,
            RecurrenceCalculator recurrenceCalculator) {
        this.commitmentService = commitmentService;
        this.recurrenceCalculator = recurrenceCalculator;
    }

    public DashboardSummaryResponse summary(
            Jwt jwt, UUID householdId, String requestedMonth) {
        YearMonth month = parseMonth(requestedMonth);
        LocalDate monthlyFrom = month.atDay(1);
        LocalDate monthlyTo = month.atEndOfMonth();
        LocalDate annualizedFrom = monthlyFrom;
        LocalDate annualizedTo = monthlyFrom.plusMonths(12).minusDays(1);

        OwnedCommitmentProjections owned =
                commitmentService.requireVisibleActive(jwt, householdId);
        List<CommitmentProjection> commitments = owned.commitments();
        ProjectionAccumulator monthly = new ProjectionAccumulator(monthlyFrom, monthlyTo);
        ProjectionAccumulator annualized =
                new ProjectionAccumulator(annualizedFrom, annualizedTo);
        for (CommitmentProjection commitment : commitments) {
            monthly.add(
                    commitment,
                    recurrenceCalculator.datesBetween(
                            commitment.recurrenceRule(), monthlyFrom, monthlyTo));
            annualized.add(
                    commitment,
                    recurrenceCalculator.datesBetween(
                            commitment.recurrenceRule(), annualizedFrom, annualizedTo));
        }

        long variableCount =
                commitments.stream().filter(CommitmentProjection::variableAmount).count();
        long unknownVariableCount =
                commitments.stream()
                        .filter(
                                commitment ->
                                        commitment.variableAmount()
                                                && commitment.estimatedAmountMinor() == null)
                        .count();
        return new DashboardSummaryResponse(
                householdId,
                month.toString(),
                commitments.size(),
                variableCount,
                unknownVariableCount,
                monthly.toResponse(),
                annualized.toResponse());
    }

    public DashboardCalendarResponse calendar(
            Jwt jwt, UUID householdId, LocalDate from, LocalDate to) {
        UpcomingListResponse upcoming =
                commitmentService.upcoming(jwt, householdId, from, to);
        Map<LocalDate, List<UpcomingItemResponse>> byDate =
                upcoming.items().stream()
                        .collect(
                                Collectors.groupingBy(
                                        UpcomingItemResponse::scheduledDate,
                                        TreeMap::new,
                                        Collectors.toList()));
        List<CalendarDayResponse> days = new ArrayList<>();
        LocalDate date = from;
        while (!date.isAfter(to)) {
            List<UpcomingItemResponse> items =
                    List.copyOf(byDate.getOrDefault(date, List.of()));
            ProjectionAccumulator totals = new ProjectionAccumulator(date, date);
            for (UpcomingItemResponse item : items) {
                totals.add(item);
            }
            days.add(new CalendarDayResponse(date, items, totals.currencyTotals()));
            date = date.plusDays(1);
        }
        return new DashboardCalendarResponse(
                householdId, from, to, List.copyOf(days));
    }

    private static YearMonth parseMonth(String value) {
        try {
            YearMonth month = YearMonth.parse(value);
            if (month.isBefore(YearMonth.of(1900, 1))
                    || month.isAfter(YearMonth.of(2200, 12))) {
                throw new ValidationException(
                        "month must be between 1900-01 and 2200-12.");
            }
            return month;
        } catch (DateTimeParseException | NullPointerException exception) {
            throw new ValidationException("month must use the YYYY-MM format.");
        }
    }

    private static long safeAdd(long left, long right) {
        try {
            long result = Math.addExact(left, right);
            if (result > JAVASCRIPT_MAX_SAFE_INTEGER) {
                throw new ArithmeticException();
            }
            return result;
        } catch (ArithmeticException exception) {
            throw new RequestConflictException(
                    "The projection exceeds the supported safe integer range.");
        }
    }

    private static final class ProjectionAccumulator {

        private final LocalDate from;
        private final LocalDate to;
        private final Map<String, CurrencyAccumulator> currencies = new TreeMap<>();
        private long occurrenceCount;
        private long unknownVariableOccurrenceCount;

        private ProjectionAccumulator(LocalDate from, LocalDate to) {
            this.from = from;
            this.to = to;
        }

        private void add(
                CommitmentProjection commitment, List<LocalDate> occurrenceDates) {
            for (LocalDate ignored : occurrenceDates) {
                add(
                        commitment.currency(),
                        commitment.amountKind(),
                        commitment.expectedAmountMinor());
            }
        }

        private void add(UpcomingItemResponse item) {
            add(item.currency(), item.amountKind(), item.expectedAmountMinor());
        }

        private void add(String currency, AmountKind kind, Long amountMinor) {
            occurrenceCount = safeAdd(occurrenceCount, 1);
            if (kind == AmountKind.UNKNOWN_VARIABLE) {
                unknownVariableOccurrenceCount =
                        safeAdd(unknownVariableOccurrenceCount, 1);
            }
            currencies
                    .computeIfAbsent(currency, ignored -> new CurrencyAccumulator(currency))
                    .add(kind, amountMinor);
        }

        private ProjectionPeriodResponse toResponse() {
            return new ProjectionPeriodResponse(
                    from,
                    to,
                    occurrenceCount,
                    unknownVariableOccurrenceCount,
                    currencyTotals());
        }

        private List<CurrencyProjectionResponse> currencyTotals() {
            return currencies.values().stream()
                    .map(CurrencyAccumulator::toResponse)
                    .toList();
        }
    }

    private static final class CurrencyAccumulator {

        private final String currency;
        private long fixedAmountMinor;
        private long estimatedVariableAmountMinor;
        private long fixedOccurrenceCount;
        private long estimatedVariableOccurrenceCount;
        private long unknownVariableOccurrenceCount;

        private CurrencyAccumulator(String currency) {
            this.currency = currency;
        }

        private void add(AmountKind kind, Long amountMinor) {
            switch (kind) {
                case FIXED -> {
                    fixedAmountMinor = safeAdd(fixedAmountMinor, amountMinor);
                    fixedOccurrenceCount = safeAdd(fixedOccurrenceCount, 1);
                }
                case ESTIMATED -> {
                    estimatedVariableAmountMinor =
                            safeAdd(estimatedVariableAmountMinor, amountMinor);
                    estimatedVariableOccurrenceCount =
                            safeAdd(estimatedVariableOccurrenceCount, 1);
                }
                case UNKNOWN_VARIABLE ->
                        unknownVariableOccurrenceCount =
                                safeAdd(unknownVariableOccurrenceCount, 1);
            }
        }

        private CurrencyProjectionResponse toResponse() {
            return new CurrencyProjectionResponse(
                    currency,
                    fixedAmountMinor,
                    estimatedVariableAmountMinor,
                    safeAdd(fixedAmountMinor, estimatedVariableAmountMinor),
                    fixedOccurrenceCount,
                    estimatedVariableOccurrenceCount,
                    unknownVariableOccurrenceCount,
                    estimatedVariableOccurrenceCount > 0);
        }
    }
}
