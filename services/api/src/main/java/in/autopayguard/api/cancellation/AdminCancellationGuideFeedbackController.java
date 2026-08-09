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
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
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
@RequestMapping("/v1/admin/cancellation-guide-feedback")
@PreAuthorize("hasRole('GUIDE_ADMIN')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "guide administration")
@Validated
class AdminCancellationGuideFeedbackController {

    private final AdminCancellationGuideFeedbackService service;

    AdminCancellationGuideFeedbackController(
            AdminCancellationGuideFeedbackService service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listAdminCancellationGuideFeedback",
            summary = "List the redacted guide-feedback review queue",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Redacted feedback collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminCancellationGuideFeedbackCollectionResponse> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.list(jwt, cursor, limit));
    }

    @PostMapping(
            value = "/{feedbackId}/review",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "reviewAdminCancellationGuideFeedback",
            summary = "Conditionally record a redacted feedback disposition",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Feedback disposition recorded",
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
                        description = "Invalid request, ETag, or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Feedback not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Idempotency replay differs",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "412",
                        description = "Stale review ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "428",
                        description = "If-Match required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminCancellationGuideFeedbackResponse> review(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID feedbackId,
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
                    String idempotencyKey,
            @Valid @RequestBody
                    ReviewAdminCancellationGuideFeedbackRequest request) {
        AdminCancellationGuideFeedbackResponse response =
                service.review(
                        jwt,
                        feedbackId,
                        EntityTags.requiredVersion(ifMatch),
                        idempotencyKey,
                        request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }
}
