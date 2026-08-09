package in.autopayguard.api.common.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ProductionPublicEndpointInventoryTest {

    @Test
    void productionHasOnlyTheMinimalHealthMatcherInventory() {
        assertThat(SecurityConfiguration.ALWAYS_PUBLIC_ENDPOINTS)
                .containsExactly(
                        "/actuator/health",
                        "/actuator/health/liveness",
                        "/actuator/health/readiness");
    }

    @Test
    void developmentDocumentationMatchersRemainASeparateExplicitInventory() {
        assertThat(SecurityConfiguration.DEVELOPMENT_DOCUMENTATION_ENDPOINTS)
                .containsExactly(
                        "/v3/api-docs",
                        "/v3/api-docs/**",
                        "/swagger-ui.html",
                        "/swagger-ui/**");
    }
}
