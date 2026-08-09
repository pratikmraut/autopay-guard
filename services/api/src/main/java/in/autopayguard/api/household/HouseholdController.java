package in.autopayguard.api.household;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import in.autopayguard.api.common.error.ApiProblem;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/households")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "households")
@Validated
public class HouseholdController {

    private final HouseholdService householdService;

    HouseholdController(HouseholdService householdService) {
        this.householdService = householdService;
    }

    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "createHousehold",
            summary = "Complete onboarding and create a household",
            description =
                    "Creates a household owned only by the authenticated token subject. "
                            + "The age and privacy confirmations are monotonic and cannot be cleared.",
            responses = {
                @ApiResponse(responseCode = "201", description = "Household created"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Request validation failed",
                        content =
                                @Content(
                                        mediaType = org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "401",
                        description = "Missing or invalid bearer token",
                        content =
                                @Content(
                                        mediaType = org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Privacy notice version is stale",
                        content =
                                @Content(
                                        mediaType = org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<HouseholdResponse> create(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CreateHouseholdRequest request) {
        HouseholdResponse household = householdService.create(jwt, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(household);
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listHouseholds",
            summary = "List accessible households",
            description =
                    "Returns households owned by the authenticated subject plus consented "
                            + "households where the subject has an active membership.",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Accessible household collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content =
                                @Content(
                                        mediaType = org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "401",
                        description = "Missing or invalid bearer token",
                        content =
                                @Content(
                                        mediaType = org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class)))
            })
    HouseholdCollectionResponse list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit) {
        return householdService.list(jwt, cursor, limit);
    }
}
