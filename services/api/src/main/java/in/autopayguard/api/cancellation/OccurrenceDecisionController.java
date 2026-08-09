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
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
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
@RequestMapping("/v1")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "cancellation")
@Validated
public class OccurrenceDecisionController {

    private final OccurrenceDecisionService service;

    OccurrenceDecisionController(OccurrenceDecisionService service) {
        this.service = service;
    }

    @GetMapping(value = "/decisions/inbox", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listDecisionInbox",
            summary = "List visible upcoming occurrences and their current decisions",
            responses = {
                @ApiResponse(responseCode = "200", description = "Decision inbox page"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid date range or page",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    DecisionInboxPageResponse inbox(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID householdId,
            @RequestParam(required = false)
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate from,
            @RequestParam(required = false)
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate to,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit,
            @RequestParam(required = false)
                    @Size(max = 200)
                    @Pattern(regexp = "^[A-Za-z0-9_-]+$")
                    String cursor) {
        return service.inbox(jwt, householdId, from, to, limit, cursor);
    }

    @PostMapping(
            value = "/occurrences/{occurrenceId}/decisions",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "createOccurrenceDecision",
            summary = "Append a category-safe decision for an owned occurrence",
            responses = {
                @ApiResponse(responseCode = "201", description = "Decision recorded"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid action or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Occurrence not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Idempotency key conflicts",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<OccurrenceDecisionResponse> create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID occurrenceId,
            @Parameter(
                            required = true,
                            schema =
                                    @Schema(
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[\\x21-\\x7E]{16,100}$"))
                    @RequestHeader("Idempotency-Key")
                    String idempotencyKey,
            @Valid @RequestBody CreateOccurrenceDecisionRequest request) {
        return ResponseEntity.status(201)
                .body(service.create(jwt, occurrenceId, idempotencyKey, request));
    }
}
