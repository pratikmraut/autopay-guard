package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class NotificationRetryPolicyTest {

    private final NotificationRetryPolicy policy = new NotificationRetryPolicy();

    @Test
    void usesTheFrozenCappedRetrySchedule() {
        assertThat(policy.afterFailedAttempt(1)).contains(Duration.ofMinutes(1));
        assertThat(policy.afterFailedAttempt(2)).contains(Duration.ofMinutes(5));
        assertThat(policy.afterFailedAttempt(3)).contains(Duration.ofMinutes(15));
        assertThat(policy.afterFailedAttempt(4)).contains(Duration.ofMinutes(60));
        assertThat(policy.afterFailedAttempt(5)).contains(Duration.ofMinutes(360));
        assertThat(policy.afterFailedAttempt(6)).isEmpty();
        assertThat(policy.maximumAttempts()).isEqualTo(6);
    }

    @Test
    void rejectsAnAttemptThatNeverOccurred() {
        assertThatThrownBy(() -> policy.afterFailedAttempt(0))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
