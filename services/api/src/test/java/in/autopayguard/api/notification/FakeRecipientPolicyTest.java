package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

class FakeRecipientPolicyTest {

    private final FakeRecipientPolicy policy =
            new FakeRecipientPolicy(
                    new NotificationProperties(
                            "-",
                            "-",
                            "-",
                            25,
                            Duration.ofMinutes(2),
                            Duration.ofHours(2),
                            new NotificationProperties.Email(
                                    NotificationEmailMode.MAILPIT,
                                    "no-reply@autopayguard.local",
                                    List.of("@autopayguard.local", ".example.test"))));

    @Test
    void acceptsOnlyConfiguredFakeDomainBoundaries() {
        assertThat(policy.isAllowed("demo@autopayguard.local")).isTrue();
        assertThat(policy.isAllowed("alice@example.test")).isTrue();
        assertThat(policy.isAllowed("alice@sub.example.test")).isTrue();

        assertThat(policy.isAllowed("alice@example.test.evil.invalid")).isFalse();
        assertThat(policy.isAllowed("alice@autopayguard.local.evil.invalid")).isFalse();
        assertThat(policy.isAllowed("alice@example.com")).isFalse();
        assertThat(policy.isAllowed("alice@demo@example.test")).isFalse();
        assertThat(policy.isAllowed("alice@example.test\r\nBcc: real@example.com"))
                .isFalse();
    }

    @Test
    void mailpitConfigurationRejectsNonReservedRecipientSuffixes() {
        for (String suffix : List.of(".com", "@example.com", ".autopayguard.local")) {
            assertThatThrownBy(
                            () ->
                                    new FakeRecipientPolicy(
                                            properties(List.of(suffix))))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("reserved fake domains");
        }
    }

    private static NotificationProperties properties(List<String> suffixes) {
        return new NotificationProperties(
                "-",
                "-",
                "-",
                25,
                Duration.ofMinutes(2),
                Duration.ofHours(2),
                new NotificationProperties.Email(
                        NotificationEmailMode.MAILPIT,
                        "no-reply@autopayguard.local",
                        suffixes));
    }
}
