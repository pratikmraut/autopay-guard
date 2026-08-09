package in.autopayguard.api.cancellation;

import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "cancellation")
class CancellationGuideFeedbackController {

    private final CancellationGuideFeedbackService service;

    CancellationGuideFeedbackController(CancellationGuideFeedbackService service) {
        this.service = service;
    }

    @PostMapping(
            value = "/cancellation-guides/{guideId}/feedback",
            consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(
            operationId = "createCancellationGuideFeedback",
            summary = "Record safe user feedback for a guide version",
            responses = {
                @ApiResponse(responseCode = "204", description = "Feedback recorded"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid feedback or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Commitment or guide not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Idempotency key conflicts",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    void create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID guideId,
            @Parameter(
                            required = true,
                            schema =
                                    @Schema(
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[\\x21-\\x7E]{16,100}$"))
                    @RequestHeader("Idempotency-Key")
                    String idempotencyKey,
            @Valid @RequestBody CreateCancellationGuideFeedbackRequest request) {
        service.create(jwt, guideId, idempotencyKey, request);
    }
}
