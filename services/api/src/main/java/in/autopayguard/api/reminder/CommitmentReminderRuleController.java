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
@RequestMapping("/v1/commitments/{commitmentId}/reminder-rules")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "notifications")
public class CommitmentReminderRuleController {

    private final ReminderRuleService service;

    CommitmentReminderRuleController(ReminderRuleService service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getCommitmentReminderRules",
            summary = "Get reminder rules for an owned active or paused commitment",
            description = "A missing rule set inherits the household and has synthetic version 0.",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Commitment reminder rules",
                        headers = @Header(name = HttpHeaders.ETAG, description = "Quoted version")),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned mutable commitment not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<ReminderRuleSetResponse> get(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID commitmentId) {
        ReminderRuleSetResponse result = service.getCommitment(jwt, commitmentId);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }

    @PutMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "updateCommitmentReminderRules",
            summary = "Replace reminder rules for an owned active or paused commitment",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Commitment reminder rules replaced",
                        headers = @Header(name = HttpHeaders.ETAG, description = "New quoted version")),
                @ApiResponse(
                        responseCode = "400",
                        description = "Validation or If-Match syntax failed",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned mutable commitment not found",
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
            @PathVariable UUID commitmentId,
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
                service.updateCommitment(
                        jwt,
                        commitmentId,
                        EntityTags.requiredVersion(ifMatch),
                        request);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }
}
