package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(name = "AdminCancellationGuideCollection", requiredProperties = "items")
record AdminCancellationGuideCollectionResponse(
        List<AdminCancellationGuideSummaryResponse> items) {}

@Schema(
        name = "AdminCancellationGuideSummary",
        requiredProperties = {
            "guideId",
            "merchantId",
            "merchantName",
            "merchantCategory",
            "state",
            "currentPublishedVersion",
            "version",
            "updatedAt"
        })
record AdminCancellationGuideSummaryResponse(
        UUID guideId,
        UUID merchantId,
        String merchantName,
        String merchantCategory,
        @Schema(allowableValues = {"ACTIVE", "RETIRED"}) String state,
        @Schema(nullable = true, minimum = "1") Integer currentPublishedVersion,
        @Schema(minimum = "0") long version,
        Instant updatedAt) {}

@Schema(
        name = "AdminCancellationGuideVersionCollection",
        requiredProperties = {"items", "nextCursor"})
record AdminCancellationGuideVersionCollectionResponse(
        List<AdminCancellationGuideVersionResponse> items,
        @Schema(nullable = true) UUID nextCursor) {}

@Schema(
        name = "AdminCancellationGuideVersion",
        requiredProperties = {
            "guideId",
            "guideVersion",
            "status",
            "riskNotice",
            "structuralReviewedAt",
            "reviewIntervalDays",
            "publishedAt",
            "createdAt",
            "draftId",
            "draftVersion"
        })
record AdminCancellationGuideVersionResponse(
        UUID guideId,
        @Schema(minimum = "1") int guideVersion,
        GuideStatus status,
        @Schema(minLength = 1, maxLength = 1000) String riskNotice,
        Instant structuralReviewedAt,
        @Schema(minimum = "30", maximum = "90") int reviewIntervalDays,
        @Schema(nullable = true) Instant publishedAt,
        Instant createdAt,
        @Schema(nullable = true) UUID draftId,
        @Schema(nullable = true, minimum = "0") Long draftVersion) {}

@Schema(
        name = "AdminCancellationGuideDraft",
        requiredProperties = {
            "draftId",
            "guideId",
            "guideVersion",
            "status",
            "riskNotice",
            "structuralReviewedAt",
            "reviewIntervalDays",
            "steps",
            "version",
            "createdAt",
            "updatedAt"
        })
record AdminCancellationGuideDraftResponse(
        UUID draftId,
        UUID guideId,
        @Schema(minimum = "1") int guideVersion,
        GuideStatus status,
        @Schema(minLength = 1, maxLength = 1000) String riskNotice,
        Instant structuralReviewedAt,
        @Schema(minimum = "30", maximum = "90") int reviewIntervalDays,
        List<AdminCancellationGuideDraftStepResponse> steps,
        @Schema(minimum = "0") long version,
        Instant createdAt,
        Instant updatedAt) {}

@Schema(
        name = "AdminCancellationGuideDraftStep",
        requiredProperties = {
            "track",
            "sequenceNumber",
            "actionType",
            "title",
            "instruction",
            "targetKey",
            "targetUri"
        })
record AdminCancellationGuideDraftStepResponse(
        GuideTrackKind track,
        @Schema(minimum = "1", maximum = "2") int sequenceNumber,
        GuideStepKind actionType,
        @Schema(minLength = 1, maxLength = 160) String title,
        @Schema(minLength = 1, maxLength = 1000) String instruction,
        @Schema(nullable = true, minLength = 1, maxLength = 100)
                String targetKey,
        @Schema(nullable = true, minLength = 1, maxLength = 1000)
                String targetUri) {}

@Schema(
        name = "UpdateAdminCancellationGuideDraftRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"riskNotice", "reviewIntervalDays", "steps"})
record UpdateAdminCancellationGuideDraftRequest(
        @NotBlank
                @Size(min = 1, max = 1000)
                @Schema(
                        minLength = 1,
                        maxLength = 1000,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String riskNotice,
        @Min(30)
                @Max(90)
                @Schema(
                        minimum = "30",
                        maximum = "90",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                int reviewIntervalDays,
        @NotNull @Size(min = 4, max = 4)
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                List<@Valid UpdateAdminCancellationGuideDraftStepRequest> steps) {}

@Schema(
        name = "UpdateAdminCancellationGuideDraftStepRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"track", "sequenceNumber", "title", "instruction"})
record UpdateAdminCancellationGuideDraftStepRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                GuideTrackKind track,
        @Min(1)
                @Max(2)
                @Schema(
                        minimum = "1",
                        maximum = "2",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                int sequenceNumber,
        @NotBlank
                @Size(min = 1, max = 160)
                @Schema(
                        minLength = 1,
                        maxLength = 160,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String title,
        @NotBlank
                @Size(min = 1, max = 1000)
                @Schema(
                        minLength = 1,
                        maxLength = 1000,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String instruction) {}

@Schema(
        name = "AdminCancellationGuidePublication",
        requiredProperties = {
            "guideId",
            "publishedVersion",
            "catalogState",
            "catalogVersion",
            "publishedAt"
        })
record AdminCancellationGuidePublicationResponse(
        UUID guideId,
        @Schema(minimum = "1") int publishedVersion,
        @Schema(allowableValues = "ACTIVE") String catalogState,
        @Schema(minimum = "0") long catalogVersion,
        Instant publishedAt) {}

@Schema(
        name = "AdminCancellationGuideFeedbackCollection",
        requiredProperties = {"items", "nextCursor"})
record AdminCancellationGuideFeedbackCollectionResponse(
        List<AdminCancellationGuideFeedbackResponse> items,
        @Schema(nullable = true) UUID nextCursor) {}

@Schema(
        name = "AdminCancellationGuideFeedback",
        requiredProperties = {
            "id",
            "guideId",
            "guideVersion",
            "outcome",
            "createdAt",
            "disposition",
            "version"
        })
record AdminCancellationGuideFeedbackResponse(
        UUID id,
        UUID guideId,
        @Schema(minimum = "1") int guideVersion,
        GuideFeedbackOutcome outcome,
        Instant createdAt,
        AdminGuideFeedbackDisposition disposition,
        @Schema(minimum = "0") long version) {}

enum AdminGuideFeedbackDisposition {
    PENDING,
    RESOLVED,
    DISMISSED
}

enum AdminGuideFeedbackReviewDecision {
    RESOLVED,
    DISMISSED
}

@Schema(
        name = "ReviewAdminCancellationGuideFeedbackRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = "disposition")
record ReviewAdminCancellationGuideFeedbackRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                AdminGuideFeedbackReviewDecision disposition) {}
