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
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/privacy/requests")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "privacy requests")
@Validated
public class PrivacyRequestController {

    private final PrivacyRequestService privacyRequestService;

    PrivacyRequestController(PrivacyRequestService privacyRequestService) {
        this.privacyRequestService = privacyRequestService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listPrivacyRequests",
            summary = "List the current subject's privacy requests",
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
                .body(privacyRequestService.listOwn(jwt, cursor, limit));
    }

    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "createPrivacyRequest",
            summary = "Create an idempotent bounded privacy request",
            responses = {
                @ApiResponse(
                        responseCode = "201",
                        description = "Privacy request created",
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
                        description = "Invalid discriminated request or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Request or replay conflicts with current state",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "429",
                        description = "Privacy request rate limit exceeded",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<PrivacyRequestResponse> create(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(
                            required = true,
                            schema =
                                    @Schema(
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[\\x21-\\x7E]{16,100}$"))
                    @RequestHeader(value = "Idempotency-Key", required = false)
                    String idempotencyKey,
            @Valid @RequestBody CreatePrivacyRequest request) {
        PrivacyRequestResponse response =
                privacyRequestService.create(jwt, idempotencyKey, request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }

    @GetMapping(value = "/{requestId}", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getPrivacyRequest",
            summary = "Get one privacy request owned by the current subject",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Privacy request",
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
                        description = "Privacy request not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<PrivacyRequestResponse> get(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID requestId) {
        PrivacyRequestResponse response = privacyRequestService.getOwn(jwt, requestId);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }

    @PostMapping(value = "/{requestId}/cancel", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "cancelPrivacyRequest",
            summary = "Conditionally cancel a request before processing",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Privacy request cancelled",
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
                        description = "Invalid ETag or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Privacy request not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Request state or replay conflicts",
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
    ResponseEntity<PrivacyRequestResponse> cancel(
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
                privacyRequestService.cancel(
                        jwt,
                        requestId,
                        EntityTags.requiredVersion(ifMatch),
                        idempotencyKey);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }

    @GetMapping(value = "/{requestId}/export", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "downloadPrivacyExport",
            summary = "Download the current subject's ready canonical JSON export",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Canonical allowlisted AutoPay Guard JSON export",
                        headers = {
                            @Header(
                                    name = HttpHeaders.CONTENT_DISPOSITION,
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern =
                                                            "^attachment; filename=\\\"autopay-guard-export-v[12]\\.json\\\"$")),
                            @Header(
                                    name = "X-Content-SHA256",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    minLength = 64,
                                                    maxLength = 64,
                                                    pattern = "^[a-f0-9]{64}$")),
                            @Header(
                                    name = HttpHeaders.CONTENT_LENGTH,
                                    schema =
                                            @Schema(
                                                    type = "integer",
                                                    format = "int64",
                                                    minimum = "0",
                                                    maximum = "5242880"))
                        },
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_JSON_VALUE,
                                        schema =
                                                @Schema(
                                                        type = "object",
                                                        additionalProperties =
                                                                Schema.AdditionalPropertiesValue
                                                                        .TRUE))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Privacy request or artifact not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Export is not ready",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "410",
                        description = "Export expired and was removed",
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<byte[]> download(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID requestId) {
        PrivacyRequestService.ExportDownload download =
                privacyRequestService.download(jwt, requestId);
        if (download.expired()) {
            byte[] problem =
                    """
                    {"type":"https://autopayguard.local/problems/export-expired","title":"Export expired","status":410,"detail":"The export artifact has expired and was removed."}
                    """
                            .strip()
                            .getBytes(StandardCharsets.UTF_8);
            return ResponseEntity.status(HttpStatus.GONE)
                    .cacheControl(CacheControl.noStore())
                    .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                    .body(problem);
        }
        String filename =
                switch (download.schemaVersion()) {
                    case "autopay-guard-export-v1" ->
                            "autopay-guard-export-v1.json";
                    case "autopay-guard-export-v2" ->
                            "autopay-guard-export-v2.json";
                    default ->
                            throw new IllegalStateException(
                                    "The stored export schema is not allowlisted.");
                };
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + filename + "\"")
                .header("X-Content-SHA256", download.sha256())
                .contentType(MediaType.APPLICATION_JSON)
                .contentLength(download.payload().length)
                .body(download.payload());
    }
}
