package in.autopayguard.api.notification;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "NotificationPage",
        requiredProperties = {
            "householdId",
            "filter",
            "items",
            "nextCursor"
        })
public record NotificationPageResponse(
        @Schema(format = "uuid") UUID householdId,
        NotificationFilter filter,
        List<NotificationResponse> items,
        @Schema(nullable = true) String nextCursor) {}
