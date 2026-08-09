package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Schema(
        name = "SavingsItem",
        requiredProperties = {
            "attemptId",
            "commitmentId",
            "displayName",
            "state",
            "amountMinor",
            "currency",
            "estimated",
            "periodStart",
            "periodEnd",
            "reversalReason",
            "updatedAt"
        })
public record SavingsItemResponse(
        @Schema(format = "uuid") UUID attemptId,
        @Schema(format = "uuid") UUID commitmentId,
        String displayName,
        SavingsState state,
        @Schema(nullable = true, minimum = "1", maximum = "9007199254740991")
                Long amountMinor,
        @Schema(pattern = "^[A-Z]{3}$") String currency,
        boolean estimated,
        @Schema(format = "date") LocalDate periodStart,
        @Schema(format = "date") LocalDate periodEnd,
        @Schema(nullable = true) SavingsReversalReason reversalReason,
        @Schema(format = "date-time") Instant updatedAt) {}
