package in.autopayguard.api.notification;

import in.autopayguard.api.common.error.ApiProblem;
import in.autopayguard.api.common.web.EntityTags;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/notifications")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "notifications")
@Validated
public class NotificationController {

    private final NotificationQueryService service;

    NotificationController(NotificationQueryService service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listNotifications",
            summary = "List visible notification activity",
            description =
                    "Returns a bounded page for one accessible household. "
                            + "Provider identifiers, recipient addresses, and raw errors are never returned.",
            responses = {
                @ApiResponse(responseCode = "200", description = "Notification page"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid filter, cursor, or limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Accessible household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    NotificationPageResponse list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID householdId,
            @RequestParam(defaultValue = "ALL") NotificationFilter filter,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit,
            @RequestParam(required = false)
                    @Size(max = 200)
                    @Pattern(regexp = "^[A-Za-z0-9_-]+$")
                    String cursor) {
        return service.list(jwt, householdId, filter, limit, cursor);
    }

    @GetMapping(
            value = "/{notificationId}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getNotification",
            summary = "Get one visible notification",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Visible notification",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        description = "Quoted numeric optimistic version")),
                @ApiResponse(
                        responseCode = "404",
                        description = "Notification not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<NotificationResponse> get(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID notificationId) {
        NotificationResponse result = service.get(jwt, notificationId);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }

    @PatchMapping(
            value = "/{notificationId}",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "updateNotificationReadState",
            summary = "Mark an owned notification read or unread",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Read state updated",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        description = "New quoted numeric optimistic version")),
                @ApiResponse(
                        responseCode = "400",
                        description = "Validation or If-Match syntax failed",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Notification not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "412",
                        description = "ETag is stale",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "428",
                        description = "If-Match is required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<NotificationResponse> updateRead(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID notificationId,
            @Parameter(
                            required = true,
                            description = "One quoted non-negative numeric ETag.",
                            schema =
                                    @Schema(
                                            pattern = "^\\\"(0|[1-9][0-9]*)\\\"$",
                                            example = "\"0\""))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch,
            @Valid @RequestBody UpdateNotificationReadRequest request) {
        NotificationResponse result =
                service.updateRead(
                        jwt,
                        notificationId,
                        EntityTags.requiredVersion(ifMatch),
                        request.read());
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }
}
