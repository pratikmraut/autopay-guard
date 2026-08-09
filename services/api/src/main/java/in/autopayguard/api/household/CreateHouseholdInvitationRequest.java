package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(
        name = "CreateHouseholdInvitationRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = "inviteeEmail")
public record CreateHouseholdInvitationRequest(
        @NotBlank
                @Email
                @Size(min = 3, max = 320)
                @Schema(
                        format = "email",
                        minLength = 3,
                        maxLength = 320,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String inviteeEmail) {}
