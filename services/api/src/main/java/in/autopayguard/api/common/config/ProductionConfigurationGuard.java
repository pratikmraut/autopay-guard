package in.autopayguard.api.common.config;

import in.autopayguard.api.common.security.SecurityProperties;
import in.autopayguard.api.notification.NotificationEmailMode;
import in.autopayguard.api.notification.NotificationProperties;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("prod")
public class ProductionConfigurationGuard {

    ProductionConfigurationGuard(
            NotificationProperties notificationProperties,
            SecurityProperties securityProperties,
            @Value("${app.security.outbound-allowed-origins:}") String outboundAllowedOrigins,
            @Value("${springdoc.api-docs.enabled:true}") boolean apiDocsEnabled,
            @Value("${springdoc.swagger-ui.enabled:true}") boolean swaggerUiEnabled,
            @Value("${management.endpoints.web.exposure.include:}")
                    String managementEndpointExposure,
            @Value("${server.forward-headers-strategy:}") String forwardHeadersStrategy,
            @Value("${spring.mail.test-connection:false}") boolean mailTestConnection,
            @Value("${management.health.mail.enabled:true}") boolean mailHealthEnabled,
            @Value("${management.endpoint.health.show-details:}") String healthShowDetails,
            @Value("${management.endpoint.health.show-components:}") String healthShowComponents,
            @Value("${management.server.port:}") String managementServerPort,
            @Value("${spring.jpa.hibernate.ddl-auto:}") String hibernateDdlAuto,
            @Value("${spring.flyway.clean-disabled:false}") boolean flywayCleanDisabled,
            @Value("${server.error.include-message:}") String errorIncludeMessage,
            @Value("${server.error.include-stacktrace:}") String errorIncludeStacktrace,
            @Value("${server.error.include-binding-errors:}")
                    String errorIncludeBindingErrors,
            @Value("${server.error.include-exception:true}") boolean errorIncludeException) {
        validate(
                notificationProperties.email().mode(),
                securityProperties.issuerUri(),
                securityProperties.jwkSetUri(),
                securityProperties.audience(),
                securityProperties.authorizedParty(),
                outboundAllowedOrigins,
                apiDocsEnabled,
                swaggerUiEnabled,
                managementEndpointExposure,
                forwardHeadersStrategy,
                mailTestConnection,
                mailHealthEnabled);
        validateOperationalSurface(
                healthShowDetails,
                healthShowComponents,
                managementServerPort,
                hibernateDdlAuto,
                flywayCleanDisabled,
                errorIncludeMessage,
                errorIncludeStacktrace,
                errorIncludeBindingErrors,
                errorIncludeException);
    }

    static void validate(
            NotificationEmailMode emailMode,
            String issuerUri,
            String jwkSetUri,
            String audience,
            String authorizedParty,
            String outboundAllowedOrigins,
            boolean apiDocsEnabled,
            boolean swaggerUiEnabled,
            String managementEndpointExposure,
            String forwardHeadersStrategy,
            boolean mailTestConnection,
            boolean mailHealthEnabled) {
        if (emailMode != NotificationEmailMode.DISABLED) {
            throw new IllegalStateException(
                    "Production notification email must remain disabled until a provider is approved.");
        }
        if (mailTestConnection || mailHealthEnabled) {
            throw new IllegalStateException(
                    "Production SMTP startup probes and mail health checks must be disabled.");
        }

        productionUrl(issuerUri, "OIDC issuer", false);
        URI jwkUri = productionUrl(jwkSetUri, "OIDC JWK set", false);
        if (!"autopay-guard-api".equals(audience)) {
            throw new IllegalStateException(
                    "Production OIDC audience must remain the exact API client identifier.");
        }
        if (!"autopay-guard-web".equals(authorizedParty)) {
            throw new IllegalStateException(
                    "Production OIDC authorized party must remain the exact web client identifier.");
        }

        Set<String> allowedOrigins = parseAllowedOrigins(outboundAllowedOrigins);
        Set<String> requiredOrigins = Set.of(origin(jwkUri));
        if (!allowedOrigins.equals(requiredOrigins)) {
            throw new IllegalStateException(
                    "Production outbound origins must exactly match the configured server destinations.");
        }

        if (apiDocsEnabled || swaggerUiEnabled) {
            throw new IllegalStateException(
                    "Production OpenAPI documents and Swagger UI must be disabled.");
        }

        Set<String> exposedManagementEndpoints = csvValues(managementEndpointExposure);
        if (!exposedManagementEndpoints.equals(Set.of("health"))) {
            throw new IllegalStateException(
                    "Production management endpoint exposure must contain only health.");
        }

        if (!"none".equalsIgnoreCase(forwardHeadersStrategy)) {
            throw new IllegalStateException(
                    "Production forwarded headers must remain disabled until trusted proxies are approved.");
        }
    }

