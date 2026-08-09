package in.autopayguard.api.reminder;

import in.autopayguard.api.notification.NotificationChannel;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        name = "ReminderRule",
        requiredProperties = {
            "channel", "offsetDays", "localSendTime", "enabled"
        })
public record ReminderRuleResponse(
        NotificationChannel channel,
        @Schema(minimum = "0", maximum = "90") int offsetDays,
        @Schema(example = "09:00", pattern = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
                String localSendTime,
        boolean enabled) {}
