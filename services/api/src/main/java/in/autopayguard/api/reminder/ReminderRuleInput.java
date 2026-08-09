package in.autopayguard.api.reminder;

import in.autopayguard.api.notification.NotificationChannel;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

@Schema(
        name = "ReminderRuleInput",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {
            "channel", "offsetDays", "localSendTime", "enabled"
        })
public record ReminderRuleInput(
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                NotificationChannel channel,
        @NotNull
                @Min(0)
                @Max(90)
                @Schema(minimum = "0", maximum = "90", requiredMode = Schema.RequiredMode.REQUIRED)
                Integer offsetDays,
        @NotNull
                @Pattern(
                        regexp = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
                        message = "must use HH:mm minute precision")
                @Schema(
                        example = "09:00",
                        pattern = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String localSendTime,
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Boolean enabled) {}
