package in.autopayguard.api.cancellation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import in.autopayguard.api.common.error.RequestConflictException;
import org.junit.jupiter.api.Test;

class SavingsAmountsTest {

    @Test
    void aggregateBoundaryRemainsExactlyRepresentable() {
        assertThat(
                        SavingsAmounts.addExactBounded(
                                SavingsAmounts.MAXIMUM_SAFE_MINOR_UNITS - 1,
                                1))
                .isEqualTo(SavingsAmounts.MAXIMUM_SAFE_MINOR_UNITS);
    }

    @Test
    void aggregateBeyondExactJsonRangeFailsAsADomainConflict() {
        assertThatThrownBy(
                        () ->
                                SavingsAmounts.addExactBounded(
                                        SavingsAmounts.MAXIMUM_SAFE_MINOR_UNITS,
                                        1))
                .isInstanceOf(RequestConflictException.class)
                .hasMessageContaining("exact supported");
    }

    @Test
    void nativeLongOverflowAlsoFailsAsTheSameDomainConflict() {
        assertThatThrownBy(
                        () -> SavingsAmounts.addExactBounded(Long.MAX_VALUE, 1))
                .isInstanceOf(RequestConflictException.class)
                .hasMessageContaining("exact supported");
    }
}
