package in.autopayguard.api.dashboard;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.commitment.CommitmentProjection;
import in.autopayguard.api.commitment.CommitmentService;
import in.autopayguard.api.commitment.CustomIntervalUnit;
import in.autopayguard.api.commitment.MonthDayPolicy;
import in.autopayguard.api.commitment.OwnedCommitmentProjections;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.commitment.RecurrenceCalculator;
import in.autopayguard.api.commitment.RecurrenceFrequency;
import in.autopayguard.api.commitment.RecurrenceRule;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.household.OwnedHousehold;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class DashboardServiceTest {

    @Test
    void rejectsAggregateBeyondJavaScriptSafeIntegerInsteadOfReturningRoundedOutput() {
        CommitmentService commitmentService = mock(CommitmentService.class);
        DashboardService dashboardService =
                new DashboardService(commitmentService, new RecurrenceCalculator());
        Jwt jwt = mock(Jwt.class);
        UUID householdId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        RecurrenceRule daily =
                new RecurrenceRule(
                        LocalDate.of(2026, 1, 1),
                        RecurrenceFrequency.CUSTOM,
                        1,
                        CustomIntervalUnit.DAYS,
                        MonthDayPolicy.ANCHOR_DAY);
        List<CommitmentProjection> commitments =
                IntStream.range(0, 25)
                        .mapToObj(
                                index ->
                                        new CommitmentProjection(
                                                UUID.randomUUID(),
                                                "Daily maximum " + index,
                                                CommitmentCategory.OTHER,
                                                PaymentRail.CASH_OR_MANUAL,
                                                999_999_999_999L,
                                                null,
                                                "INR",
                                                daily,
                                                false,
                                                null))
                        .toList();
        when(commitmentService.requireVisibleActive(jwt, householdId))
                .thenReturn(
                        new OwnedCommitmentProjections(
                                ownerId,
                                new OwnedHousehold(
                                        householdId,
                                        ownerId,
                                        "INR",
                                        "Asia/Kolkata"),
                                commitments));

        assertThatThrownBy(
                        () ->
                                dashboardService.summary(
                                        jwt, householdId, "2026-01"))
                .isInstanceOf(RequestConflictException.class)
                .hasMessage(
                        "The projection exceeds the supported safe integer range.");
    }
}
