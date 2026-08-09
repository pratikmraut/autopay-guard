package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(
        name = "UpdateCancellationAttemptRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"serviceStatus", "paymentMandateStatus", "abandoned"})
public record UpdateCancellationAttemptRequest(
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                CancellationTrackStatus serviceStatus,
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                CancellationTrackStatus paymentMandateStatus,
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                Boolean abandoned) {}
