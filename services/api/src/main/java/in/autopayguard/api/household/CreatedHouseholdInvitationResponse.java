package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        name = "CreatedHouseholdInvitation",
        requiredProperties = {"invitation", "invitationCode", "emailSent"})
public record CreatedHouseholdInvitationResponse(
        HouseholdInvitationResponse invitation,
        @Schema(
                        minLength = 43,
                        maxLength = 43,
                        pattern = "^[A-Za-z0-9_-]{43}$")
                String invitationCode,
        boolean emailSent) {}
