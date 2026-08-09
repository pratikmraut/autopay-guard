package in.autopayguard.api.audit;

import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/admin/audit-events")
@PreAuthorize("hasRole('AUDIT_READ')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "audit administration")
@Validated
class AdminAuditEventController {

    private final AdminAuditEventService service;

    AdminAuditEventController(AdminAuditEventService service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listAdminAuditEvents",
            summary = "List the bounded redacted local-application audit",
            description =
                    "This is a local application audit, not a legal compliance report. "
                            + "Every successful read appends an AUDIT_EVENTS_VIEWED event.",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Redacted audit event collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminAuditEventCollectionResponse> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.list(jwt, cursor, limit));
    }
}
