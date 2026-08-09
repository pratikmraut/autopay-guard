package in.autopayguard.api.commitment;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.validation.ValidationException;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class CommitmentRulesTest {

    @Test
    void rejectsAmbiguousCustomUnitsAndIncompatibleLastDayPolicies() {
        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.CUSTOM,
                                                null,
                                                MonthDayPolicy.ANCHOR_DAY,
                                                LocalDate.of(2026, 7, 1),
                                                false,
                                                100L,
                                                null,
                                                null)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("customIntervalUnit is required");

        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.WEEKLY,
                                                CustomIntervalUnit.DAYS,
                                                MonthDayPolicy.ANCHOR_DAY,
                                                LocalDate.of(2026, 7, 1),
                                                false,
                                                100L,
                                                null,
                                                null)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("allowed only");

        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.WEEKLY,
                                                null,
                                                MonthDayPolicy.LAST_DAY,
                                                LocalDate.of(2026, 7, 31),
                                                false,
                                                100L,
                                                null,
                                                null)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("ANCHOR_DAY");
    }

    @Test
    void rejectsMoneyShapeOverflowAndUnsafeMaskedLabels() {
        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.MONTHLY,
                                                null,
                                                MonthDayPolicy.ANCHOR_DAY,
                                                LocalDate.of(2026, 7, 1),
                                                false,
                                                null,
                                                null,
                                                null)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("amountMinor is required");
        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.MONTHLY,
                                                null,
                                                MonthDayPolicy.ANCHOR_DAY,
                                                LocalDate.of(2026, 7, 1),
                                                true,
                                                100L,
                                                null,
                                                null)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("must be null");
        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.MONTHLY,
                                                null,
                                                MonthDayPolicy.ANCHOR_DAY,
                                                LocalDate.of(2026, 7, 1),
                                                false,
                                                1_000_000_000_000L,
                                                null,
                                                null)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("999999999999");
        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.MONTHLY,
                                                null,
                                                MonthDayPolicy.ANCHOR_DAY,
                                                LocalDate.of(2026, 7, 1),
                                                false,
                                                100L,
                                                null,
                                                "Visa 4111 1111 1111 1111")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("must not contain");
        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.MONTHLY,
                                                null,
                                                MonthDayPolicy.ANCHOR_DAY,
                                                LocalDate.of(2026, 7, 1),
                                                false,
                                                100L,
                                                null,
                                                "PIN 1234")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("must not contain");
    }

    @Test
    void rejectsExtremeAnchorsAndProtectedCategoryPause() {
        assertThatThrownBy(
                        () ->
                                CommitmentRules.validate(
                                        create(
                                                RecurrenceFrequency.MONTHLY,
                                                null,
                                                MonthDayPolicy.ANCHOR_DAY,
                                                LocalDate.MAX,
                                                false,
                                                100L,
                                                null,
                                                null)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("1900-01-01");

        UpdateCommitmentRequest unsafePause =
                new UpdateCommitmentRequest(
                        null,
                        "Loan",
                        CommitmentCategory.EMI_LOAN,
                        PaymentRail.NACH_ENACH,
                        100L,
                        null,
                        "INR",
                        RecurrenceFrequency.MONTHLY,
                        1,
                        null,
                        LocalDate.of(2026, 7, 1),
                        MonthDayPolicy.ANCHOR_DAY,
                        false,
                        null,
                        CommitmentUpdateStatus.PAUSED);
        assertThatThrownBy(() -> CommitmentRules.validate(unsafePause))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("subscription, membership or software");
    }

    private static CreateCommitmentRequest create(
            RecurrenceFrequency frequency,
            CustomIntervalUnit customUnit,
            MonthDayPolicy policy,
            LocalDate anchor,
            boolean variable,
            Long amount,
            Long estimate,
            String maskedLabel) {
        return new CreateCommitmentRequest(
                java.util.UUID.randomUUID(),
                null,
                "Test commitment",
                CommitmentCategory.SUBSCRIPTION,
                PaymentRail.CARD_RECURRING,
                amount,
                estimate,
                "INR",
                frequency,
                1,
                customUnit,
                anchor,
                policy,
                variable,
                maskedLabel);
    }
}
