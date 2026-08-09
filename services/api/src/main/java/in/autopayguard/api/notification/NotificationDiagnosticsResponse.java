package in.autopayguard.api.notification;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "NotificationDiagnostics",
        requiredProperties = {
            "householdId",
            "pendingCount",
            "processingCount",
            "retryScheduledCount",
            "deliveredCount",
            "deadCount",
            "suppressedCount",
            "oldestPendingAgeSeconds",
            "nextRetryAt",
            "failures"
        })
public record NotificationDiagnosticsResponse(
        @Schema(format = "uuid") UUID householdId,
        long pendingCount,
        long processingCount,
        long retryScheduledCount,
        long deliveredCount,
        long deadCount,
        long suppressedCount,
        @Schema(nullable = true, format = "int64") Long oldestPendingAgeSeconds,
        @Schema(nullable = true, format = "date-time") Instant nextRetryAt,
        List<NotificationFailureCountResponse> failures) {}
