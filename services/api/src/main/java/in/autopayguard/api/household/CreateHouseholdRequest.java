package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(
        name = "CreateHouseholdRequest",
        description =
                "Onboarding and household creation are committed atomically. "
                        + "All fields are required.")
public record CreateHouseholdRequest(
        @NotBlank
                @Size(min = 1, max = 120)
                @Schema(
                        example = "My household",
                        minLength = 1,
                        maxLength = 120,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String name,
        @NotBlank
                @Pattern(regexp = "^[A-Z]{3}$", message = "must be a 3-letter uppercase ISO code")
                @Schema(
                        example = "INR",
                        minLength = 3,
                        maxLength = 3,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String defaultCurrency,
        @NotBlank
                @Size(min = 1, max = 64)
                @Schema(
                        example = "Asia/Kolkata",
                        minLength = 1,
                        maxLength = 64,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String timezone,
        @AssertTrue(message = "must be true")
                @Schema(
                        description = "The current user confirms they are at least 18.",
                        example = "true",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                boolean ageConfirmed,
        @AssertTrue(message = "must be true")
                @Schema(
                        description = "The current user accepts the named privacy notice.",
                        example = "true",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                boolean privacyNoticeAccepted,
        @NotBlank
                @Size(min = 1, max = 64)
                @Schema(
                        description =
                                "Must exactly match the privacy notice version supported by the API.",
                        example = "foundation-v1",
                        minLength = 1,
                        maxLength = 64,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String privacyNoticeVersion) {}
