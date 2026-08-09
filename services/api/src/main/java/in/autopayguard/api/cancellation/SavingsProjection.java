package in.autopayguard.api.cancellation;

import java.time.LocalDate;

record SavingsProjection(
        Long amountMinor,
        boolean estimated,
        LocalDate periodStart,
        LocalDate periodEnd) {}
