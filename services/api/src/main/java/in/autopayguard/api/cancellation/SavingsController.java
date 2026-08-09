package in.autopayguard.api.cancellation;

import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "cancellation")
@Validated
class SavingsController {

    private final SavingsService service;

    SavingsController(SavingsService service) {
        this.service = service;
    }

    @GetMapping(value = "/savings", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getSavings",
            summary = "Get honest visible savings states and ledger items",
            responses = {
                @ApiResponse(responseCode = "200", description = "Savings page"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid filter or page",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Aggregate exceeds the exact supported money range",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    SavingsPageResponse get(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID householdId,
            @RequestParam(required = false) SavingsState state,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit,
            @RequestParam(required = false)
                    @Size(max = 300)
                    @Pattern(regexp = "^[A-Za-z0-9_-]+$")
                    String cursor) {
        return service.get(jwt, householdId, state, limit, cursor);
    }
}
