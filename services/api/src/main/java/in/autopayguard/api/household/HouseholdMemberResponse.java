package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(
        name = "HouseholdMember",
        requiredProperties = {
            "id",
            "userId",
            "displayName",
            "role",
            "status",
            "version",
            "joinedAt",
            "removedAt"
        })
public record HouseholdMemberResponse(
        UUID id,
        UUID userId,
        String displayName,
        HouseholdMemberRole role,
        HouseholdMemberStatus status,
        @Schema(minimum = "0") long version,
        Instant joinedAt,
        @Schema(nullable = true) Instant removedAt) {}
