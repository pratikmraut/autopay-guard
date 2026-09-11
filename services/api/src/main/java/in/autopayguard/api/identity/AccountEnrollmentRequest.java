package in.autopayguard.api.identity;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(
        name = "AccountEnrollmentRequest",
        description = "Explicit account enrollment; identity comes only from verified OIDC claims.")
public record AccountEnrollmentRequest(
        @AssertTrue
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                boolean ageConfirmed,
        @AssertTrue
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                boolean privacyNoticeAccepted,
        @NotBlank
                @Size(max = 64)
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = "foundation-v1")
                String privacyNoticeVersion) {}
