package in.autopayguard.api.commitment;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.UUID;

@Schema(
        name = "Occurrence",
        requiredProperties = {
            "id",
            "commitmentId",
            "scheduledDate",
            "expectedAmountMinor",
            "currency",
            "amountKind",
            "state"
        })
public record OccurrenceResponse(
        UUID id,
        UUID commitmentId,
        LocalDate scheduledDate,
        @Schema(nullable = true, minimum = "1", maximum = "999999999999")
                Long expectedAmountMinor,
        String currency,
        AmountKind amountKind,
        OccurrenceState state) {}
