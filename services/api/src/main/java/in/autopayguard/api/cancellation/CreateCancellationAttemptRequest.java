package in.autopayguard.api.cancellation;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

@Schema(
        name = "CreateCancellationAttemptRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {
            "occurrenceId", "decisionId", "guideId", "guideVersion", "note"
        })
public record CreateCancellationAttemptRequest(
        @NotNull
                @Schema(format = "uuid", requiredMode = Schema.RequiredMode.REQUIRED)
                UUID occurrenceId,
        @NotNull
                @Schema(format = "uuid", requiredMode = Schema.RequiredMode.REQUIRED)
                UUID decisionId,
        @NotNull
                @Schema(format = "uuid", requiredMode = Schema.RequiredMode.REQUIRED)
                UUID guideId,
        @Min(1) @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int guideVersion,
        @JsonProperty(required = true)
                @Size(min = 1, max = 500)
                @Schema(nullable = true, requiredMode = Schema.RequiredMode.REQUIRED)
                String note) {}
