package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "SavingsPage",
        requiredProperties = {
            "householdId",
            "asOf",
            "currencies",
            "unquantifiedCount",
            "items",
            "nextCursor"
        })
public record SavingsPageResponse(
        @Schema(format = "uuid") UUID householdId,
        @Schema(format = "date-time") Instant asOf,
        List<SavingsCurrencySummaryResponse> currencies,
        int unquantifiedCount,
        List<SavingsItemResponse> items,
        @Schema(nullable = true) String nextCursor) {}
