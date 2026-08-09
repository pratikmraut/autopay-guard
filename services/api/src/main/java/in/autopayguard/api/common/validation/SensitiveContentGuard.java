package in.autopayguard.api.common.validation;

import jakarta.validation.ValidationException;
import java.util.regex.Pattern;

public final class SensitiveContentGuard {

    private static final Pattern SENSITIVE_KEYWORD =
            Pattern.compile(
                    "(?i)\\b(otp|pin|password|passcode|cvv|cvc|secret|account\\s+number|card\\s+number|upi\\s+id)\\b");

    private SensitiveContentGuard() {}

    public static void rejectObviousSecrets(String value, String field) {
        if (totalDigits(value) >= 7
                || value.indexOf('@') >= 0
                || SENSITIVE_KEYWORD.matcher(value).find()) {
            throw new ValidationException(
                    field
                            + " must not contain payment account identifiers or authentication secrets.");
        }
    }

    private static long totalDigits(String value) {
        return value.chars().filter(Character::isDigit).count();
    }
}
