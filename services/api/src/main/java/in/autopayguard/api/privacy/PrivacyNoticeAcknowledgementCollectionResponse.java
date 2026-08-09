package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "PrivacyNoticeAcknowledgementCollection",
        requiredProperties = {"items", "nextCursor"})
public record PrivacyNoticeAcknowledgementCollectionResponse(
        List<PrivacyNoticeAcknowledgementResponse> items,
        @Schema(nullable = true) UUID nextCursor) {}
