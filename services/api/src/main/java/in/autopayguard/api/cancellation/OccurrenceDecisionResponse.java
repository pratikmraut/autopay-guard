package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.ReviewAction;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(
        name = "OccurrenceDecision",
        requiredProperties = {
            "id", "occurrenceId", "commitmentId", "householdId", "decision", "createdAt"
        })
public record OccurrenceDecisionResponse(
        @Schema(format = "uuid") UUID id,
        @Schema(format = "uuid") UUID occurrenceId,
        @Schema(format = "uuid") UUID commitmentId,
        @Schema(format = "uuid") UUID householdId,
        ReviewAction decision,
        @Schema(format = "date-time") Instant createdAt) {}
