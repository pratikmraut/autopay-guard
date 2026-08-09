package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NotificationConfigurationApiIntegrationTest {

    private static final String ENABLED_PREFERENCES =
            """
            {
              "enabled": true,
              "inAppEnabled": true,
              "emailEnabled": true,
              "timezone": "Asia/Kolkata",
              "quietHoursEnabled": true,
              "quietStart": "22:00",
              "quietEnd": "07:00"
            }
            """;

    private static final String CUSTOM_RULES =
            """
            {
              "mode": "CUSTOM",
              "rules": [
                {
                  "channel": "IN_APP",
                  "offsetDays": 7,
                  "localSendTime": "09:00",
                  "enabled": true
                },
                {
                  "channel": "EMAIL",
                  "offsetDays": 1,
                  "localSendTime": "10:30",
                  "enabled": true
                }
              ]
            }
            """;

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Test
    void preferencesUseSyntheticDefaultsWholeResourceEtagsAndSubjectIsolation()
            throws Exception {
        String alice = "m3-pref-alice";
        String bob = "m3-pref-bob";

        mockMvc.perform(get("/v1/notification-preferences").with(identity(alice)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                .andExpect(jsonPath("$.id").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.inAppEnabled").value(false))
                .andExpect(jsonPath("$.emailEnabled").value(false))
                .andExpect(jsonPath("$.timezone").value("Asia/Kolkata"))
                .andExpect(jsonPath("$.quietStart").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.updatedAt").value(org.hamcrest.Matchers.nullValue()));

        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(alice))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(ENABLED_PREFERENCES))
                .andExpect(status().isPreconditionRequired());
        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "0")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(ENABLED_PREFERENCES))
                .andExpect(status().isBadRequest());

        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(ENABLED_PREFERENCES))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.quietStart").value("22:00"))
                .andExpect(jsonPath("$.quietEnd").value("07:00"))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());

        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(ENABLED_PREFERENCES))
                .andExpect(status().isPreconditionFailed());

        String disabled =
                ENABLED_PREFERENCES
                        .replace("\"enabled\": true", "\"enabled\": false")
                        .replace("\"emailEnabled\": true", "\"emailEnabled\": false");
        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(disabled))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.enabled").value(false));

        mockMvc.perform(get("/v1/notification-preferences").with(identity(bob)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                .andExpect(jsonPath("$.id").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.version").value(0));
    }

    @Test
    void preferencesRejectInvalidTimezoneAndQuietHourCombinations() throws Exception {
        String subject = "m3-pref-validation";
        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(subject))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        ENABLED_PREFERENCES.replace(
                                                "Asia/Kolkata", "Invalid/Nowhere")))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.detail")
                                .value("timezone must be a valid IANA timezone."));

        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(subject))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        ENABLED_PREFERENCES.replace(
                                                "Asia/Kolkata", "+05:30")))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.detail")
                                .value("timezone must be a valid IANA timezone."));

        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(subject))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        ENABLED_PREFERENCES.replace(
                                                "Asia/Kolkata", "GMT+05:30")))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.detail")
                                .value("timezone must be a valid IANA timezone."));

        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(subject))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        ENABLED_PREFERENCES.replace(
                                                "\"quietEnd\": \"07:00\"",
                                                "\"quietEnd\": null")))
                .andExpect(status().isBadRequest());

        mockMvc.perform(
                        put("/v1/notification-preferences")
                                .with(identity(subject))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        ENABLED_PREFERENCES.replace(
                                                "\"quietEnd\": \"07:00\"",
                                                "\"quietEnd\": \"22:00\"")))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.detail")
                                .value("quietStart and quietEnd must be different."));
    }

    @Test
    void householdAndCommitmentRulesEnforceOwnershipModesValidationAndEtags()
            throws Exception {
        String alice = "m3-rule-alice";
        String bob = "m3-rule-bob";
        UUID householdId = createHousehold(alice, "M3 Alice rules");
        createHousehold(bob, "M3 Bob rules");

        mockMvc.perform(
                        get("/v1/households/{householdId}/reminder-rules", householdId)
                                .with(identity(alice)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                .andExpect(jsonPath("$.id").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.householdId").value(householdId.toString()))
                .andExpect(jsonPath("$.commitmentId").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.mode").value("DISABLED"))
                .andExpect(jsonPath("$.rules.length()").value(0))
                .andExpect(jsonPath("$.suggestedRules.length()").value(6))
                .andExpect(
                        jsonPath(
                                "$.suggestedRules[*].offsetDays",
                                containsInAnyOrder(7, 3, 1, 7, 3, 1)))
                .andExpect(jsonPath("$.version").value(0));

        mockMvc.perform(
                        get("/v1/households/{householdId}/reminder-rules", householdId)
                                .with(identity(bob)))
                .andExpect(status().isNotFound());

        mockMvc.perform(
                        put("/v1/households/{householdId}/reminder-rules", householdId)
                                .with(identity(bob))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(CUSTOM_RULES))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/households/{householdId}/reminder-rules", householdId)
                                .with(identity(alice)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                .andExpect(jsonPath("$.mode").value("DISABLED"))
                .andExpect(jsonPath("$.rules.length()").value(0))
                .andExpect(jsonPath("$.version").value(0));

        mockMvc.perform(
                        put("/v1/households/{householdId}/reminder-rules", householdId)
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"mode":"INHERIT","rules":[]}
                                        """))
                .andExpect(status().isBadRequest());

        mockMvc.perform(
                        put("/v1/households/{householdId}/reminder-rules", householdId)
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(CUSTOM_RULES))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.mode").value("CUSTOM"))
                .andExpect(jsonPath("$.rules.length()").value(2))
                .andExpect(jsonPath("$.version").value(1));

        mockMvc.perform(
                        put("/v1/households/{householdId}/reminder-rules", householdId)
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(CUSTOM_RULES))
                .andExpect(status().isPreconditionFailed());

        String duplicate =
                """
                {
                  "mode":"CUSTOM",
                  "rules":[
                    {"channel":"IN_APP","offsetDays":3,"localSendTime":"09:00","enabled":true},
                    {"channel":"IN_APP","offsetDays":3,"localSendTime":"12:00","enabled":true}
                  ]
                }
                """;
        mockMvc.perform(
                        put("/v1/households/{householdId}/reminder-rules", householdId)
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(duplicate))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.detail")
                                .value(
                                        "Each channel and offsetDays combination must be unique."));

        UUID commitmentId = createCommitment(alice, householdId, "M3 reminder commitment");
        mockMvc.perform(
                        get("/v1/commitments/{commitmentId}/reminder-rules", commitmentId)
                                .with(identity(alice)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                .andExpect(jsonPath("$.householdId").value(householdId.toString()))
                .andExpect(jsonPath("$.commitmentId").value(commitmentId.toString()))
                .andExpect(jsonPath("$.mode").value("INHERIT"))
                .andExpect(jsonPath("$.suggestedRules.length()").value(0));
        mockMvc.perform(
                        get("/v1/commitments/{commitmentId}/reminder-rules", commitmentId)
                                .with(identity(bob)))
                .andExpect(status().isNotFound());

        mockMvc.perform(
                        put("/v1/commitments/{commitmentId}/reminder-rules", commitmentId)
                                .with(identity(bob))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"mode\":\"DISABLED\",\"rules\":[]}"))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/commitments/{commitmentId}/reminder-rules", commitmentId)
                                .with(identity(alice)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                .andExpect(jsonPath("$.mode").value("INHERIT"))
                .andExpect(jsonPath("$.rules.length()").value(0))
                .andExpect(jsonPath("$.version").value(0));

        mockMvc.perform(
                        put("/v1/commitments/{commitmentId}/reminder-rules", commitmentId)
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"mode\":\"DISABLED\",\"rules\":[]}"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.mode").value("DISABLED"));

        mockMvc.perform(
                        delete("/v1/commitments/{commitmentId}", commitmentId)
                                .with(identity(alice))
                                .header(HttpHeaders.IF_MATCH, "\"1\""))
                .andExpect(status().isNoContent());
        mockMvc.perform(
                        get("/v1/commitments/{commitmentId}/reminder-rules", commitmentId)
                                .with(identity(alice)))
                .andExpect(status().isNotFound());
    }

    @Test
    void concurrentVersionZeroCreatesSerializeToOneSuccessAndOnePreconditionFailure()
            throws Exception {
        String preferenceSubject = "m3-pref-concurrent";
        mockMvc.perform(get("/v1/notification-preferences").with(identity(preferenceSubject)))
                .andExpect(status().isOk());
        assertConcurrentStatuses(
                () ->
                        putStatus(
                                "/v1/notification-preferences",
                                preferenceSubject,
                                ENABLED_PREFERENCES));

        String householdSubject = "m3-household-concurrent";
        UUID householdId = createHousehold(householdSubject, "M3 concurrent household");
        assertConcurrentStatuses(
                () ->
                        putStatus(
                                "/v1/households/" + householdId + "/reminder-rules",
                                householdSubject,
                                CUSTOM_RULES));

        UUID commitmentId =
                createCommitment(
                        householdSubject, householdId, "M3 concurrent commitment");
        assertConcurrentStatuses(
                () ->
                        putStatus(
                                "/v1/commitments/" + commitmentId + "/reminder-rules",
                                householdSubject,
                                "{\"mode\":\"DISABLED\",\"rules\":[]}"));
    }

    private void assertConcurrentStatuses(StatusRequest request) throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<CompletableFuture<Integer>> requests = new ArrayList<>();
            for (int index = 0; index < 2; index++) {
                requests.add(
                        CompletableFuture.supplyAsync(
                                () -> {
                                    try {
                                        start.await();
                                        return request.perform();
                                    } catch (Exception exception) {
                                        throw new CompletionException(exception);
                                    }
                                },
                                executor));
            }
            start.countDown();
            List<Integer> statuses =
                    requests.stream().map(CompletableFuture::join).sorted().toList();
            assertThat(statuses).containsExactly(200, 412);
        } finally {
            executor.shutdownNow();
        }
    }

    private int putStatus(String path, String subject, String body) throws Exception {
        return mockMvc.perform(
                        put(path)
                                .with(identity(subject))
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andReturn()
                .getResponse()
                .getStatus();
    }

    private UUID createHousehold(String subject, String name) throws Exception {
        String request =
                """
                {
                  "name": "%s",
                  "defaultCurrency": "INR",
                  "timezone": "Asia/Kolkata",
                  "ageConfirmed": true,
                  "privacyNoticeAccepted": true,
                  "privacyNoticeVersion": "foundation-v1"
                }
                """
                        .formatted(name);
        MvcResult result =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(identity(subject))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(request))
                        .andExpect(status().isCreated())
                        .andReturn();
        return UUID.fromString(
                JsonPath.read(result.getResponse().getContentAsString(), "$.id"));
    }

    private UUID createCommitment(String subject, UUID householdId, String name)
            throws Exception {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("householdId", householdId);
        request.put("merchantId", null);
        request.put("displayName", name);
        request.put("category", "SUBSCRIPTION");
        request.put("paymentRail", "CARD_RECURRING");
        request.put("amountMinor", 49900L);
        request.put("estimatedAmountMinor", null);
        request.put("currency", "INR");
        request.put("frequency", "MONTHLY");
        request.put("intervalCount", 1);
        request.put("customIntervalUnit", null);
        request.put(
                "anchorDate",
                LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(10).toString());
        request.put("monthDayPolicy", "ANCHOR_DAY");
        request.put("variableAmount", false);
        request.put("maskedPaymentLabel", null);
        MvcResult result =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(identity(subject))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(objectMapper.writeValueAsBytes(request)))
                        .andExpect(status().isCreated())
                        .andReturn();
        return UUID.fromString(
                JsonPath.read(result.getResponse().getContentAsString(), "$.id"));
    }

    private static JwtRequestPostProcessor identity(String subject) {
        return jwt()
                .jwt(
                        token ->
                                token.subject(subject)
                                        .claim("email", subject + "@example.test")
                                        .claim("name", subject))
                .authorities(
                        new org.springframework.security.core.authority.SimpleGrantedAuthority(
                                "ROLE_USER"));
    }

    @FunctionalInterface
    private interface StatusRequest {
        int perform() throws Exception;
    }
}
