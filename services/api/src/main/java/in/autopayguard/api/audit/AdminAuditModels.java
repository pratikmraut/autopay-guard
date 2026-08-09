package in.autopayguard.api.audit;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "AdminAuditEventCollection",
        requiredProperties = {"items", "nextCursor"})
record AdminAuditEventCollectionResponse(
        List<AdminAuditEventResponse> items,
        @Schema(nullable = true) UUID nextCursor) {}

@Schema(
        name = "AdminAuditEvent",
        requiredProperties = {
            "id",
            "occurredAt",
            "actorRole",
            "action",
            "resourceType",
            "resourceId",
            "outcome",
            "correlationId"
        })
record AdminAuditEventResponse(
        UUID id,
        Instant occurredAt,
        AuditService.ActorRole actorRole,
        AuditService.Action action,
        AuditService.ResourceType resourceType,
        UUID resourceId,
        @Schema(allowableValues = "SUCCEEDED") String outcome,
        @Schema(maxLength = 64, pattern = "^[^\\s]{1,64}$")
                String correlationId) {}
