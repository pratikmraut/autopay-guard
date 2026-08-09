package in.autopayguard.api.common.config;

import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import in.autopayguard.api.notification.NotificationEmailMode;
import org.junit.jupiter.api.Test;

class ProductionConfigurationGuardTest {

    private static final String ISSUER =
            "https://identity.private-beta.autopayguard.in/realms/autopay-guard";
    private static final String JWK_SET =
            "https://identity-internal.private-beta.autopayguard.in/realms/autopay-guard/protocol/openid-connect/certs";
    private static final String ALLOWED_ORIGIN =
            "https://identity-internal.private-beta.autopayguard.in";

    @Test
    void acceptsTheExactProviderIndependentProductionBoundary() {
        assertThatNoException()
                .isThrownBy(
                        () ->
                                validate(
                                        NotificationEmailMode.DISABLED,
                                        ISSUER,
                                        JWK_SET,
                                        ALLOWED_ORIGIN,
                                        false,
                                        false,
                                        "health",
                                        "none"));
    }

    @Test
    void rejectsDevelopmentEmailAndDocumentationSurfaces() {
        assertRejected(
                NotificationEmailMode.MAILPIT,
                ISSUER,
                JWK_SET,
                ALLOWED_ORIGIN,
                false,
                false,
                "health",
                "none",
                "email must remain disabled");
        assertRejected(
                NotificationEmailMode.DISABLED,
                ISSUER,
                JWK_SET,
                ALLOWED_ORIGIN,
                true,
                false,
                "health",
                "none",
                "OpenAPI documents");
        assertRejected(
                NotificationEmailMode.DISABLED,
                ISSUER,
                JWK_SET,
                ALLOWED_ORIGIN,
                false,
                true,
                "health",
                "none",
                "OpenAPI documents");
    }

    @Test
    void rejectsInsecureLocalOrImplicitIdentityDestinations() {
        assertRejected(
                NotificationEmailMode.DISABLED,
                "http://identity.private-beta.autopayguard.in/realms/autopay-guard",
                JWK_SET,
                ALLOWED_ORIGIN,
                false,
                false,
                "health",
                "none",
                "OIDC issuer");
        assertRejected(
                NotificationEmailMode.DISABLED,
                "https://localhost/realms/autopay-guard",
                JWK_SET,
                ALLOWED_ORIGIN,
                false,
                false,
                "health",
                "none",
                "OIDC issuer");
        assertRejected(
                NotificationEmailMode.DISABLED,
                ISSUER,
                "",
                ALLOWED_ORIGIN,
                false,
                false,
                "health",
                "none",
                "OIDC JWK set");
        assertRejected(
                NotificationEmailMode.DISABLED,
                ISSUER,
                "https://127.0.0.1/jwks",
                "https://127.0.0.1",
                false,
                false,
                "health",
                "none",
                "OIDC JWK set");
    }

