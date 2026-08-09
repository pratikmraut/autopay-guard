package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(
        name = "RecordConsentRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"purpose", "purposeVersion", "action"})
public record RecordConsentRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                ConsentPurpose purpose,
        @NotBlank
                @Size(max = 64)
                @Pattern(regexp = "^[a-z0-9][a-z0-9._-]{0,63}$")
                @Schema(
                        maxLength = 64,
                        pattern = "^[a-z0-9][a-z0-9._-]{0,63}$",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String purposeVersion,
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                ConsentAction action) {}
