package in.autopayguard.api.cancellation;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

@Schema(
        name = "CreateCancellationGuideFeedbackRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"commitmentId", "guideVersion", "outcome", "note"})
public record CreateCancellationGuideFeedbackRequest(
        @NotNull
                @Schema(format = "uuid", requiredMode = Schema.RequiredMode.REQUIRED)
                UUID commitmentId,
        @Min(1) @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int guideVersion,
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) GuideFeedbackOutcome outcome,
        @JsonProperty(required = true)
                @Size(min = 1, max = 500)
                @Schema(nullable = true, requiredMode = Schema.RequiredMode.REQUIRED)
                String note) {}
