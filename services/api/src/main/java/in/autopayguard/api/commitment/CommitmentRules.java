package in.autopayguard.api.commitment;

import in.autopayguard.api.common.validation.SensitiveContentGuard;
import jakarta.validation.ValidationException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Currency;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

final class CommitmentRules {

    static final long MAX_AMOUNT_MINOR = 999_999_999_999L;
    static final LocalDate MINIMUM_ANCHOR_DATE = LocalDate.of(1900, 1, 1);
    static final LocalDate MAXIMUM_ANCHOR_DATE = LocalDate.of(2200, 12, 31);

    private static final Pattern CONTROL_CHARACTER = Pattern.compile("\\p{Cntrl}");

    private CommitmentRules() {}

    static ValidatedCommitment validate(CreateCommitmentRequest request) {
        return validate(
                request.merchantId(),
                request.displayName(),
                request.category(),
                request.paymentRail(),
                request.amountMinor(),
                request.estimatedAmountMinor(),
                request.currency(),
                request.frequency(),
                request.intervalCount(),
                request.customIntervalUnit(),
                request.anchorDate(),
                request.monthDayPolicy(),
                request.variableAmount(),
                request.maskedPaymentLabel(),
                CommitmentStatus.ACTIVE);
    }

    static ValidatedCommitment validate(UpdateCommitmentRequest request) {
        return validate(
                request.merchantId(),
                request.displayName(),
                request.category(),
                request.paymentRail(),
                request.amountMinor(),
                request.estimatedAmountMinor(),
                request.currency(),
                request.frequency(),
                request.intervalCount(),
                request.customIntervalUnit(),
                request.anchorDate(),
                request.monthDayPolicy(),
                request.variableAmount(),
                request.maskedPaymentLabel(),
                CommitmentStatus.valueOf(request.status().name()));
    }

    private static ValidatedCommitment validate(
            UUID merchantId,
            String rawDisplayName,
            CommitmentCategory category,
            PaymentRail paymentRail,
            Long amountMinor,
            Long estimatedAmountMinor,
            String rawCurrency,
            RecurrenceFrequency frequency,
            int intervalCount,
            CustomIntervalUnit customIntervalUnit,
            LocalDate anchorDate,
            MonthDayPolicy monthDayPolicy,
            Boolean variableAmount,
            String rawMaskedPaymentLabel,
            CommitmentStatus status) {
        String displayName = safeDisplayName(rawDisplayName);
        String currency = currency(rawCurrency);
        String maskedPaymentLabel =
                rawMaskedPaymentLabel == null
                        ? null
                        : safeMaskedLabel(rawMaskedPaymentLabel);

        if (Boolean.TRUE.equals(variableAmount)) {
            if (amountMinor != null) {
                throw new ValidationException(
                        "amountMinor must be null for a variable commitment.");
            }
            boundedAmount(estimatedAmountMinor, "estimatedAmountMinor", true);
        } else {
            boundedAmount(amountMinor, "amountMinor", false);
            if (estimatedAmountMinor != null) {
                throw new ValidationException(
                        "estimatedAmountMinor must be null for a fixed commitment.");
            }
        }

        if (frequency == RecurrenceFrequency.CUSTOM && customIntervalUnit == null) {
            throw new ValidationException(
                    "customIntervalUnit is required when frequency is CUSTOM.");
        }
        if (frequency != RecurrenceFrequency.CUSTOM && customIntervalUnit != null) {
            throw new ValidationException(
                    "customIntervalUnit is allowed only when frequency is CUSTOM.");
        }
        if (status == CommitmentStatus.PAUSED
                && !ReviewActionPolicy.forCategory(category)
                        .contains(ReviewAction.PAUSE_TRACKING)) {
            throw new ValidationException(
                    "PAUSED tracking is allowed only for subscription, membership or software commitments.");
        }
        if (anchorDate.isBefore(MINIMUM_ANCHOR_DATE)
                || anchorDate.isAfter(MAXIMUM_ANCHOR_DATE)) {
            throw new ValidationException(
                    "anchorDate must be between 1900-01-01 and 2200-12-31.");
        }

        boolean monthBased =
                switch (frequency) {
                    case MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY -> true;
                    case CUSTOM ->
                            customIntervalUnit == CustomIntervalUnit.MONTHS
                                    || customIntervalUnit == CustomIntervalUnit.YEARS;
                    case WEEKLY -> false;
                };
        if (!monthBased && monthDayPolicy != MonthDayPolicy.ANCHOR_DAY) {
            throw new ValidationException(
                    "monthDayPolicy must be ANCHOR_DAY for day- or week-based schedules.");
        }
        if (monthDayPolicy == MonthDayPolicy.LAST_DAY
                && !anchorDate.equals(YearMonth.from(anchorDate).atEndOfMonth())) {
            throw new ValidationException(
                    "LAST_DAY requires anchorDate to be the final day of its month.");
        }

        return new ValidatedCommitment(
                merchantId,
                displayName,
                category,
                paymentRail,
                amountMinor,
                estimatedAmountMinor,
                currency,
                frequency,
                intervalCount,
                customIntervalUnit,
                anchorDate,
                monthDayPolicy,
                Boolean.TRUE.equals(variableAmount),
                maskedPaymentLabel,
                status);
    }

