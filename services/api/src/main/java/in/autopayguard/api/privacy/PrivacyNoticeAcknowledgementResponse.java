package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(
        name = "PrivacyNoticeAcknowledgement",
        requiredProperties = {
            "id", "noticeVersion", "contentSha256", "eventType", "acknowledgedAt"
        })
public record PrivacyNoticeAcknowledgementResponse(
        UUID id,
        @Schema(maxLength = 64) String noticeVersion,
        @Schema(pattern = "^[a-f0-9]{64}$", minLength = 64, maxLength = 64)
                String contentSha256,
        @Schema(allowableValues = "ACKNOWLEDGED") String eventType,
        Instant acknowledgedAt) {}
