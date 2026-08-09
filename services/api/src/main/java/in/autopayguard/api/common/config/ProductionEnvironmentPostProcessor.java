package in.autopayguard.api.common.config;

import in.autopayguard.api.identity.ProductionIdentityGuard;
import in.autopayguard.api.notification.NotificationEmailMode;
import java.util.Arrays;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;

public class ProductionEnvironmentPostProcessor implements EnvironmentPostProcessor {

    @Override
    public void postProcessEnvironment(
            ConfigurableEnvironment environment, SpringApplication application) {
        if (Arrays.stream(environment.getActiveProfiles())
                .noneMatch(profile -> "prod".equalsIgnoreCase(profile.strip()))) {
            return;
        }

        ProductionIdentityGuard.validate(
                property(environment, "app.identity.auto-provision", Boolean.class, false),
                property(environment, "app.identity.require-verified-email", Boolean.class, false),
                environment.getActiveProfiles());
        ProductionDatabaseRoleGuard.validate(
                environment.getProperty("spring.datasource.username"),
                environment.getProperty("spring.flyway.user"));
        ProductionConfigurationGuard.validate(
                property(
                        environment,
                        "app.notifications.email.mode",
                        NotificationEmailMode.class,
                        NotificationEmailMode.DISABLED),
                environment.getProperty("app.security.issuer-uri"),
                environment.getProperty("app.security.jwk-set-uri"),
                environment.getProperty("app.security.audience"),
                environment.getProperty("app.security.authorized-party"),
                environment.getProperty("app.security.outbound-allowed-origins"),
                property(environment, "springdoc.api-docs.enabled", Boolean.class, true),
                property(environment, "springdoc.swagger-ui.enabled", Boolean.class, true),
                environment.getProperty("management.endpoints.web.exposure.include"),
                environment.getProperty("server.forward-headers-strategy"),
                property(environment, "spring.mail.test-connection", Boolean.class, false),
                property(environment, "management.health.mail.enabled", Boolean.class, true));
        ProductionConfigurationGuard.validateOperationalSurface(
                environment.getProperty("management.endpoint.health.show-details"),
                environment.getProperty("management.endpoint.health.show-components"),
                environment.getProperty("management.server.port"),
                environment.getProperty("spring.jpa.hibernate.ddl-auto"),
                property(environment, "spring.flyway.clean-disabled", Boolean.class, false),
                environment.getProperty("server.error.include-message"),
                environment.getProperty("server.error.include-stacktrace"),
                environment.getProperty("server.error.include-binding-errors"),
                property(environment, "server.error.include-exception", Boolean.class, true));
    }

    private static <T> T property(
            ConfigurableEnvironment environment,
            String name,
            Class<T> type,
            T defaultValue) {
        return environment.getProperty(name, type, defaultValue);
    }
}
