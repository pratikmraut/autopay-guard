package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        name = "PrivacyNotice",
        requiredProperties = {
            "noticeVersion", "contentSha256", "acknowledgementType"
        })
public record PrivacyNoticeResponse(
        @Schema(maxLength = 64) String noticeVersion,
        @Schema(pattern = "^[a-f0-9]{64}$", minLength = 64, maxLength = 64)
                String contentSha256,
        @Schema(allowableValues = "ACKNOWLEDGED") String acknowledgementType) {}