    @Test
    void rejectsAnAudienceThatDoesNotMatchTheAuthorizationClient() {
        assertThatThrownBy(
                        () ->
                                ProductionConfigurationGuard.validate(
                                        NotificationEmailMode.DISABLED,
                                        ISSUER,
                                        JWK_SET,
                                        "different-api",
                                        "autopay-guard-web",
                                        ALLOWED_ORIGIN,
                                        false,
                                        false,
                                        "health",
                                        "none",
                                        false,
                                        false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("exact API client identifier");
    }

    @Test
    void rejectsAnAuthorizedPartyThatDoesNotMatchTheWebClient() {
        assertThatThrownBy(
                        () ->
                                ProductionConfigurationGuard.validate(
                                        NotificationEmailMode.DISABLED,
                                        ISSUER,
                                        JWK_SET,
                                        "autopay-guard-api",
                                        "different-web-client",
                                        ALLOWED_ORIGIN,
                                        false,
                                        false,
                                        "health",
                                        "none",
                                        false,
                                        false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("exact web client identifier");
    }

    @Test
    void rejectsMissingMalformedOverbroadOrIncompleteEgressAllowlists() {
        for (String allowedOrigins :
                new String[] {
                    "",
                    "http://identity-internal.private-beta.autopayguard.in",
                    "https://identity-internal.private-beta.autopayguard.in/path",
                    ALLOWED_ORIGIN + ",https://unexpected.private-beta.autopayguard.in",
                    "https://different.private-beta.autopayguard.in"
                }) {
            assertRejected(
                    NotificationEmailMode.DISABLED,
                    ISSUER,
                    JWK_SET,
                    allowedOrigins,
                    false,
                    false,
                    "health",
                    "none",
                    "must");
        }
    }

    @Test
    void rejectsReservedNonProductionHostSuffixes() {
        for (String issuer :
                new String[] {
                    "https://identity.example.test/realms/autopay-guard",
                    "https://identity.example/realms/autopay-guard",
                    "https://identity.invalid/realms/autopay-guard",
                    "https://identity.example.com/realms/autopay-guard",
                    "https://localhost./realms/autopay-guard",
                    "https://identity.example.com./realms/autopay-guard",
                    "https://10.0.0.1/realms/autopay-guard",
                    "https://[::ffff:127.0.0.1]/realms/autopay-guard"
                }) {
            assertRejected(
                    NotificationEmailMode.DISABLED,
                    issuer,
                    JWK_SET,
                    ALLOWED_ORIGIN,
                    false,
                    false,
                    "health",
                    "none",
                    "OIDC issuer");
        }
    }

    @Test
    void rejectsSmtpStartupAndHealthProbesWhileEmailIsDisabled() {
        assertThatThrownBy(
                        () ->
                                ProductionConfigurationGuard.validate(
                                        NotificationEmailMode.DISABLED,
                                        ISSUER,
                                        JWK_SET,
                                        "autopay-guard-api",
                                        "autopay-guard-web",
                                        ALLOWED_ORIGIN,
                                        false,
                                        false,
                                        "health",
                                        "none",
                                        true,
                                        false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("SMTP startup probes");
        assertThatThrownBy(
                        () ->
                                ProductionConfigurationGuard.validate(
                                        NotificationEmailMode.DISABLED,
                                        ISSUER,
                                        JWK_SET,
                                        "autopay-guard-api",
                                        "autopay-guard-web",
                                        ALLOWED_ORIGIN,
                                        false,
                                        false,
                                        "health",
                                        "none",
                                        false,
                                        true))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mail health checks");
    }

    @Test
    void rejectsAnyManagementEndpointBeyondHealth() {
        for (String exposure : new String[] {"", "health,info", "health,env", "*"}) {
            assertRejected(
                    NotificationEmailMode.DISABLED,
                    ISSUER,
                    JWK_SET,
                    ALLOWED_ORIGIN,
                    false,
                    false,
                    exposure,
                    "none",
                    "only health");
        }
    }

    @Test
    void rejectsForwardedHeadersUntilAProxyDesignIsApproved() {
        for (String strategy : new String[] {"", "native", "framework"}) {
            assertRejected(
                    NotificationEmailMode.DISABLED,
                    ISSUER,
                    JWK_SET,
                    ALLOWED_ORIGIN,
                    false,
                    false,
                    "health",
                    strategy,
                    "trusted proxies are approved");
        }
    }

    @Test
    void acceptsTheExactOperationalSurfaceBoundary() {
        assertThatNoException().isThrownBy(OperationalSettings.safe()::validate);
    }

    @Test
    void rejectsUnsafeManagementSchemaAndErrorDetailSettings() {
        for (OperationalSettings settings :
                new OperationalSettings[] {
                    new OperationalSettings(
                            "always", "never", "", "validate", true, "never", "never", "never", false),
                    new OperationalSettings(
                            "never", "when-authorized", "", "validate", true, "never", "never", "never", false),
                    new OperationalSettings(
                            "never", "never", "9090", "validate", true, "never", "never", "never", false),
                    new OperationalSettings(
                            "never", "never", "", "update", true, "never", "never", "never", false),
                    new OperationalSettings(
                            "never", "never", "", "validate", false, "never", "never", "never", false),
                    new OperationalSettings(
                            "never", "never", "", "validate", true, "always", "never", "never", false),
                    new OperationalSettings(
                            "never", "never", "", "validate", true, "never", "always", "never", false),
                    new OperationalSettings(
                            "never", "never", "", "validate", true, "never", "never", "always", false),
                    new OperationalSettings(
                            "never", "never", "", "validate", true, "never", "never", "never", true)
                }) {
            assertThatThrownBy(settings::validate).isInstanceOf(IllegalStateException.class);
        }
    }

    private static void validate(
            NotificationEmailMode emailMode,
            String issuer,
            String jwkSet,
            String allowedOrigins,
            boolean apiDocsEnabled,
            boolean swaggerUiEnabled,
            String managementExposure,
            String forwardHeadersStrategy) {
        ProductionConfigurationGuard.validate(
                emailMode,
                issuer,
                jwkSet,
                "autopay-guard-api",
                "autopay-guard-web",
                allowedOrigins,
                apiDocsEnabled,
                swaggerUiEnabled,
                managementExposure,
                forwardHeadersStrategy,
                false,
                false);
    }

    private static void assertRejected(
            NotificationEmailMode emailMode,
            String issuer,
            String jwkSet,
            String allowedOrigins,
            boolean apiDocsEnabled,
            boolean swaggerUiEnabled,
            String managementExposure,
            String forwardHeadersStrategy,
            String expectedMessage) {
        assertThatThrownBy(
                        () ->
                                validate(
                                        emailMode,
                                        issuer,
                                        jwkSet,
                                        allowedOrigins,
                                        apiDocsEnabled,
                                        swaggerUiEnabled,
                                        managementExposure,
                                        forwardHeadersStrategy))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(expectedMessage);
    }

    private record OperationalSettings(
            String healthShowDetails,
            String healthShowComponents,
            String managementServerPort,
            String hibernateDdlAuto,
            boolean flywayCleanDisabled,
            String errorIncludeMessage,
            String errorIncludeStacktrace,
            String errorIncludeBindingErrors,
            boolean errorIncludeException) {

        static OperationalSettings safe() {
            return new OperationalSettings(
                    "never", "never", "", "validate", true, "never", "never", "never", false);
        }

        void validate() {
            ProductionConfigurationGuard.validateOperationalSurface(
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
    }
}
