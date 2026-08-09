package in.autopayguard.api.commitment;

import java.time.LocalDate;
import java.util.UUID;

public record ImportedCommitmentCommand(
        UUID householdId,
        UUID ownerUserId,
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
        String importFingerprint) {}
