package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "CancellationGuide",
        requiredProperties = {
            "id",
            "version",
            "householdId",
            "commitmentId",
            "merchantName",
            "status",
            "freshness",
            "structuralReviewedAt",
            "reviewDueAt",
            "publishedAt",
            "riskNotice",
            "targetsSuppressed",
            "targetSuppressionReason",
            "tracks"
        })
public record CancellationGuideResponse(
        @Schema(format = "uuid") UUID id,
        int version,
        @Schema(format = "uuid") UUID householdId,
        @Schema(format = "uuid") UUID commitmentId,
        String merchantName,
        PublishedGuideStatus status,
        GuideFreshness freshness,
        @Schema(format = "date-time") Instant structuralReviewedAt,
        @Schema(format = "date-time") Instant reviewDueAt,
        @Schema(format = "date-time") Instant publishedAt,
        String riskNotice,
        boolean targetsSuppressed,
        GuideTargetSuppressionReason targetSuppressionReason,
        List<GuideTrackResponse> tracks) {}
