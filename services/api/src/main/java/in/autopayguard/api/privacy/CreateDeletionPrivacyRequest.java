package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.ValidationException;
import jakarta.validation.constraints.NotNull;

@Schema(
        name = "CreateDeletionPrivacyRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = "requestType")
public record CreateDeletionPrivacyRequest(
        @NotNull
                @Schema(
                        allowableValues = "DELETION",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                PrivacyRequestType requestType)
        implements CreatePrivacyRequest {

    public CreateDeletionPrivacyRequest {
        if (requestType != PrivacyRequestType.DELETION) {
            throw new ValidationException("requestType must be DELETION.");
        }
    }
}
