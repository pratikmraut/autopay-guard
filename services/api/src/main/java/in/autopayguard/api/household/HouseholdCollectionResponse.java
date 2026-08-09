package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "HouseholdList",
        requiredProperties = {"items", "nextCursor"})
public record HouseholdCollectionResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<HouseholdResponse> items,
        @Schema(nullable = true) UUID nextCursor) {

    public HouseholdCollectionResponse {
        items = List.copyOf(items);
    }
}
