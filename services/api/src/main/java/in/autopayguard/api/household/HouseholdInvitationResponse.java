package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(
        name = "HouseholdInvitation",
        requiredProperties = {
            "id",
            "householdId",
            "householdName",
            "inviteeEmail",
            "status",
            "version",
            "expiresAt",
            "createdAt"
        })
public record HouseholdInvitationResponse(
        UUID id,
        UUID householdId,
        String householdName,
        @Schema(maxLength = 320) String inviteeEmail,
        @Schema(allowableValues = {"PENDING", "ACCEPTED", "REVOKED", "EXPIRED"})
                String status,
        @Schema(minimum = "0") long version,
        Instant expiresAt,
        Instant createdAt) {}
