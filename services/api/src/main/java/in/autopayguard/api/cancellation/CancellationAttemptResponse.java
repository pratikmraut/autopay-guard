package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.AmountKind;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Schema(
        name = "CancellationAttempt",
        requiredProperties = {
            "id",
            "householdId",
            "commitmentId",
            "occurrenceId",
            "decisionId",
            "guideId",
            "guideVersion",
            "guide",
            "scheduledDate",
            "amountKind",
            "currency",
            "projectedSavingsMinor",
            "savingsPeriodStart",
            "savingsPeriodEnd",
            "estimated",
            "serviceStatus",
            "paymentMandateStatus",
            "verificationStatus",
            "verificationDueDate",
            "verificationDueReached",
            "completedAt",
            "abandoned",
            "version",
            "createdAt",
            "updatedAt"
        })
public record CancellationAttemptResponse(
        @Schema(format = "uuid") UUID id,
        @Schema(format = "uuid") UUID householdId,
        @Schema(format = "uuid") UUID commitmentId,
        @Schema(format = "uuid") UUID occurrenceId,
        @Schema(format = "uuid") UUID decisionId,
        @Schema(format = "uuid") UUID guideId,
        int guideVersion,
        CancellationGuideResponse guide,
        @Schema(format = "date") LocalDate scheduledDate,
        AmountKind amountKind,
        String currency,
        @Schema(nullable = true, minimum = "1", maximum = "9007199254740991")
                Long projectedSavingsMinor,
        @Schema(format = "date") LocalDate savingsPeriodStart,
        @Schema(format = "date") LocalDate savingsPeriodEnd,
        boolean estimated,
        CancellationTrackStatus serviceStatus,
        CancellationTrackStatus paymentMandateStatus,
        CancellationVerificationStatus verificationStatus,
        @Schema(format = "date") LocalDate verificationDueDate,
        @Schema(
                        description =
                                "Server-derived due-date boundary in the attempt household timezone. Idempotent mutation replays preserve the original response snapshot; refetch the attempt to refresh this projection.")
                boolean verificationDueReached,
        @Schema(format = "date-time", nullable = true) Instant completedAt,
        boolean abandoned,
        long version,
        @Schema(format = "date-time") Instant createdAt,
        @Schema(format = "date-time") Instant updatedAt) {}
