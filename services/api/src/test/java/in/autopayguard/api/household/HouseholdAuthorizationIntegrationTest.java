package in.autopayguard.api.household;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class HouseholdAuthorizationIntegrationTest {

    private static final String VALID_CREATE_REQUEST =
            """
            {
              "name": "Alice household",
              "defaultCurrency": "INR",
              "timezone": "Asia/Kolkata",
              "ageConfirmed": true,
              "privacyNoticeAccepted": true,
              "privacyNoticeVersion": "foundation-v1"
            }
            """;

    @Autowired private MockMvc mockMvc;

    @Test
    void eachSubjectCanListOnlyHouseholdsItOwns() throws Exception {
        MvcResult aliceCreated =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(identity("fake-alice", "alice@example.test", "Alice"))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(VALID_CREATE_REQUEST))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.name").value("Alice household"))
                        .andReturn();
        String aliceOwnerId =
                com.jayway.jsonpath.JsonPath.read(
                        aliceCreated.getResponse().getContentAsString(), "$.ownerUserId");

        mockMvc.perform(
                        get("/v1/households")
                                .with(identity("fake-alice", "alice@example.test", "Alice")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].ownerUserId").value(aliceOwnerId));

        mockMvc.perform(
                        get("/v1/households")
                                .with(identity("fake-bob", "bob@example.test", "Bob")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));

        String bobRequest =
                VALID_CREATE_REQUEST.replace("Alice household", "Bob household");
        MvcResult bobCreated =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(identity("fake-bob", "bob@example.test", "Bob"))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(bobRequest))
                        .andExpect(status().isCreated())
                        .andReturn();
        String bobOwnerId =
                com.jayway.jsonpath.JsonPath.read(
                        bobCreated.getResponse().getContentAsString(), "$.ownerUserId");
        assertThat(bobOwnerId).isNotEqualTo(aliceOwnerId);

        mockMvc.perform(
                        get("/v1/households")
                                .with(identity("fake-bob", "bob@example.test", "Bob")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].name").value("Bob household"))
                .andExpect(jsonPath("$.items[0].ownerUserId").value(bobOwnerId));
    }

    @Test
    void onboardingConfirmationsArePersistedAndCannotBeFalse() throws Exception {
        mockMvc.perform(
                        post("/v1/households")
                                .with(identity("fake-onboard", "onboard@example.test", "Onboard"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(VALID_CREATE_REQUEST))
                .andExpect(status().isCreated());

        mockMvc.perform(
                        get("/v1/me")
                                .with(identity("fake-onboard", "onboard@example.test", "Onboard")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ageConfirmed").value(true))
                .andExpect(jsonPath("$.privacyNoticeAccepted").value(true))
                .andExpect(jsonPath("$.privacyNoticeVersion").value("foundation-v1"));

        mockMvc.perform(
                        post("/v1/households")
                                .with(identity("fake-false", "false@example.test", "False"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(VALID_CREATE_REQUEST.replace("\"ageConfirmed\": true", "\"ageConfirmed\": false")))
                .andExpect(status().isBadRequest())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.errors.ageConfirmed").value("must be true"));
    }

    @Test
    void rejectsStaleNoticeInvalidCurrencyAndNonIanaTimezone() throws Exception {
        mockMvc.perform(
                        post("/v1/households")
                                .with(identity("fake-stale", "stale@example.test", "Stale"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        VALID_CREATE_REQUEST.replace(
                                                "foundation-v1", "old-notice")))
                .andExpect(status().isConflict())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON));

        mockMvc.perform(
                        post("/v1/households")
                                .with(identity("fake-currency", "currency@example.test", "Currency"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(VALID_CREATE_REQUEST.replace("\"INR\"", "\"ZZZ\"")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("ISO 4217")));

        mockMvc.perform(
                        post("/v1/households")
                                .with(identity("fake-zone", "zone@example.test", "Zone"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(VALID_CREATE_REQUEST.replace("Asia/Kolkata", "+05:30")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("IANA")));
    }

    @Test
    void rejectsSensitiveHouseholdNamesWithoutChangingValidM1Behavior()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "fake-sensitive-household",
                        "sensitive-household@example.test",
                        "Household Guardrail");

        mockMvc.perform(
                        post("/v1/households")
                                .with(owner)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        VALID_CREATE_REQUEST.replace(
                                                "Alice household",
                                                "Family 4111 1111 1111 1111")))
                .andExpect(status().isBadRequest())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(
                        jsonPath("$.detail")
                                .value(
                                        "name must not contain payment account identifiers or authentication secrets."));

        mockMvc.perform(
                        post("/v1/households")
                                .with(owner)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        VALID_CREATE_REQUEST.replace(
                                                "Alice household",
                                                "OTP household reminder")))
                .andExpect(status().isBadRequest());

        mockMvc.perform(
                        post("/v1/households")
                                .with(owner)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        VALID_CREATE_REQUEST.replace(
                                                "Alice household",
                                                "Family household 2026")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Family household 2026"));

        mockMvc.perform(get("/v1/households").with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(
                        jsonPath("$.items[0].name")
                                .value("Family household 2026"));
    }

    private static JwtRequestPostProcessor identity(
            String subject, String email, String displayName) {
        return jwt()
                .jwt(
                        token ->
                                token.subject(subject)
                                        .claim("email", email)
                                        .claim("name", displayName))
                .authorities(
                        new org.springframework.security.core.authority.SimpleGrantedAuthority(
                                "ROLE_USER"));
    }
}
