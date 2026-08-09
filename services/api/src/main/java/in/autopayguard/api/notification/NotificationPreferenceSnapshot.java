package in.autopayguard.api.notification;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.UUID;

public record NotificationPreferenceSnapshot(
        UUID id,
        UUID userId,
        boolean enabled,
        boolean inAppEnabled,
        boolean emailEnabled,
        ZoneId timezone,
        boolean quietHoursEnabled,
        LocalTime quietStart,
        LocalTime quietEnd,
        Instant enabledAt,
        Instant inAppEnabledAt,
        Instant emailEnabledAt,
        long version) {

    public boolean channelEnabled(NotificationChannel channel) {
        return enabled
                && switch (channel) {
                    case IN_APP -> inAppEnabled;
                    case EMAIL -> emailEnabled;
                };
    }

    public Instant activatedAt(NotificationChannel channel) {
        Instant channelActivation =
                switch (channel) {
                    case IN_APP -> inAppEnabledAt;
                    case EMAIL -> emailEnabledAt;
                };
        if (enabledAt == null || channelActivation == null) {
            return null;
        }
        return enabledAt.isAfter(channelActivation) ? enabledAt : channelActivation;
    }
}
