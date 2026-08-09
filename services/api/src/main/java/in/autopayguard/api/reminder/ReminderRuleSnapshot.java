package in.autopayguard.api.reminder;

import in.autopayguard.api.notification.NotificationChannel;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

public record ReminderRuleSnapshot(
        UUID id,
        NotificationChannel channel,
        int offsetDays,
        LocalTime localSendTime,
        boolean enabled,
        Instant activatedAt) {}
