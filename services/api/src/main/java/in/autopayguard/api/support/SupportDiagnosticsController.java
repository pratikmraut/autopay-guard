package in.autopayguard.api.support;

import in.autopayguard.api.common.error.ApiProblem;
import in.autopayguard.api.common.web.EntityTags;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "support diagnostics")
public class SupportDiagnosticsController {

    private final SupportDiagnosticsService diagnosticsService;

    SupportDiagnosticsController(SupportDiagnosticsService diagnosticsService) {
        this.diagnosticsService = diagnosticsService;
    }

    @PostMapping(
            value = "/households/{householdId}/support-codes",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "createSupportCode",
            summary = "Create a one-time owner-authorized support code",
            description =
                    "Returns the plaintext code exactly once. Idempotency-Key is deliberately "
                            + "not accepted.",
            responses = {
                @ApiResponse(responseCode = "201", description = "Support code created"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid acknowledgement or forbidden idempotency header",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "An active support code already exists",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "429",
                        description = "Support-code creation rate limit exceeded",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<CreatedSupportCodeResponse> create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID householdId,
            @Parameter(hidden = true)
                    @RequestHeader(value = "Idempotency-Key", required = false)
                    String idempotencyKey,
            @Valid @RequestBody CreateSupportCodeRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(
                        diagnosticsService.create(
                                jwt, householdId, idempotencyKey, request));
    }

    @DeleteMapping("/households/{householdId}/support-codes/{supportCodeId}")
    @Operation(
            operationId = "revokeSupportCode",
            summary = "Conditionally revoke an owner support code",
            responses = {
                @ApiResponse(responseCode = "204", description = "Support code revoked"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Support code not found",
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
    ResponseEntity<Void> revoke(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID householdId,
            @PathVariable UUID supportCodeId,
            @Parameter(
                            required = true,
                            schema = @Schema(pattern = "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch) {
        diagnosticsService.revoke(
                jwt,
                householdId,
                supportCodeId,
                EntityTags.requiredVersion(ifMatch));
        return ResponseEntity.noContent().build();
    }

    @PostMapping(
            value = "/support/diagnostics/resolve",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "resolveSupportDiagnostics",
            summary = "Resolve a valid owner code into redacted read-only diagnostics",
            responses = {
                @ApiResponse(responseCode = "200", description = "Redacted diagnostics"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid support code",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Code is invalid, expired, revoked, or foreign",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "429",
                        description = "Diagnostic access rate limit exceeded",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    SupportDiagnosticsResponse resolve(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ResolveSupportDiagnosticsRequest request) {
        return diagnosticsService.resolve(jwt, request);
    }
}
