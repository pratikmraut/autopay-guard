package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "HouseholdMemberCollection",
        requiredProperties = {"items", "nextCursor"})
public record HouseholdMemberCollectionResponse(
        List<HouseholdMemberResponse> items,
        @Schema(nullable = true) UUID nextCursor) {}
