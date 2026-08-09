package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "ConsentCollection",
        requiredProperties = {
            "purpose", "currentPurposeVersion", "currentAction", "events", "nextCursor"
        })
public record ConsentCollectionResponse(
        ConsentPurpose purpose,
        @Schema(
                        nullable = true,
                        maxLength = 64,
                        pattern = "^[a-z0-9][a-z0-9._-]{0,63}$")
                String currentPurposeVersion,
        @Schema(nullable = true) ConsentAction currentAction,
        List<ConsentEventResponse> events,
        @Schema(nullable = true) UUID nextCursor) {}