    static void validateOperationalSurface(
            String healthShowDetails,
            String healthShowComponents,
            String managementServerPort,
            String hibernateDdlAuto,
            boolean flywayCleanDisabled,
            String errorIncludeMessage,
            String errorIncludeStacktrace,
            String errorIncludeBindingErrors,
            boolean errorIncludeException) {
        if (!"never".equals(healthShowDetails) || !"never".equals(healthShowComponents)) {
            throw new IllegalStateException(
                    "Production health details and components must never be disclosed.");
        }
        if (managementServerPort != null && !managementServerPort.isBlank()) {
            throw new IllegalStateException(
                    "Production must not start a separate management server.");
        }
        if (!"validate".equals(hibernateDdlAuto)) {
            throw new IllegalStateException(
                    "Production Hibernate schema handling must remain validate-only.");
        }
        if (!flywayCleanDisabled) {
            throw new IllegalStateException("Production Flyway clean must remain disabled.");
        }
        if (!"never".equals(errorIncludeMessage)
                || !"never".equals(errorIncludeStacktrace)
                || !"never".equals(errorIncludeBindingErrors)
                || errorIncludeException) {
            throw new IllegalStateException(
                    "Production error responses must not disclose exception details.");
        }
    }

    private static Set<String> parseAllowedOrigins(String configuredOrigins) {
        Set<String> values = csvValues(configuredOrigins);
        if (values.isEmpty()) {
            throw new IllegalStateException(
                    "Production outbound origins must be an explicit nonempty allowlist.");
        }

        Set<String> origins = new LinkedHashSet<>();
        for (String value : values) {
            URI uri = productionUrl(value, "outbound origin", true);
            if (!origins.add(origin(uri))) {
                throw new IllegalStateException(
                        "Production outbound origins must not contain duplicates.");
            }
        }
        return Set.copyOf(origins);
    }

    private static Set<String> csvValues(String configuredValues) {
        if (configuredValues == null || configuredValues.isBlank()) {
            return Set.of();
        }
        Set<String> values = new LinkedHashSet<>();
        for (String part : configuredValues.split(",", -1)) {
            String value = part.strip();
            if (value.isEmpty() || !values.add(value)) {
                throw new IllegalStateException(
                        "Production allowlists must contain unique nonblank values.");
            }
        }
        return Set.copyOf(values);
    }

    private static URI productionUrl(String value, String label, boolean originOnly) {
        if (value == null || value.isBlank() || !value.equals(value.strip())) {
            throw new IllegalStateException(label + " must be an explicit HTTPS URL.");
        }

        final URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException exception) {
            throw new IllegalStateException(label + " must be a valid HTTPS URL.", exception);
        }

        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || host == null
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || uri.getPort() > 65535
                || isLocalHost(host)) {
            throw new IllegalStateException(label + " must be a non-local HTTPS URL.");
        }
        if (originOnly && uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath())) {
            throw new IllegalStateException(label + " entries must be origins without a path.");
        }
        return uri;
    }

    private static boolean isLocalHost(String rawHost) {
        String host = rawHost.toLowerCase(Locale.ROOT);
        if (host.startsWith("[") && host.endsWith("]")) {
            host = host.substring(1, host.length() - 1);
        }
        return host.equals("localhost")
                || host.endsWith(".")
                || host.endsWith(".localhost")
                || host.endsWith(".local")
                || host.equals("test")
                || host.endsWith(".test")
                || host.equals("example")
                || host.endsWith(".example")
                || host.equals("invalid")
                || host.endsWith(".invalid")
                || host.equals("example.com")
                || host.endsWith(".example.com")
                || host.equals("example.org")
                || host.endsWith(".example.org")
                || host.equals("example.net")
                || host.endsWith(".example.net")
                || host.contains(":")
                || host.matches("\\d{1,3}(?:\\.\\d{1,3}){3}")
                || host.matches("\\d+")
                || host.matches("0x[0-9a-f]+")
                || host.equals("0.0.0.0")
                || host.startsWith("127.")
                || host.equals("::")
                || host.equals("::1")
                || host.equals("0:0:0:0:0:0:0:1")
                || host.startsWith("fe80:")
                || host.startsWith("169.254.");
    }

    private static String origin(URI uri) {
        try {
            return new URI(
                            "https",
                            null,
                            uri.getHost().toLowerCase(Locale.ROOT),
                            uri.getPort(),
                            null,
                            null,
                            null)
                    .toString();
        } catch (URISyntaxException exception) {
            throw new IllegalStateException("Could not normalize an outbound origin.", exception);
        }
    }
}
