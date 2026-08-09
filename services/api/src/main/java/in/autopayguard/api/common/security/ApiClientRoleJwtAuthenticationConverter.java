package in.autopayguard.api.common.security;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;

final class ApiClientRoleJwtAuthenticationConverter
        implements Converter<Jwt, AbstractAuthenticationToken> {

    private static final String API_CLIENT_ID = "autopay-guard-api";
    private static final Set<String> ALLOWED_CLIENT_ROLES =
            Set.of(
                    "USER",
                    "GUIDE_ADMIN",
                    "PRIVACY_ADMIN",
                    "AUDIT_READ",
                    "SUPPORT_READ");

    private final JwtGrantedAuthoritiesConverter scopeAuthorities =
            new JwtGrantedAuthoritiesConverter();

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        LinkedHashSet<GrantedAuthority> authorities =
                new LinkedHashSet<>(scopeAuthorities.convert(jwt));
        Set<String> exactRoles = apiClientRoles(jwt);
        if (exactRoles.size() == 1 && ALLOWED_CLIENT_ROLES.containsAll(exactRoles)) {
            exactRoles.stream()
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                    .forEach(authorities::add);
        }
        return new JwtAuthenticationToken(jwt, authorities, jwt.getSubject());
    }

    private static Set<String> apiClientRoles(Jwt jwt) {
        Object rawResourceAccess = jwt.getClaims().get("resource_access");
        if (!(rawResourceAccess instanceof Map<?, ?> resourceAccess)) {
            return Set.of();
        }
        Object rawApiAccess = resourceAccess.get(API_CLIENT_ID);
        if (!(rawApiAccess instanceof Map<?, ?> apiAccess)) {
            return Set.of();
        }
        Object rawRoles = apiAccess.get("roles");
        if (!(rawRoles instanceof Collection<?> roles) || roles.size() != 1) {
            return Set.of();
        }
        Object role = roles.iterator().next();
        return role instanceof String roleName ? Set.of(roleName) : Set.of();
    }
}
