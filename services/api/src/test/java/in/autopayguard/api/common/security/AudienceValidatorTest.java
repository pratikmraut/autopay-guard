package in.autopayguard.api.common.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class AudienceValidatorTest {

    private final AudienceValidator validator = new AudienceValidator("autopay-guard-api");

    @Test
    void acceptsOnlyTheConfiguredAudience() {
        assertThat(validator.validate(jwt(List.of("autopay-guard-api"))).hasErrors()).isFalse();
        assertThat(validator.validate(jwt(List.of("some-other-api"))).hasErrors()).isTrue();
        assertThat(validator.validate(jwt(List.of())).hasErrors()).isTrue();
    }

    private static Jwt jwt(List<String> audience) {
        Instant now = Instant.parse("2026-07-26T00:00:00Z");
        return new Jwt(
                "fake-token",
                now,
                now.plusSeconds(300),
                Map.of("alg", "none"),
                Map.of("sub", "fake-user", "aud", audience));
    }
}
