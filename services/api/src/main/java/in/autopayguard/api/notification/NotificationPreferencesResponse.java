package in.autopayguard.api.notification;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(
        name = "NotificationPreferences",
        requiredProperties = {
            "id",
            "enabled",
            "inAppEnabled",
            "emailEnabled",
            "timezone",
            "quietHoursEnabled",
            "quietStart",
            "quietEnd",
            "version",
            "updatedAt"
        })
public record NotificationPreferencesResponse(
        @Schema(nullable = true, format = "uuid") UUID id,
        boolean enabled,
        boolean inAppEnabled,
        boolean emailEnabled,
        String timezone,
        boolean quietHoursEnabled,
        @Schema(
                        nullable = true,
                        example = "22:00",
                        pattern = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
                String quietStart,
        @Schema(
                        nullable = true,
                        example = "07:00",
                        pattern = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
                String quietEnd,
        long version,
        @Schema(nullable = true, format = "date-time") Instant updatedAt) {}
