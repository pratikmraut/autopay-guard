package in.autopayguard.api.support;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;

@Schema(
        name = "CreateSupportCodeRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = "acknowledgeReadOnlyDiagnostics")
public record CreateSupportCodeRequest(
        @AssertTrue
                @Schema(
                        allowableValues = "true",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                boolean acknowledgeReadOnlyDiagnostics) {}
