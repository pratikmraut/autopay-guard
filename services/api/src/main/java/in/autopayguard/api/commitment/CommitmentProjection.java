package in.autopayguard.api.commitment;

import java.util.UUID;

public record CommitmentProjection(
        UUID id,
        String displayName,
        CommitmentCategory category,
        PaymentRail paymentRail,
        Long amountMinor,
        Long estimatedAmountMinor,
        String currency,
        RecurrenceRule recurrenceRule,
        boolean variableAmount,
        String maskedPaymentLabel) {

    public AmountKind amountKind() {
        if (!variableAmount) {
            return AmountKind.FIXED;
        }
        return estimatedAmountMinor == null
                ? AmountKind.UNKNOWN_VARIABLE
                : AmountKind.ESTIMATED;
    }

    public Long expectedAmountMinor() {
        return variableAmount ? estimatedAmountMinor : amountMinor;
    }
}