    static RecurrenceRule recurrenceRule(CommitmentEntity commitment) {
        return new RecurrenceRule(
                commitment.anchorDate(),
                commitment.frequency(),
                commitment.intervalCount(),
                commitment.customIntervalUnit(),
                commitment.monthDayPolicy());
    }

    private static String currency(String rawCurrency) {
        String currency = safeText(rawCurrency, "currency", 3);
        try {
            Currency parsed = Currency.getInstance(currency);
            if (!parsed.getCurrencyCode().equals(currency)
                    || !currency.equals(currency.toUpperCase(Locale.ROOT))) {
                throw new IllegalArgumentException();
            }
            return currency;
        } catch (IllegalArgumentException exception) {
            throw new ValidationException(
                    "currency must be a supported uppercase ISO 4217 code.");
        }
    }

    private static void boundedAmount(Long value, String field, boolean nullable) {
        if (value == null) {
            if (!nullable) {
                throw new ValidationException(field + " is required.");
            }
            return;
        }
        if (value < 1 || value > MAX_AMOUNT_MINOR) {
            throw new ValidationException(
                    field + " must be between 1 and " + MAX_AMOUNT_MINOR + ".");
        }
    }

    private static String safeMaskedLabel(String rawValue) {
        String value = rawValue.strip();
        if (value.isEmpty()) {
            return null;
        }
        if (value.length() > 64
                || CONTROL_CHARACTER.matcher(value).find()) {
            throw new ValidationException(
                    "maskedPaymentLabel must be short and must not contain account, card or UPI identifiers.");
        }
        SensitiveContentGuard.rejectObviousSecrets(value, "maskedPaymentLabel");
        return value;
    }

    private static String safeDisplayName(String rawValue) {
        String value = safeText(rawValue, "displayName", 160);
        SensitiveContentGuard.rejectObviousSecrets(value, "displayName");
        return value;
    }

    private static String safeText(String rawValue, String field, int maximumLength) {
        if (rawValue == null) {
            throw new ValidationException(field + " is required.");
        }
        String value = rawValue.strip();
        if (value.isEmpty()
                || value.length() > maximumLength
                || CONTROL_CHARACTER.matcher(value).find()) {
            throw new ValidationException(field + " contains an invalid value.");
        }
        return value;
    }

    record ValidatedCommitment(
            UUID merchantId,
            String displayName,
            CommitmentCategory category,
            PaymentRail paymentRail,
            Long amountMinor,
            Long estimatedAmountMinor,
            String currency,
            RecurrenceFrequency frequency,
            int intervalCount,
            CustomIntervalUnit customIntervalUnit,
            LocalDate anchorDate,
            MonthDayPolicy monthDayPolicy,
            boolean variableAmount,
            String maskedPaymentLabel,
            CommitmentStatus status) {}
}
