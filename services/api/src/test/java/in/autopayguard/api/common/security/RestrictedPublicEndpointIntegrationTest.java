package in.autopayguard.api.common.security;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        properties = {
            "springdoc.api-docs.enabled=false",
            "springdoc.swagger-ui.enabled=false",
            "management.endpoints.web.exposure.include=health",
            "management.endpoint.health.show-details=never",
            "management.endpoint.health.show-components=never",
            "management.health.mail.enabled=false"
        })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RestrictedPublicEndpointIntegrationTest {

    @Autowired private MockMvc mockMvc;

    @Test
    void anonymousInventoryContainsHealthButNotDocumentationManagementOrProductRoutes()
            throws Exception {
        mockMvc.perform(get("/actuator/health")).andExpect(status().isOk());
        mockMvc.perform(get("/actuator/health/liveness")).andExpect(status().isOk());
        mockMvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());

        for (String restrictedPath :
                new String[] {
                    "/v3/api-docs",
                    "/swagger-ui.html",
                    "/actuator/info",
                    "/actuator/health/db",
                    "/actuator/health/readiness/db",
                    "/actuator/health/unexpected",
                    "/actuator/env",
                    "/actuator/metrics",
                    "/actuator/prometheus",
                    "/actuator/heapdump",
                    "/v1/households",
                    "/not-a-route"
                }) {
            mockMvc.perform(get(restrictedPath)).andExpect(status().isUnauthorized());
        }
    }

    @Test
    void disablingDocumentationDoesNotMakeItAvailableToAnAuthenticatedUser()
            throws Exception {
        mockMvc.perform(get("/v3/api-docs").with(jwt()))
                .andExpect(status().isForbidden());
    }
}
