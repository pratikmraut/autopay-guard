package in.autopayguard.api.commitment;

import java.time.LocalDate;

public record RecurrenceRule(
        LocalDate anchorDate,
        RecurrenceFrequency frequency,
        int intervalCount,
        CustomIntervalUnit customIntervalUnit,
        MonthDayPolicy monthDayPolicy) {}
