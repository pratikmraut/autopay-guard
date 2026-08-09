package in.autopayguard.api.notification;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
class NotificationRetryPolicy {

    private static final List<Duration> BACKOFFS =
            List.of(
                    Duration.ofMinutes(1),
                    Duration.ofMinutes(5),
                    Duration.ofMinutes(15),
                    Duration.ofMinutes(60),
                    Duration.ofMinutes(360));

    Optional<Duration> afterFailedAttempt(int completedAttemptCount) {
        if (completedAttemptCount < 1) {
            throw new IllegalArgumentException("Attempt count must be positive.");
        }
        if (completedAttemptCount > BACKOFFS.size()) {
            return Optional.empty();
        }
        return Optional.of(BACKOFFS.get(completedAttemptCount - 1));
    }

    int maximumAttempts() {
        return BACKOFFS.size() + 1;
    }
}
