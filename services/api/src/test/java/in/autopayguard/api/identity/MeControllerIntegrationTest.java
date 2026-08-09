package in.autopayguard.api.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.autopayguard.api.common.error.CorrelationIdFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class MeControllerIntegrationTest {

    @Autowired private MockMvc mockMvc;

    @Test
    void mapsValidatedOidcClaimsAndSeedsConfirmationsFalse() throws Exception {
        MvcResult first =
                mockMvc.perform(
                                get("/v1/me")
                                        .with(
                                                jwt()
                                                        .jwt(
                                                                token ->
                                                                        token.subject("fake-alice")
                                                                                .claim(
                                                                                        "email",
                                                                                        "  ALICE@EXAMPLE.TEST ")
                                                                                .claim(
                                                                                        "name",
                                                                                        " Alice Example "))))
                        .andExpect(status().isOk())
                        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                        .andExpect(jsonPath("$.email").value("alice@example.test"))
                        .andExpect(jsonPath("$.displayName").value("Alice Example"))
                        .andExpect(jsonPath("$.timezone").value("Asia/Kolkata"))
                        .andExpect(jsonPath("$.locale").value("en-IN"))
                        .andExpect(jsonPath("$.ageConfirmed").value(false))
                        .andExpect(jsonPath("$.privacyNoticeAccepted").value(false))
                        .andExpect(jsonPath("$.privacyNoticeVersion").value((Object) null))
                        .andReturn();

        String firstId =
                com.jayway.jsonpath.JsonPath.read(
                        first.getResponse().getContentAsString(), "$.id");
        mockMvc.perform(
                        get("/v1/me")
                                .with(
                                        jwt()
                                                .jwt(
                                                        token ->
                                                                token.subject("fake-alice")
                                                                        .claim(
                                                                                "email",
                                                                                "alice@example.test")
                                                                        .claim(
                                                                                "name",
                                                                                "Alice Example"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(firstId));
    }

    @Test
    void rejectsAnIdentityWithoutAValidatedEmailClaim() throws Exception {
        mockMvc.perform(
                        get("/v1/me")
                                .with(
                                        jwt()
                                                .jwt(
                                                        token ->
                                                                token.subject("fake-no-email")
                                                                        .claim(
                                                                                "name",
                                                                                "No Email"))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.title").value("Identity profile is incomplete"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("email")));
    }

    @Test
    void anonymousRequestsReceiveProblemJson() throws Exception {
        mockMvc.perform(get("/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(header().exists(CorrelationIdFilter.HEADER_NAME));
    }

    @Test
    void safeCorrelationIdsAreEchoedAndUnsafeValuesAreReplaced() throws Exception {
        mockMvc.perform(
                        get("/v1/me")
                                .header(CorrelationIdFilter.HEADER_NAME, "web-request-123")
                                .with(
                                        jwt()
                                                .jwt(
                                                        token ->
                                                                token.subject("fake-correlation")
                                                                        .claim(
                                                                                "email",
                                                                                "correlation@example.test")
                                                                        .claim(
                                                                                "name",
                                                                                "Correlation User"))))
                .andExpect(status().isOk())
                .andExpect(
                        header()
                                .string(
                                        CorrelationIdFilter.HEADER_NAME,
                                        "web-request-123"));

        MvcResult replaced =
                mockMvc.perform(
                                get("/v1/me")
                                        .header(
                                                CorrelationIdFilter.HEADER_NAME,
                                                "unsafe value")
                                        .with(
                                                jwt()
                                                        .jwt(
                                                                token ->
                                                                        token.subject(
                                                                                        "fake-correlation")
                                                                                .claim(
                                                                                        "email",
                                                                                        "correlation@example.test")
                                                                                .claim(
                                                                                        "name",
                                                                                        "Correlation User"))))
                        .andExpect(status().isOk())
                        .andExpect(header().exists(CorrelationIdFilter.HEADER_NAME))
                        .andReturn();

        assertThat(replaced.getResponse().getHeader(CorrelationIdFilter.HEADER_NAME))
                .isNotEqualTo("unsafe value")
                .matches("^[a-f0-9-]{36}$");
    }
}
