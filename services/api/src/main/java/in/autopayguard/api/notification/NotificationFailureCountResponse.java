package in.autopayguard.api.notification;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        name = "NotificationFailureCount",
        requiredProperties = {"category", "count"})
public record NotificationFailureCountResponse(
        NotificationFailureCategory category, long count) {}
