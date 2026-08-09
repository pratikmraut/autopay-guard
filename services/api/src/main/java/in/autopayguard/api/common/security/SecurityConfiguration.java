package in.autopayguard.api.common.security;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration(proxyBeanMethods = false)
@EnableMethodSecurity
public class SecurityConfiguration {

    static final List<String> ALWAYS_PUBLIC_ENDPOINTS =
            List.of(
                    "/actuator/health",
                    "/actuator/health/liveness",
                    "/actuator/health/readiness");
    static final List<String> DEVELOPMENT_DOCUMENTATION_ENDPOINTS =
            List.of(
                    "/v3/api-docs",
                    "/v3/api-docs/**",
                    "/swagger-ui.html",
                    "/swagger-ui/**");

    @Bean
    SecurityFilterChain apiSecurityFilterChain(
            HttpSecurity http,
            Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter,
            @Value("${springdoc.api-docs.enabled:true}") boolean apiDocsEnabled,
            @Value("${springdoc.swagger-ui.enabled:true}") boolean swaggerUiEnabled)
            throws Exception {
        http.csrf(csrf -> csrf.disable())
                .sessionManagement(
                        sessions ->
                                sessions.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(
                        requests -> {
                            requests
                                    .requestMatchers(
                                            ALWAYS_PUBLIC_ENDPOINTS.toArray(String[]::new))
                                    .permitAll();
                            if (apiDocsEnabled || swaggerUiEnabled) {
                                requests
                                        .requestMatchers(
                                                DEVELOPMENT_DOCUMENTATION_ENDPOINTS.toArray(
                                                        String[]::new))
                                        .permitAll();
                            }
                            requests
                                    .requestMatchers(
                                                "/v1/admin/cancellation-guides",
                                                "/v1/admin/cancellation-guides/**",
                                                "/v1/admin/cancellation-guide-drafts/**",
                                                "/v1/admin/cancellation-guide-feedback",
                                                "/v1/admin/cancellation-guide-feedback/**")
                                        .hasRole("GUIDE_ADMIN")
                                        .requestMatchers("/v1/admin/privacy/**")
                                        .hasRole("PRIVACY_ADMIN")
                                        .requestMatchers(
                                                "/v1/admin/audit-events",
                                                "/v1/admin/audit-events/**")
                                        .hasRole("AUDIT_READ")
                                        .requestMatchers("/v1/support/**")
                                        .hasRole("SUPPORT_READ")
                                        .requestMatchers("/v1/me")
                                        .authenticated()
                                        .requestMatchers("/v1/**")
                                        .hasRole("USER")
                                        .anyRequest()
                                        .denyAll();
                        })
                .exceptionHandling(
                        exceptions ->
                                exceptions
                                        .authenticationEntryPoint(
                                                (request, response, exception) ->
                                                        writeSecurityProblem(
                                                                response,
                                                                401,
                                                                "Unauthorized",
                                                                "Authentication is required."))
                                        .accessDeniedHandler(
                                                (request, response, exception) ->
                                                        writeSecurityProblem(
                                                                response,
                                                                403,
                                                                "Forbidden",
                                                                "Access is denied.")))
                .oauth2ResourceServer(
                        resourceServer ->
                                resourceServer
                                        .jwt(
                                                jwt ->
                                                        jwt.jwtAuthenticationConverter(
                                                                jwtAuthenticationConverter))
                                        .authenticationEntryPoint(
                                                (request, response, exception) ->
                                                        writeSecurityProblem(
                                                                response,
                                                                401,
                                                                "Unauthorized",
                                                                "The bearer token is missing or invalid.")))
                .headers(
                        headers ->
                                headers
                                        .frameOptions(frameOptions -> frameOptions.deny()));
        return http.build();
    }

    @Bean
    Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter() {
        return new ApiClientRoleJwtAuthenticationConverter();
    }

    @Bean
    JwtDecoder jwtDecoder(
            SecurityProperties properties, OAuth2TokenValidator<Jwt> apiJwtValidator) {
        URI issuer = validatedHttpUri(properties.issuerUri(), "app.security.issuer-uri");
        JwtDecoder delegate;
        if (properties.jwkSetUri() == null || properties.jwkSetUri().isBlank()) {
            delegate = JwtDecoders.fromIssuerLocation(issuer.toString());
        } else {
            URI jwkSet = validatedHttpUri(properties.jwkSetUri(), "app.security.jwk-set-uri");
            delegate = NimbusJwtDecoder.withJwkSetUri(jwkSet.toString()).build();
        }

        return validatingDecoder(delegate, apiJwtValidator);
    }

    @Bean
    OAuth2TokenValidator<Jwt> apiJwtValidator(SecurityProperties properties) {
        URI issuer = validatedHttpUri(properties.issuerUri(), "app.security.issuer-uri");
        return new DelegatingOAuth2TokenValidator<>(
                        JwtValidators.createDefaultWithIssuer(issuer.toString()),
                        new AudienceValidator(properties.audience()),
                        new AuthorizedPartyValidator(properties.authorizedParty()));
    }

    static JwtDecoder validatingDecoder(
            JwtDecoder delegate, OAuth2TokenValidator<Jwt> validator) {
        return token -> {
            Jwt jwt = delegate.decode(token);
            OAuth2TokenValidatorResult result = validator.validate(jwt);
            if (result.hasErrors()) {
                throw new JwtValidationException("JWT validation failed", result.getErrors());
            }
            return jwt;
        };
    }

    private static URI validatedHttpUri(String value, String propertyName) {
        try {
            URI uri = new URI(value);
            if (!Set.of("http", "https").contains(uri.getScheme())
                    || uri.getHost() == null
                    || uri.getUserInfo() != null
                    || uri.getFragment() != null) {
                throw new IllegalStateException(propertyName + " must be an HTTP(S) URI.");
            }
            return uri;
        } catch (URISyntaxException exception) {
            throw new IllegalStateException(propertyName + " must be a valid URI.", exception);
        }
    }

    private static void writeSecurityProblem(
            jakarta.servlet.http.HttpServletResponse response,
            int status,
            String title,
            String detail)
            throws java.io.IOException {
        response.setStatus(status);
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(java.nio.charset.StandardCharsets.UTF_8.name());
        response.getWriter()
                .write(
                        "{\"type\":\"about:blank\",\"title\":\""
                                + title
                                + "\",\"status\":"
                                + status
                                + ",\"detail\":\""
                                + detail
                                + "\"}");
    }
}
