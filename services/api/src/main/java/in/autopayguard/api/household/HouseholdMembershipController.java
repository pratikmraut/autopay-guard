package in.autopayguard.api.household;

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
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
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
@Tag(name = "household membership")
@Validated
public class HouseholdMembershipController {

    private final HouseholdMembershipService membershipService;

    HouseholdMembershipController(HouseholdMembershipService membershipService) {
        this.membershipService = membershipService;
    }

    @GetMapping(
            value = "/households/{householdId}/members",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listHouseholdMembers",
            summary = "List visible household members",
            responses = {
                @ApiResponse(responseCode = "200", description = "Member collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Household or cursor not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    HouseholdMemberCollectionResponse members(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID householdId,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit) {
        return membershipService.listMembers(jwt, householdId, cursor, limit);
    }

    @DeleteMapping("/households/{householdId}/members/{memberId}")
    @Operation(
            operationId = "removeHouseholdMember",
            summary = "Conditionally remove a household member",
            responses = {
                @ApiResponse(responseCode = "204", description = "Member removed"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Member not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Member cannot be removed",
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
    ResponseEntity<Void> removeMember(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID householdId,
            @PathVariable UUID memberId,
            @Parameter(
                            required = true,
                            schema = @Schema(pattern = "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch) {
        membershipService.removeMember(
                jwt, householdId, memberId, EntityTags.requiredVersion(ifMatch));
        return ResponseEntity.noContent().build();
    }

    @GetMapping(
            value = "/households/{householdId}/invitations",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listHouseholdInvitations",
            summary = "List redacted household invitations",
            responses = {
                @ApiResponse(responseCode = "200", description = "Invitation collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    HouseholdInvitationCollectionResponse householdInvitations(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID householdId,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit) {
        return membershipService.listHouseholdInvitations(
                jwt, householdId, cursor, limit);
    }

    @PostMapping(
            value = "/households/{householdId}/invitations",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "createHouseholdInvitation",
            summary = "Create a one-time fake-local household invitation",
            description =
                    "Returns the plaintext invitation code exactly once. "
                            + "Idempotency-Key is deliberately not accepted.",
            responses = {
                @ApiResponse(responseCode = "201", description = "Invitation created"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid request or forbidden idempotency header",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Household or fake invitee not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Invitation conflicts with current state",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "429",
                        description = "Invitation creation rate limit exceeded",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<CreatedHouseholdInvitationResponse> createInvitation(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID householdId,
            @Parameter(hidden = true)
                    @RequestHeader(value = "Idempotency-Key", required = false)
                    String idempotencyKey,
            @Valid @RequestBody CreateHouseholdInvitationRequest request) {
        if (idempotencyKey != null) {
            throw new jakarta.validation.ValidationException(
                    "Idempotency-Key is not accepted when creating a one-time invitation code.");
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(membershipService.createInvitation(jwt, householdId, request));
    }

    @DeleteMapping("/households/{householdId}/invitations/{invitationId}")
    @Operation(
            operationId = "revokeHouseholdInvitation",
            summary = "Conditionally revoke a pending invitation",
            responses = {
                @ApiResponse(responseCode = "204", description = "Invitation revoked"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Invitation not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Invitation is no longer pending",
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
    ResponseEntity<Void> revokeInvitation(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID householdId,
            @PathVariable UUID invitationId,
            @Parameter(
                            required = true,
                            schema = @Schema(pattern = "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch) {
        membershipService.revokeInvitation(
                jwt,
                householdId,
                invitationId,
                EntityTags.requiredVersion(ifMatch));
        return ResponseEntity.noContent().build();
    }

    @GetMapping(
            value = "/household-invitations",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listIncomingHouseholdInvitations",
            summary = "List invitations addressed to the current fake-local user",
            responses = {
                @ApiResponse(responseCode = "200", description = "Invitation collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Cursor not found for the current invitee",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    HouseholdInvitationCollectionResponse incomingInvitations(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit) {
        return membershipService.listIncomingInvitations(jwt, cursor, limit);
    }

    @PostMapping(
            value = "/household-invitations/accept",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "acceptHouseholdInvitation",
            summary = "Accept an invitation as its authenticated intended user",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Membership activated",
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
                        description = "Invalid code or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Invitation not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Invitation cannot be accepted or replay differs",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "429",
                        description = "Invitation acceptance rate limit exceeded",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<HouseholdMemberResponse> acceptInvitation(
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
            @Valid @RequestBody AcceptHouseholdInvitationRequest request) {
        HouseholdMemberResponse member =
                membershipService.acceptInvitation(jwt, idempotencyKey, request);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(member.version()))
                .body(member);
    }
}
