package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(
        name = "VerifyCancellationAttemptRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"status"})
public record VerifyCancellationAttemptRequest(
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                VerificationOutcome status) {}
