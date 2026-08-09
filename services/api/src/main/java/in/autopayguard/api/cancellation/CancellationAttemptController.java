package in.autopayguard.api.cancellation;

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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "cancellation")
@Validated
class CancellationAttemptController {

    private final CancellationAttemptService service;

    CancellationAttemptController(CancellationAttemptService service) {
        this.service = service;
    }

    @PostMapping(
            value = "/commitments/{commitmentId}/cancellation-attempts",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "createCancellationAttempt",
            summary = "Start an idempotent cancellation attempt",
            responses = {
                @ApiResponse(
                        responseCode = "201",
                        description = "Attempt created",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        schema =
                                                @Schema(
                                                        type = "string",
                                                        pattern =
                                                                "^\"(0|[1-9][0-9]*)\"$"))),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid request",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned resources not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Attempt conflicts with current state",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<CancellationAttemptResponse> create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID commitmentId,
            @Parameter(
                            required = true,
                            schema =
                                    @Schema(
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[\\x21-\\x7E]{16,100}$"))
                    @RequestHeader("Idempotency-Key")
                    String idempotencyKey,
            @Valid @RequestBody CreateCancellationAttemptRequest request) {
        CancellationAttemptResponse response =
                service.create(jwt, commitmentId, idempotencyKey, request);
        return ResponseEntity.status(201)
                .header(HttpHeaders.ETAG, EntityTags.forVersion(response.version()))
                .body(response);
    }

    @GetMapping(
            value = "/commitments/{commitmentId}/cancellation-attempts",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listCancellationAttempts",
            summary = "List visible cancellation attempts for a commitment",
            responses = {
                @ApiResponse(responseCode = "200", description = "Attempt page"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid page",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Commitment not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    CancellationAttemptPageResponse list(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID commitmentId,
            @RequestParam UUID householdId,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit,
            @RequestParam(required = false)
                    @Size(max = 300)
                    @Pattern(regexp = "^[A-Za-z0-9_-]+$")
                    String cursor) {
        return service.list(jwt, commitmentId, householdId, limit, cursor);
    }

    @GetMapping(
            value = "/cancellation-attempts/{attemptId}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getCancellationAttempt",
            summary = "Get a visible cancellation attempt",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Attempt",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        schema =
                                                @Schema(
                                                        type = "string",
                                                        pattern =
                                                                "^\"(0|[1-9][0-9]*)\"$"))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Attempt not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<CancellationAttemptResponse> get(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID attemptId) {
        CancellationAttemptResponse response = service.get(jwt, attemptId);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, EntityTags.forVersion(response.version()))
                .body(response);
    }

    @PatchMapping(
            value = "/cancellation-attempts/{attemptId}",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "updateCancellationAttempt",
            summary = "Replace track state or abandon with optimistic concurrency",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Attempt updated",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        schema =
                                                @Schema(
                                                        type = "string",
                                                        pattern =
                                                                "^\"(0|[1-9][0-9]*)\"$"))),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid request or ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Attempt not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Invalid state transition",
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
    ResponseEntity<CancellationAttemptResponse> update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID attemptId,
            @Parameter(required = true, schema = @Schema(pattern = "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch,
            @Valid @RequestBody UpdateCancellationAttemptRequest request) {
        CancellationAttemptResponse response =
                service.update(jwt, attemptId, ifMatch, request);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, EntityTags.forVersion(response.version()))
                .body(response);
    }

    @PostMapping(
            value = "/cancellation-attempts/{attemptId}/verify",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "verifyCancellationAttempt",
            summary = "Record a user-attested verification transition",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Verification recorded",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        schema =
                                                @Schema(
                                                        type = "string",
                                                        pattern =
                                                                "^\"(0|[1-9][0-9]*)\"$"))),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid request, idempotency key, or ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Attempt not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Invalid state transition or replay mismatch",
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
    ResponseEntity<CancellationAttemptResponse> verify(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID attemptId,
            @Parameter(required = true, schema = @Schema(pattern = "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch,
            @Parameter(
                            required = true,
                            schema =
                                    @Schema(
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[\\x21-\\x7E]{16,100}$"))
                    @RequestHeader("Idempotency-Key")
                    String idempotencyKey,
            @Valid @RequestBody VerifyCancellationAttemptRequest request) {
        CancellationAttemptResponse response =
                service.verify(jwt, attemptId, ifMatch, idempotencyKey, request);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, EntityTags.forVersion(response.version()))
                .body(response);
    }
}
