package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(
        name = "AcknowledgePrivacyNoticeRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = "noticeVersion")
public record AcknowledgePrivacyNoticeRequest(
        @NotBlank
                @Size(min = 1, max = 64)
                @Schema(
                        minLength = 1,
                        maxLength = 64,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String noticeVersion) {}
