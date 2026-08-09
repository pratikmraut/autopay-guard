package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.AmountKind;
import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.commitment.ReviewAction;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "DecisionInboxItem",
        requiredProperties = {
            "occurrenceId",
            "commitmentId",
            "householdId",
            "displayName",
            "category",
            "paymentRail",
            "scheduledDate",
            "expectedAmountMinor",
            "currency",
            "amountKind",
            "reviewActions",
            "currentDecision"
        })
public record DecisionInboxItemResponse(
        @Schema(format = "uuid") UUID occurrenceId,
        @Schema(format = "uuid") UUID commitmentId,
        @Schema(format = "uuid") UUID householdId,
        String displayName,
        CommitmentCategory category,
        PaymentRail paymentRail,
        @Schema(format = "date") LocalDate scheduledDate,
        @Schema(nullable = true) Long expectedAmountMinor,
        String currency,
        AmountKind amountKind,
        List<ReviewAction> reviewActions,
        OccurrenceDecisionResponse currentDecision) {}
