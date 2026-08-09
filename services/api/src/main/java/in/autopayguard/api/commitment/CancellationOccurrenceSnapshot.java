package in.autopayguard.api.commitment;

import java.time.LocalDate;
import java.util.UUID;

public record CancellationOccurrenceSnapshot(
        UUID id,
        LocalDate scheduledDate,
        Long expectedAmountMinor,
        String currency,
        AmountKind amountKind,
        CancellationCommitmentSnapshot commitment) {}
