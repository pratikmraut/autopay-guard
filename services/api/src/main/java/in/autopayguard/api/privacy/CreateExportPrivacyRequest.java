package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.ValidationException;
import jakarta.validation.constraints.NotNull;

@Schema(
        name = "CreateExportPrivacyRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = "requestType")
public record CreateExportPrivacyRequest(
        @NotNull
                @Schema(
                        allowableValues = "EXPORT",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                PrivacyRequestType requestType)
        implements CreatePrivacyRequest {

    public CreateExportPrivacyRequest {
        if (requestType != PrivacyRequestType.EXPORT) {
            throw new ValidationException("requestType must be EXPORT.");
        }
    }
}
