package in.autopayguard.api.cancellation;

import in.autopayguard.api.common.error.RequestConflictException;

final class SavingsAmounts {

    static final long MAXIMUM_SAFE_MINOR_UNITS = 9_007_199_254_740_991L;

    private SavingsAmounts() {}

    static long addExactBounded(long left, long right) {
        try {
            return requireSafeRange(Math.addExact(left, right));
        } catch (ArithmeticException exception) {
            throw outOfRange();
        }
    }

    static long multiplyExactBounded(long left, long right) {
        try {
            return requireSafeRange(Math.multiplyExact(left, right));
        } catch (ArithmeticException exception) {
            throw outOfRange();
        }
    }

    static int incrementExactBounded(int value) {
        try {
            return Math.incrementExact(value);
        } catch (ArithmeticException exception) {
            throw outOfRange();
        }
    }

    static int toIntExactBounded(long value) {
        try {
            return Math.toIntExact(value);
        } catch (ArithmeticException exception) {
            throw outOfRange();
        }
    }

    private static long requireSafeRange(long value) {
        if (value < 0 || value > MAXIMUM_SAFE_MINOR_UNITS) {
            throw outOfRange();
        }
        return value;
    }

    private static RequestConflictException outOfRange() {
        return new RequestConflictException(
                "Savings totals exceed the exact supported minor-unit range.");
    }
}
