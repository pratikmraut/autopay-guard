package in.autopayguard.api.identity;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(name = "CurrentUser")
public record CurrentUser(
        @Schema(format = "uuid", requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
        @Schema(
                        format = "email",
                        example = "demo.user@example.test",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String email,
        @Schema(example = "Demo User", requiredMode = Schema.RequiredMode.REQUIRED)
                String displayName,
        @Schema(example = "Asia/Kolkata", requiredMode = Schema.RequiredMode.REQUIRED)
                String timezone,
        @Schema(example = "en-IN", requiredMode = Schema.RequiredMode.REQUIRED) String locale,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean ageConfirmed,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean privacyNoticeAccepted,
        @Schema(
                        nullable = true,
                        example = "foundation-v1",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String privacyNoticeVersion,
        @Schema(format = "date-time", requiredMode = Schema.RequiredMode.REQUIRED)
                Instant createdAt) {}
