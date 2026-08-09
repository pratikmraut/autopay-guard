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
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/notification-preferences")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "notifications")
public class NotificationPreferenceController {

    private final NotificationPreferenceService service;

    NotificationPreferenceController(NotificationPreferenceService service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getNotificationPreferences",
            summary = "Get the current user's global notification preferences",
            description = "A missing record is represented as disabled synthetic version 0.",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Global preferences",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        description = "Quoted numeric optimistic version"))
            })
    ResponseEntity<NotificationPreferencesResponse> get(
            @AuthenticationPrincipal Jwt jwt) {
        NotificationPreferencesResponse result = service.get(jwt);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }

    @PutMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "updateNotificationPreferences",
            summary = "Replace the current user's global notification preferences",
            description =
                    "The first explicit opt-in or saved opt-out uses If-Match \"0\". "
                            + "Later writes use the latest returned ETag.",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Preferences replaced",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        description = "New quoted numeric optimistic version")),
                @ApiResponse(
                        responseCode = "400",
                        description = "Validation or If-Match syntax failed",
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
    ResponseEntity<NotificationPreferencesResponse> update(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(
                            required = true,
                            description = "One quoted non-negative numeric ETag.",
                            schema =
                                    @Schema(
                                            pattern = "^\\\"(0|[1-9][0-9]*)\\\"$",
                                            example = "\"0\""))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch,
            @Valid @RequestBody UpdateNotificationPreferencesRequest request) {
        NotificationPreferencesResponse result =
                service.update(jwt, EntityTags.requiredVersion(ifMatch), request);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }
}
