package in.autopayguard.api.common.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;

class ApiClientRoleJwtAuthenticationConverterTest {

    private final ApiClientRoleJwtAuthenticationConverter converter =
            new ApiClientRoleJwtAuthenticationConverter();

    @Test
    void mapsOneExactAllowlistedApiClientRole() {
        AbstractAuthenticationToken authentication =
                converter.convert(jwt(List.of("USER")));

        assertThat(authorities(authentication)).containsExactly("ROLE_USER");
    }

    @Test
    void ignoresMalformedAbsentRealmAndIdentityDerivedClaims() {
        assertThat(authorities(converter.convert(jwtWithClaims(Map.of())))).isEmpty();
        assertThat(
                        authorities(
                                converter.convert(
                                        jwtWithClaims(
                                                Map.of(
                                                        "resource_access",
                                                        Map.of(
                                                                "autopay-guard-api",
                                                                Map.of("roles", "USER")),
                                                        "realm_access",
                                                        Map.of("roles", "USER"),
                                                        "email",
                                                        "USER",
                                                        "name",
                                                        "PRIVACY_ADMIN")))))
                .isEmpty();
    }

    @Test
    void staffRolesDoNotImplyUserAndUnrecognizedRolesGrantNothing() {
        for (String staffRole :
                List.of(
                        "GUIDE_ADMIN",
                        "PRIVACY_ADMIN",
                        "AUDIT_READ",
                        "SUPPORT_READ")) {
            assertThat(authorities(converter.convert(jwt(List.of(staffRole)))))
                    .containsExactly("ROLE_" + staffRole)
                    .doesNotContain("ROLE_USER");
        }

        assertThat(
                        authorities(
                                converter.convert(
                                        jwt(
                                                List.of(
                                                        "default-roles-autopay-guard",
                                                        "offline_access",
                                                        "uma_authorization",
                                                        "user",
                                                        "guide_admin",
                                                        "UNKNOWN_ADMIN")))))
                .isEmpty();
    }

    @Test
    void rejectsEveryExcessRecognizedApplicationRoleCombination() {
        List<String> roles =
                List.of(
                        "USER",
                        "GUIDE_ADMIN",
                        "PRIVACY_ADMIN",
                        "AUDIT_READ",
                        "SUPPORT_READ");

        for (int first = 0; first < roles.size(); first++) {
            for (int second = first + 1; second < roles.size(); second++) {
                assertThat(
                                authorities(
                                        converter.convert(
                                                jwt(
                                                        List.of(
                                                                roles.get(first),
                                                                roles.get(second))))))
                        .as("incompatible roles %s and %s", roles.get(first), roles.get(second))
                        .isEmpty();
            }
        }
    }

    @Test
    void rejectsAnAllowedRoleCombinedWithAnyUnknownClientRole() {
        for (String extraRole :
                List.of(
                        "UNKNOWN_ADMIN",
                        "offline_access",
                        "uma_authorization",
                        "user",
                        "guide_admin")) {
            assertThat(
                            authorities(
                                    converter.convert(
                                            jwt(List.of("USER", extraRole)))))
                    .as("unexpected extra API-client role %s", extraRole)
                    .isEmpty();
        }
    }

    private static Set<String> authorities(AbstractAuthenticationToken authentication) {
        return authentication.getAuthorities().stream()
                .map(Object::toString)
                .collect(Collectors.toSet());
    }

    private static Jwt jwt(List<String> roles) {
        return jwtWithClaims(
                Map.of(
                        "resource_access",
                        Map.of(
                                "autopay-guard-api",
                                Map.of("roles", roles))));
    }

    private static Jwt jwtWithClaims(Map<String, Object> additionalClaims) {
        Instant now = Instant.parse("2026-07-27T00:00:00Z");
        java.util.LinkedHashMap<String, Object> claims = new java.util.LinkedHashMap<>();
        claims.put("sub", "fake-user");
        claims.putAll(additionalClaims);
        return new Jwt(
                "fake-token",
                now,
                now.plusSeconds(300),
                Map.of("alg", "none"),
                claims);
    }
}
