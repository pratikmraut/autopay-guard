package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        name = "SavingsStateTotal",
        requiredProperties = {
            "state",
            "exactAmountMinor",
            "estimatedAmountMinor",
            "exactAttemptCount",
            "estimatedAttemptCount"
        })
public record SavingsStateTotalResponse(
        SavingsState state,
        @Schema(minimum = "0", maximum = "9007199254740991") long exactAmountMinor,
        @Schema(minimum = "0", maximum = "9007199254740991") long estimatedAmountMinor,
        @Schema(minimum = "0", maximum = "2147483647") int exactAttemptCount,
        @Schema(minimum = "0", maximum = "2147483647") int estimatedAttemptCount) {}
