package in.autopayguard.api.commitment;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class RecurrenceCalculatorTest {

    private final RecurrenceCalculator calculator = new RecurrenceCalculator();

    @Test
    void anchorDayClampsShortMonthThenRestoresOriginalDay() {
        RecurrenceRule rule =
                rule(
                        LocalDate.of(2026, 1, 30),
                        RecurrenceFrequency.MONTHLY,
                        1,
                        null,
                        MonthDayPolicy.ANCHOR_DAY);

        assertThat(calculator.dateAt(rule, 0)).isEqualTo("2026-01-30");
        assertThat(calculator.dateAt(rule, 1)).isEqualTo("2026-02-28");
        assertThat(calculator.dateAt(rule, 2)).isEqualTo("2026-03-30");
        assertThat(calculator.dateAt(rule, 13)).isEqualTo("2027-02-28");
    }

    @Test
    void lastDayTracksLeapAndNonLeapMonthEnds() {
        RecurrenceRule rule =
                rule(
                        LocalDate.of(2024, 1, 31),
                        RecurrenceFrequency.MONTHLY,
                        1,
                        null,
                        MonthDayPolicy.LAST_DAY);

        assertThat(calculator.dateAt(rule, 1)).isEqualTo("2024-02-29");
        assertThat(calculator.dateAt(rule, 2)).isEqualTo("2024-03-31");
        assertThat(calculator.dateAt(rule, 13)).isEqualTo("2025-02-28");
    }

    @Test
    void standardAndCustomIntervalsHaveExplicitStableUnits() {
        LocalDate anchor = LocalDate.of(2026, 2, 10);
        assertThat(
                        calculator.dateAt(
                                rule(
                                        anchor,
                                        RecurrenceFrequency.WEEKLY,
                                        2,
                                        null,
                                        MonthDayPolicy.ANCHOR_DAY),
                                3))
                .isEqualTo("2026-03-24");
        assertThat(
                        calculator.dateAt(
                                rule(
                                        anchor,
                                        RecurrenceFrequency.QUARTERLY,
                                        2,
                                        null,
                                        MonthDayPolicy.ANCHOR_DAY),
                                2))
                .isEqualTo("2027-02-10");
        assertThat(
                        calculator.dateAt(
                                rule(
                                        anchor,
                                        RecurrenceFrequency.HALF_YEARLY,
                                        1,
                                        null,
                                        MonthDayPolicy.ANCHOR_DAY),
                                2))
                .isEqualTo("2027-02-10");
        assertThat(
                        calculator.dateAt(
                                rule(
                                        anchor,
                                        RecurrenceFrequency.YEARLY,
                                        2,
                                        null,
                                        MonthDayPolicy.ANCHOR_DAY),
                                2))
                .isEqualTo("2030-02-10");

        assertThat(
                        calculator.dateAt(
                                rule(
                                        anchor,
                                        RecurrenceFrequency.CUSTOM,
                                        3,
                                        CustomIntervalUnit.DAYS,
                                        MonthDayPolicy.ANCHOR_DAY),
                                4))
                .isEqualTo("2026-02-22");
        assertThat(
                        calculator.dateAt(
                                rule(
                                        anchor,
                                        RecurrenceFrequency.CUSTOM,
                                        2,
                                        CustomIntervalUnit.WEEKS,
                                        MonthDayPolicy.ANCHOR_DAY),
                                2))
                .isEqualTo("2026-03-10");
        assertThat(
                        calculator.dateAt(
                                rule(
                                        anchor,
                                        RecurrenceFrequency.CUSTOM,
                                        5,
                                        CustomIntervalUnit.MONTHS,
                                        MonthDayPolicy.ANCHOR_DAY),
                                2))
                .isEqualTo("2026-12-10");
        assertThat(
                        calculator.dateAt(
                                rule(
                                        anchor,
                                        RecurrenceFrequency.CUSTOM,
                                        2,
                                        CustomIntervalUnit.YEARS,
                                        MonthDayPolicy.ANCHOR_DAY),
                                2))
                .isEqualTo("2030-02-10");
    }

    @Test
    void firstDateSearchAndNinetyDayWindowAreInclusive() {
        RecurrenceRule daily =
                rule(
                        LocalDate.of(2026, 7, 1),
                        RecurrenceFrequency.CUSTOM,
                        1,
                        CustomIntervalUnit.DAYS,
                        MonthDayPolicy.ANCHOR_DAY);
        LocalDate today = LocalDate.of(2026, 7, 26);
        List<LocalDate> dates =
                calculator.datesBetween(daily, today, today.plusDays(90));

        assertThat(dates).hasSize(91);
        assertThat(dates.getFirst()).isEqualTo(today);
        assertThat(dates.getLast()).isEqualTo(today.plusDays(90));
    }

    @Test
    void generatedDatesAreStrictlyIncreasingAcrossBoundarySamples() {
        for (int anchorDay = 1; anchorDay <= 31; anchorDay++) {
            LocalDate anchor = LocalDate.of(2024, 1, anchorDay);
            RecurrenceRule rule =
                    rule(
                            anchor,
                            RecurrenceFrequency.MONTHLY,
                            1,
                            null,
                            MonthDayPolicy.ANCHOR_DAY);
            LocalDate previous = calculator.dateAt(rule, 0);
            for (int index = 1; index <= 240; index++) {
                LocalDate current = calculator.dateAt(rule, index);
                assertThat(current).isAfter(previous);
                previous = current;
            }
        }
    }

    private static RecurrenceRule rule(
            LocalDate anchor,
            RecurrenceFrequency frequency,
            int interval,
            CustomIntervalUnit customUnit,
            MonthDayPolicy policy) {
        return new RecurrenceRule(anchor, frequency, interval, customUnit, policy);
    }
}
