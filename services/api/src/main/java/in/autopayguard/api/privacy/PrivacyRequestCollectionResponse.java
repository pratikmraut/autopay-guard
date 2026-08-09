package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "PrivacyRequestCollection",
        requiredProperties = {"items", "nextCursor"})
public record PrivacyRequestCollectionResponse(
        List<PrivacyRequestResponse> items,
        @Schema(nullable = true) UUID nextCursor) {}
