package in.autopayguard.api.privacy;

import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/privacy/consents")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "privacy consents")
@Validated
public class ConsentController {

    private final ConsentService consentService;

    ConsentController(ConsentService consentService) {
        this.consentService = consentService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listConsentEvents",
            summary = "List append-only household-sharing consent events",
            responses = {
                @ApiResponse(responseCode = "200", description = "Consent collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Cursor not found for the current user",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ConsentCollectionResponse list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit) {
        return consentService.list(jwt, cursor, limit);
    }

    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "recordConsentEvent",
            summary = "Append an idempotent household-sharing consent event",
            responses = {
                @ApiResponse(responseCode = "201", description = "Consent event recorded"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid request or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Consent state, notice, or replay conflicts",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<ConsentEventResponse> record(
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
            @Valid @RequestBody RecordConsentRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(consentService.record(jwt, idempotencyKey, request));
    }
}
