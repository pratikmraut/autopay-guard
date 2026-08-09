package in.autopayguard.api.support;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(
        name = "ResolveSupportDiagnosticsRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = "supportCode")
public record ResolveSupportDiagnosticsRequest(
        @NotBlank
                @Size(min = 43, max = 43)
                @Pattern(regexp = "^[A-Za-z0-9_-]{43}$")
                @Schema(
                        minLength = 43,
                        maxLength = 43,
                        pattern = "^[A-Za-z0-9_-]{43}$",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String supportCode) {}
