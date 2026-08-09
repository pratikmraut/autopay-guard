package in.autopayguard.api.privacy;

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
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/admin/privacy/requests")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "privacy administration")
@Validated
public class AdminPrivacyRequestController {

    private final PrivacyRequestService privacyRequestService;

    AdminPrivacyRequestController(PrivacyRequestService privacyRequestService) {
        this.privacyRequestService = privacyRequestService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listAdminPrivacyRequests",
            summary = "List the bounded privacy-administration queue",
            responses = {
                @ApiResponse(responseCode = "200", description = "Privacy request collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<PrivacyRequestCollectionResponse> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(privacyRequestService.listForAdmin(jwt, cursor, limit));
    }

    @PostMapping(value = "/{requestId}/execute", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "executePrivacyRequest",
            summary = "Conditionally execute an eligible correction or deletion request",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Privacy request execution completed or safely blocked",
                        headers =
                                @Header(
                                        name = "ETag",
                                        schema =
                                                @Schema(
                                                        type = "string",
                                                        pattern =
                                                                "^\"(0|[1-9][0-9]*)\"$"))),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid ETag or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Privacy request not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Request state, eligibility, or replay conflicts",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "412",
                        description = "Stale ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "428",
                        description = "If-Match required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<PrivacyRequestResponse> execute(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID requestId,
            @Parameter(
                            required = true,
                            schema = @Schema(pattern = "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = "If-Match", required = false)
                    String ifMatch,
            @Parameter(
                            required = true,
                            schema =
                                    @Schema(
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[\\x21-\\x7E]{16,100}$"))
                    @RequestHeader(value = "Idempotency-Key", required = false)
                    String idempotencyKey) {
        PrivacyRequestResponse response =
                privacyRequestService.execute(
                        jwt,
                        requestId,
                        EntityTags.requiredVersion(ifMatch),
                        idempotencyKey);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }
}
