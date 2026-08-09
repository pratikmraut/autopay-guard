package in.autopayguard.api.commitment;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "Commitment",
        requiredProperties = {
            "id",
            "householdId",
            "dataOwnerUserId",
            "responsibleMemberId",
            "merchantId",
            "merchantCanonicalName",
            "displayName",
            "category",
            "paymentRail",
            "amountMinor",
            "estimatedAmountMinor",
            "currency",
            "frequency",
            "intervalCount",
            "customIntervalUnit",
            "anchorDate",
            "monthDayPolicy",
            "nextDueDate",
            "variableAmount",
            "maskedPaymentLabel",
            "source",
            "sourceConfidence",
            "visibility",
            "status",
            "version",
            "canManage",
            "reviewActions",
            "createdAt",
            "updatedAt"
        })
public record CommitmentResponse(
        UUID id,
        UUID householdId,
        UUID dataOwnerUserId,
        @Schema(nullable = true) UUID responsibleMemberId,
        @Schema(nullable = true) UUID merchantId,
        @Schema(nullable = true) String merchantCanonicalName,
        String displayName,
        CommitmentCategory category,
        PaymentRail paymentRail,
        @Schema(nullable = true, minimum = "1", maximum = "999999999999") Long amountMinor,
        @Schema(nullable = true, minimum = "1", maximum = "999999999999")
                Long estimatedAmountMinor,
        String currency,
        RecurrenceFrequency frequency,
        int intervalCount,
        @Schema(nullable = true) CustomIntervalUnit customIntervalUnit,
        LocalDate anchorDate,
        MonthDayPolicy monthDayPolicy,
        @Schema(nullable = true) LocalDate nextDueDate,
        boolean variableAmount,
        @Schema(nullable = true) String maskedPaymentLabel,
        CommitmentSource source,
        @Schema(nullable = true, minimum = "0", maximum = "100") Integer sourceConfidence,
        CommitmentVisibility visibility,
        CommitmentStatus status,
        long version,
        boolean canManage,
        List<ReviewAction> reviewActions,
        Instant createdAt,
        Instant updatedAt) {}
