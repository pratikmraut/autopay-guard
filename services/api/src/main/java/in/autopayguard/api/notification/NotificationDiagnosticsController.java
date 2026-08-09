package in.autopayguard.api.notification;

import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/notification-diagnostics")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "notifications")
public class NotificationDiagnosticsController {

    private final NotificationQueryService service;

    NotificationDiagnosticsController(NotificationQueryService service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getNotificationDiagnostics",
            summary = "Get safe visible notification diagnostics",
            description =
                    "Returns bounded aggregate state only. It never exposes recipients, "
                            + "provider identifiers, message content, or raw failures.",
            responses = {
                @ApiResponse(responseCode = "200", description = "Safe delivery diagnostics"),
                @ApiResponse(
                        responseCode = "404",
                        description = "Accessible household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    NotificationDiagnosticsResponse get(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID householdId) {
        return service.diagnostics(jwt, householdId);
    }
}
