package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.ValidationException;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@Schema(
        name = "CreateCorrectionPrivacyRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"requestType", "correctionValue"})
public record CreateCorrectionPrivacyRequest(
        @NotNull
                @Schema(
                        allowableValues = "CORRECTION",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                PrivacyRequestType requestType,
        @NotBlank
                @Size(min = 1, max = 64)
                @Schema(
                        minLength = 1,
                        maxLength = 64,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String correctionValue)
        implements CreatePrivacyRequest {

    public CreateCorrectionPrivacyRequest {
        if (requestType != PrivacyRequestType.CORRECTION) {
            throw new ValidationException("requestType must be CORRECTION.");
        }
    }
}
