package in.autopayguard.api.support;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        name = "CreatedSupportCode",
        requiredProperties = {"grant", "supportCode"})
public record CreatedSupportCodeResponse(
        SupportCodeResponse grant,
        @Schema(
                        minLength = 43,
                        maxLength = 43,
                        pattern = "^[A-Za-z0-9_-]{43}$")
                String supportCode) {}
