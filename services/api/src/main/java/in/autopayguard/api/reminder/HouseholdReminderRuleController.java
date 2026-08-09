package in.autopayguard.api.reminder;

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
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/households/{householdId}/reminder-rules")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "notifications")
public class HouseholdReminderRuleController {

    private final ReminderRuleService service;

    HouseholdReminderRuleController(ReminderRuleService service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getHouseholdReminderRules",
            summary = "Get reminder rules for an owned household",
            description =
                    "A missing rule set is disabled synthetic version 0 and includes "
                            + "7-, 3-, and 1-day suggestions for both channels.",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Household reminder rules",
                        headers = @Header(name = HttpHeaders.ETAG, description = "Quoted version")),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<ReminderRuleSetResponse> get(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID householdId) {
        ReminderRuleSetResponse result = service.getHousehold(jwt, householdId);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }

    @PutMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "updateHouseholdReminderRules",
            summary = "Replace reminder rules for an owned household",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Household reminder rules replaced",
                        headers = @Header(name = HttpHeaders.ETAG, description = "New quoted version")),
                @ApiResponse(
                        responseCode = "400",
                        description = "Validation or If-Match syntax failed",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "412",
                        description = "ETag is stale",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "428",
                        description = "If-Match is required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<ReminderRuleSetResponse> update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID householdId,
            @Parameter(
                            required = true,
                            description = "One quoted non-negative numeric ETag.",
                            schema =
                                    @Schema(
                                            pattern = "^\\\"(0|[1-9][0-9]*)\\\"$",
                                            example = "\"0\""))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch,
            @Valid @RequestBody UpdateReminderRuleSetRequest request) {
        ReminderRuleSetResponse result =
                service.updateHousehold(
                        jwt,
                        householdId,
                        EntityTags.requiredVersion(ifMatch),
                        request);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }
}
