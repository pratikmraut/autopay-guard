package in.autopayguard.api.common.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class AuthorizedPartyValidatorTest {

    private final AuthorizedPartyValidator validator =
            new AuthorizedPartyValidator("autopay-guard-web");

    @Test
    void acceptsOnlyTheExactScalarAuthorizedParty() {
        assertThat(validator.validate(jwt("autopay-guard-web")).hasErrors()).isFalse();
        assertThat(validator.validate(jwt("different-client")).hasErrors()).isTrue();
        assertThat(validator.validate(jwt(null)).hasErrors()).isTrue();
        assertThat(validator.validate(jwt(List.of("autopay-guard-web"))).hasErrors())
                .isTrue();
    }

    private static Jwt jwt(Object authorizedParty) {
        Instant now = Instant.parse("2026-08-09T00:00:00Z");
        java.util.LinkedHashMap<String, Object> claims = new java.util.LinkedHashMap<>();
        claims.put("sub", "fake-user");
        if (authorizedParty != null) {
            claims.put("azp", authorizedParty);
        }
        return new Jwt(
                "fake-token",
                now,
                now.plusSeconds(300),
                Map.of("alg", "none"),
                claims);
    }
}
