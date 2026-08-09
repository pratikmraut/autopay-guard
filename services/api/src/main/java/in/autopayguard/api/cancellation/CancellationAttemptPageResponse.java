package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "CancellationAttemptPage",
        requiredProperties = {"householdId", "commitmentId", "items", "nextCursor"})
public record CancellationAttemptPageResponse(
        @Schema(format = "uuid") UUID householdId,
        @Schema(format = "uuid") UUID commitmentId,
        List<CancellationAttemptResponse> items,
        @Schema(nullable = true) String nextCursor) {}
