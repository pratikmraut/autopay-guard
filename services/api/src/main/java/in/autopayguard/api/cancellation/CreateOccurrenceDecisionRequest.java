package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.ReviewAction;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(
        name = "CreateOccurrenceDecisionRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"decision"})
public record CreateOccurrenceDecisionRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ReviewAction decision) {}
