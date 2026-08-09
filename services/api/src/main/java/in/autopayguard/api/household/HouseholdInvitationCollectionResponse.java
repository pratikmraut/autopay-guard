package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "HouseholdInvitationCollection",
        requiredProperties = {"items", "nextCursor"})
public record HouseholdInvitationCollectionResponse(
        List<HouseholdInvitationResponse> items,
        @Schema(nullable = true) UUID nextCursor) {}
