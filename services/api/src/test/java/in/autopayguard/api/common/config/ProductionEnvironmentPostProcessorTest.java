package in.autopayguard.api.common.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.core.io.support.SpringFactoriesLoader;
import org.springframework.mock.env.MockEnvironment;

class ProductionEnvironmentPostProcessorTest {

    private final ProductionEnvironmentPostProcessor processor =
            new ProductionEnvironmentPostProcessor();

    @Test
    void registersTheGuardForSpringApplicationBootstrap() {
        List<EnvironmentPostProcessor> processors =
                SpringFactoriesLoader.forDefaultResourceLocation(
                                ProductionEnvironmentPostProcessorTest.class.getClassLoader())
                        .load(
                                EnvironmentPostProcessor.class,
                                (factoryType, implementationName, failure) -> {});

        assertThat(processors)
                .extracting(Object::getClass)
                .contains(ProductionEnvironmentPostProcessor.class);
    }

    @Test
    void validatesTheProductionBoundaryBeforeTheApplicationContextExists() {
        MockEnvironment environment = productionEnvironment();

        assertThatNoException()
                .isThrownBy(() -> processor.postProcessEnvironment(environment, null));
    }

    @Test
    void rejectsSharedDatabaseRolesBeforeAutoConfigurationCanRun() {
        MockEnvironment environment = productionEnvironment();
        environment.setProperty("spring.flyway.user", "autopay_guard_runtime");

        assertThatThrownBy(() -> processor.postProcessEnvironment(environment, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be distinct");
    }

    @Test
    void rejectsMailProbesBeforeAutoConfigurationCanRun() {
        MockEnvironment environment = productionEnvironment();
        environment.setProperty("management.health.mail.enabled", "true");

        assertThatThrownBy(() -> processor.postProcessEnvironment(environment, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mail health checks");
    }

    @Test
    void rejectsASeparateManagementServerBeforeAutoConfigurationCanRun() {
        MockEnvironment environment = productionEnvironment();
        environment.setProperty("management.server.port", "9090");

        assertThatThrownBy(() -> processor.postProcessEnvironment(environment, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("separate management server");
    }

    @Test
    void rejectsSchemaMutationBeforeAutoConfigurationCanRun() {
        MockEnvironment environment = productionEnvironment();
        environment.setProperty("spring.jpa.hibernate.ddl-auto", "update");

        assertThatThrownBy(() -> processor.postProcessEnvironment(environment, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("validate-only");
    }

    @Test
    void leavesTheExplicitLocalProfileUntouched() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("dev");

        assertThatNoException()
                .isThrownBy(() -> processor.postProcessEnvironment(environment, null));
    }

    private static MockEnvironment productionEnvironment() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        Map.ofEntries(
                        Map.entry("app.identity.auto-provision", "false"),
                        Map.entry("app.identity.require-verified-email", "true"),
                        Map.entry("spring.datasource.username", "autopay_guard_runtime"),
                        Map.entry("spring.flyway.user", "autopay_guard_migrator"),
                        Map.entry("app.notifications.email.mode", "DISABLED"),
                        Map.entry(
                                "app.security.issuer-uri",
                                "https://identity.private-beta.autopayguard.in/realms/autopay-guard"),
                        Map.entry(
                                "app.security.jwk-set-uri",
                                "https://identity-internal.private-beta.autopayguard.in/realms/autopay-guard/protocol/openid-connect/certs"),
                        Map.entry("app.security.audience", "autopay-guard-api"),
                        Map.entry("app.security.authorized-party", "autopay-guard-web"),
                        Map.entry(
                                "app.security.outbound-allowed-origins",
                                "https://identity-internal.private-beta.autopayguard.in"),
                        Map.entry("springdoc.api-docs.enabled", "false"),
                        Map.entry("springdoc.swagger-ui.enabled", "false"),
                        Map.entry("management.endpoints.web.exposure.include", "health"),
                        Map.entry("server.forward-headers-strategy", "none"),
                        Map.entry("spring.mail.test-connection", "false"),
                        Map.entry("management.health.mail.enabled", "false"),
                        Map.entry("management.endpoint.health.show-details", "never"),
                        Map.entry("management.endpoint.health.show-components", "never"),
                        Map.entry("spring.jpa.hibernate.ddl-auto", "validate"),
                        Map.entry("spring.flyway.clean-disabled", "true"),
                        Map.entry("server.error.include-message", "never"),
                        Map.entry("server.error.include-stacktrace", "never"),
                        Map.entry("server.error.include-binding-errors", "never"),
                        Map.entry("server.error.include-exception", "false"))
                .forEach(environment::setProperty);
        return environment;
    }
}
