package in.autopayguard.api.commitment;

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
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/commitments")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "commitments")
@Validated
public class CommitmentController {

    private final CommitmentService commitmentService;

    CommitmentController(CommitmentService commitmentService) {
        this.commitmentService = commitmentService;
    }

    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "createCommitment",
            summary = "Create a manual recurring commitment",
            description =
                    "Creates a private, MANUAL commitment for an owned household and "
                            + "materializes occurrences from household-local today through day 90 inclusive.",
            responses = {
                @ApiResponse(
                        responseCode = "201",
                        description = "Commitment created",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        description = "Quoted numeric optimistic version")),
                @ApiResponse(
                        responseCode = "400",
                        description = "Validation failed",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<CommitmentResponse> create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateCommitmentRequest request) {
        CommitmentResponse result = commitmentService.create(jwt, request);
        return ResponseEntity.created(URI.create("/v1/commitments/" + result.id()))
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listCommitments",
            summary = "List commitments in an owned household",
            responses = {
                @ApiResponse(responseCode = "200", description = "Commitment page"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid page request",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    CommitmentPageResponse list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID householdId,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit,
            @RequestParam(required = false)
                    @Size(max = 200)
                    @Pattern(regexp = "^[A-Za-z0-9_-]+$")
                    String cursor,
            @RequestParam(defaultValue = "false") boolean includeArchived) {
        return commitmentService.list(
                jwt, householdId, limit, cursor, includeArchived);
    }

    @GetMapping(value = "/upcoming", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listUpcomingCommitments",
            summary = "List upcoming commitment occurrences",
            description =
                    "Defaults to household-local today through day 90 inclusive. "
                            + "Explicit ranges may include at most 366 dates.",
            responses = {
                @ApiResponse(responseCode = "200", description = "Upcoming occurrences"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid date range",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    UpcomingListResponse upcoming(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID householdId,
            @RequestParam(required = false)
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate from,
            @RequestParam(required = false)
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate to) {
        return commitmentService.upcoming(jwt, householdId, from, to);
    }

    @GetMapping(value = "/{commitmentId}", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getCommitment",
            summary = "Get an owned commitment",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Owned commitment",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        description = "Quoted numeric optimistic version")),
                @ApiResponse(
                        responseCode = "404",
                        description = "Commitment not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<CommitmentResponse> get(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID commitmentId) {
        CommitmentResponse result = commitmentService.get(jwt, commitmentId);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }

    @PatchMapping(
            value = "/{commitmentId}",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "updateCommitment",
            summary = "Update an owned commitment",
            description =
                    "Replaces all editable fields. The original anchor is used directly for every "
                            + "recurrence index. Future UPCOMING occurrences are replaced atomically.",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Commitment updated",
                        headers =
                                @Header(
                                        name = HttpHeaders.ETAG,
                                        description = "New quoted numeric optimistic version")),
                @ApiResponse(
                        responseCode = "400",
                        description = "Validation or If-Match syntax failed",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Commitment not found",
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
    ResponseEntity<CommitmentResponse> update(
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
            @Valid @RequestBody UpdateCommitmentRequest request) {
        CommitmentResponse result =
                commitmentService.update(
                        jwt,
                        commitmentId,
                        EntityTags.requiredVersion(ifMatch),
                        request);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }

    @PatchMapping(
            value = "/{commitmentId}/sharing",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "updateCommitmentSharing",
            summary = "Conditionally replace commitment visibility and responsibility",
            description =
                    "The owner remains the immutable author. A responsible member is only "
                            + "a non-authoritative planning label.",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Sharing settings updated",
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
                        description = "Invalid request or ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Commitment or member not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Sharing conflicts with consent or membership state",
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
    ResponseEntity<CommitmentResponse> updateSharing(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID commitmentId,
            @Parameter(
                            required = true,
                            schema = @Schema(pattern = "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch,
            @Valid @RequestBody UpdateCommitmentSharingRequest request) {
        CommitmentResponse result =
                commitmentService.updateSharing(
                        jwt,
                        commitmentId,
                        EntityTags.requiredVersion(ifMatch),
                        request);
        return ResponseEntity.ok()
                .eTag(EntityTags.forVersion(result.version()))
                .body(result);
    }

    @DeleteMapping("/{commitmentId}")
    @Operation(
            operationId = "archiveCommitment",
            summary = "Archive an owned commitment",
            description =
                    "Soft-archives the commitment and removes only future UPCOMING occurrences.",
            responses = {
                @ApiResponse(responseCode = "204", description = "Commitment archived"),
                @ApiResponse(
                        responseCode = "400",
                        description = "If-Match syntax failed",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Commitment not found",
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
    ResponseEntity<Void> archive(
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
                    String ifMatch) {
        commitmentService.archive(
                jwt, commitmentId, EntityTags.requiredVersion(ifMatch));
        return ResponseEntity.noContent().build();
    }

    @GetMapping(
            value = "/{commitmentId}/occurrences",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listCommitmentOccurrences",
            summary = "List occurrences for an owned commitment",
            responses = {
                @ApiResponse(responseCode = "200", description = "Occurrence list"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid date range",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Commitment not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    OccurrenceListResponse occurrences(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID commitmentId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return commitmentService.occurrences(jwt, commitmentId, from, to);
    }
}
