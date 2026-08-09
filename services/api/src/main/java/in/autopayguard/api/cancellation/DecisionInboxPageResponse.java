package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "DecisionInboxPage",
        requiredProperties = {"householdId", "from", "to", "items", "nextCursor"})
public record DecisionInboxPageResponse(
        @Schema(format = "uuid") UUID householdId,
        @Schema(format = "date") LocalDate from,
        @Schema(format = "date") LocalDate to,
        List<DecisionInboxItemResponse> items,
        @Schema(nullable = true) String nextCursor) {}
