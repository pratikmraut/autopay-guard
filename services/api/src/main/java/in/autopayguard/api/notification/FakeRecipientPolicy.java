package in.autopayguard.api.notification;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
class FakeRecipientPolicy {

    private static final Set<String> MAILPIT_SAFE_SUFFIXES =
            Set.of("@autopayguard.local", ".example.test");

    private final List<String> allowedSuffixes;

    FakeRecipientPolicy(NotificationProperties properties) {
        this.allowedSuffixes =
                properties.email().allowedRecipientSuffixes().stream()
                        .map(FakeRecipientPolicy::normalizedSuffix)
                        .distinct()
                        .toList();
        if (properties.email().mode() == NotificationEmailMode.MAILPIT
                && !MAILPIT_SAFE_SUFFIXES.containsAll(allowedSuffixes)) {
            throw new IllegalArgumentException(
                    "MAILPIT recipient suffixes must use only the reserved fake domains.");
        }
    }

    boolean isAllowed(String address) {
        if (address == null
                || address.isBlank()
                || !address.equals(address.strip())
                || address.indexOf('\r') >= 0
                || address.indexOf('\n') >= 0) {
            return false;
        }
        String normalized = address.toLowerCase(Locale.ROOT);
        if (normalized.indexOf('@') != normalized.lastIndexOf('@')) {
            return false;
        }
        int separator = normalized.lastIndexOf('@');
        if (separator <= 0 || separator == normalized.length() - 1) {
            return false;
        }
        String domain = normalized.substring(separator + 1);
        return allowedSuffixes.stream()
                .anyMatch(
                        suffix ->
                                suffix.startsWith("@")
                                        ? normalized.endsWith(suffix)
                                        : domain.equals(suffix.substring(1))
                                                || domain.endsWith(suffix));
    }

    private static String normalizedSuffix(String value) {
        String suffix = value.strip().toLowerCase(Locale.ROOT);
        if ((!suffix.startsWith("@") && !suffix.startsWith("."))
                || suffix.indexOf('\r') >= 0
                || suffix.indexOf('\n') >= 0
                || suffix.length() > 253) {
            throw new IllegalArgumentException(
                    "Notification recipient suffixes must begin with @ or .");
        }
        return suffix;
    }
}
