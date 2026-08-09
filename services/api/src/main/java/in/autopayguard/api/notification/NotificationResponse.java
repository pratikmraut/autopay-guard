package in.autopayguard.api.notification;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Schema(
        name = "Notification",
        requiredProperties = {
            "id",
            "householdId",
            "commitmentId",
            "scheduledDate",
            "channel",
            "offsetDays",
            "plannedFor",
            "status",
            "read",
            "version",
            "failureCategory",
            "nextAttemptAt",
            "deliveredAt",
            "createdAt"
        })
public record NotificationResponse(
        @Schema(format = "uuid") UUID id,
        @Schema(format = "uuid") UUID householdId,
        @Schema(format = "uuid") UUID commitmentId,
        @Schema(format = "date") LocalDate scheduledDate,
        NotificationChannel channel,
        int offsetDays,
        @Schema(format = "date-time") Instant plannedFor,
        NotificationStatus status,
        boolean read,
        long version,
        NotificationFailureCategory failureCategory,
        @Schema(nullable = true, format = "date-time") Instant nextAttemptAt,
        @Schema(nullable = true, format = "date-time") Instant deliveredAt,
        @Schema(format = "date-time") Instant createdAt) {}
