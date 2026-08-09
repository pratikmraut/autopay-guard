package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(name = "Household")
public record HouseholdResponse(
        @Schema(format = "uuid", requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
        @Schema(example = "My household", requiredMode = Schema.RequiredMode.REQUIRED)
                String name,
        @Schema(format = "uuid", requiredMode = Schema.RequiredMode.REQUIRED)
                UUID ownerUserId,
        @Schema(
                        example = "INR",
                        minLength = 3,
                        maxLength = 3,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String defaultCurrency,
        @Schema(example = "Asia/Kolkata", requiredMode = Schema.RequiredMode.REQUIRED)
                String timezone,
        @Schema(format = "date-time", requiredMode = Schema.RequiredMode.REQUIRED)
                Instant createdAt,
        @Schema(format = "date-time", requiredMode = Schema.RequiredMode.REQUIRED)
                Instant updatedAt,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                HouseholdMemberRole accessRole,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                boolean canManage) {}
