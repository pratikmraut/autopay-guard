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
import java.net.URI;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
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
@RequestMapping("/v1/admin")
@PreAuthorize("hasRole('GUIDE_ADMIN')")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "guide administration")
@Validated
class AdminCancellationGuideController {

    private final AdminCancellationGuideService service;

    AdminCancellationGuideController(AdminCancellationGuideService service) {
        this.service = service;
    }

    @GetMapping(
            value = "/cancellation-guides",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listAdminCancellationGuides",
            summary = "List fictional guide catalog heads",
            responses =
                    @ApiResponse(responseCode = "200", description = "Guide collection"))
    ResponseEntity<AdminCancellationGuideCollectionResponse> list(
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.list(jwt));
    }

    @GetMapping(
            value = "/cancellation-guides/{guideId}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getAdminCancellationGuide",
            summary = "Get one fictional guide catalog head",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Guide catalog head",
                        headers =
                                @Header(
                                        name = "ETag",
                                        schema =
                                                @Schema(
                                                        type = "string",
                                                        pattern =
                                                                "^\"(0|[1-9][0-9]*)\"$"))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Guide not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminCancellationGuideSummaryResponse> get(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID guideId) {
        AdminCancellationGuideSummaryResponse response =
                service.get(jwt, guideId);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }

    @GetMapping(
            value = "/cancellation-guides/{guideId}/versions",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listAdminCancellationGuideVersions",
            summary = "List immutable publication history and draft metadata",
            responses = {
                @ApiResponse(responseCode = "200", description = "Guide version collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Guide not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminCancellationGuideVersionCollectionResponse> versions(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID guideId,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.versions(jwt, guideId, cursor, limit));
    }

    @PostMapping(
            value = "/cancellation-guides/{guideId}/drafts",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "createAdminCancellationGuideDraft",
            summary = "Clone the current immutable published guide into a draft",
            responses = {
                @ApiResponse(
                        responseCode = "201",
                        description = "Draft created",
                        headers = {
                            @Header(
                                    name = "ETag",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern =
                                                            "^\"(0|[1-9][0-9]*)\"$")),
                            @Header(name = "Location", schema = @Schema(type = "string"))
                        }),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Guide not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Guide is retired, already has a draft, or replay differs",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminCancellationGuideDraftResponse> createDraft(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID guideId,
            @Parameter(
                            required = true,
                            schema =
                                    @Schema(
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[\\x21-\\x7E]{16,100}$"))
                    @RequestHeader(value = "Idempotency-Key", required = false)
                    String idempotencyKey) {
        AdminCancellationGuideDraftResponse response =
                service.createDraft(jwt, guideId, idempotencyKey);
        return ResponseEntity.created(
                        URI.create(
                                "/v1/admin/cancellation-guide-drafts/"
                                        + response.draftId()))
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }

    @PostMapping(
            value = "/cancellation-guides/{guideId}/retire",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "retireAdminCancellationGuide",
            summary = "Conditionally retire only the current catalog head",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Guide head retired",
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
                        description = "Invalid ETag or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Guide not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Guide is already retired or replay differs",
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
    ResponseEntity<AdminCancellationGuideSummaryResponse> retire(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID guideId,
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
                    String idempotencyKey) {
        AdminCancellationGuideSummaryResponse response =
                service.retire(
                        jwt,
                        guideId,
                        EntityTags.requiredVersion(ifMatch),
                        idempotencyKey);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }

    @GetMapping(
            value = "/cancellation-guide-drafts/{draftId}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getAdminCancellationGuideDraft",
            summary = "Get one editable fictional guide draft",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Guide draft",
                        headers =
                                @Header(
                                        name = "ETag",
                                        schema =
                                                @Schema(
                                                        type = "string",
                                                        pattern =
                                                                "^\"(0|[1-9][0-9]*)\"$"))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Draft not found or no longer editable",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminCancellationGuideDraftResponse> getDraft(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID draftId) {
        AdminCancellationGuideDraftResponse response =
                service.getDraft(jwt, draftId);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }

    @PatchMapping(
            value = "/cancellation-guide-drafts/{draftId}",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "updateAdminCancellationGuideDraft",
            summary = "Replace only editable draft text and review interval",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Draft updated",
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
                        description = "Invalid request or ETag",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Draft not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "412",
                        description = "Stale or non-editable draft",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "428",
                        description = "If-Match required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminCancellationGuideDraftResponse> updateDraft(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID draftId,
            @Parameter(
                            required = true,
                            schema = @Schema(pattern = "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = "If-Match", required = false)
                    String ifMatch,
            @Valid @RequestBody
                    UpdateAdminCancellationGuideDraftRequest request) {
        AdminCancellationGuideDraftResponse response =
                service.updateDraft(
                        jwt,
                        draftId,
                        EntityTags.requiredVersion(ifMatch),
                        request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.version()))
                .body(response);
    }

    @PostMapping(
            value = "/cancellation-guide-drafts/{draftId}/publish",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "publishAdminCancellationGuideDraft",
            summary = "Publish a validated fictional guide and atomically advance its head",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Draft published",
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
                        description = "Invalid ETag or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Draft not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Draft structure, target, head, or replay conflicts",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "412",
                        description = "Stale or non-editable draft",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "428",
                        description = "If-Match required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "429",
                        description = "Guide publication rate limit exceeded",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<AdminCancellationGuidePublicationResponse> publish(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID draftId,
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
                    String idempotencyKey) {
        AdminCancellationGuidePublicationResponse response =
                service.publish(
                        jwt,
                        draftId,
                        EntityTags.requiredVersion(ifMatch),
                        idempotencyKey);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .eTag(EntityTags.forVersion(response.catalogVersion()))
                .body(response);
    }
}
