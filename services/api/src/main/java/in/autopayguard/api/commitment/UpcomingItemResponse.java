package in.autopayguard.api.commitment;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "UpcomingItem",
        requiredProperties = {
            "id",
            "commitmentId",
            "displayName",
            "category",
            "paymentRail",
            "scheduledDate",
            "expectedAmountMinor",
            "currency",
            "amountKind",
            "maskedPaymentLabel",
            "canManage",
            "reviewActions"
        })
public record UpcomingItemResponse(
        UUID id,
        UUID commitmentId,
        String displayName,
        CommitmentCategory category,
        PaymentRail paymentRail,
        LocalDate scheduledDate,
        @Schema(nullable = true, minimum = "1", maximum = "999999999999")
                Long expectedAmountMinor,
        String currency,
        AmountKind amountKind,
        @Schema(nullable = true) String maskedPaymentLabel,
        boolean canManage,
        List<ReviewAction> reviewActions) {}
