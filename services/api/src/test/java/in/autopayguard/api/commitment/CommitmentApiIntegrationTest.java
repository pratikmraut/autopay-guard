package in.autopayguard.api.commitment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(CommitmentApiIntegrationTest.FixedClockConfiguration.class)
class CommitmentApiIntegrationTest {

    private static final UUID STREAMBOX =
            UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final ZoneId HOUSEHOLD_ZONE = ZoneId.of("Asia/Kolkata");
    private static final Instant TEST_NOW = Instant.parse("2026-07-26T00:00:00Z");
    private static final LocalDate TEST_TODAY =
            TEST_NOW.atZone(HOUSEHOLD_ZONE).toLocalDate();

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void crudUsesExactOwnershipUniform404AndQuotedOptimisticEtags() throws Exception {
        JwtRequestPostProcessor alice = identity("m2-alice", "m2-alice@example.test", "Alice");
        JwtRequestPostProcessor bob = identity("m2-bob", "m2-bob@example.test", "Bob");
        UUID aliceHousehold = createHousehold(alice, "Alice M2");
        createHousehold(bob, "Bob M2");

        Map<String, Object> create =
                fixedCommitment(
                        aliceHousehold,
                        STREAMBOX,
                        "StreamBox monthly",
                        "SUBSCRIPTION",
                        "INR",
                        49900L,
                        LocalDate.of(2026, 8, 5));
        MvcResult created =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(alice)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(objectMapper.writeValueAsBytes(create)))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                        .andExpect(jsonPath("$.source").value("MANUAL"))
                        .andExpect(
                                jsonPath("$.sourceConfidence")
                                        .value(org.hamcrest.Matchers.nullValue()))
                        .andExpect(jsonPath("$.visibility").value("PRIVATE"))
                        .andExpect(jsonPath("$.version").value(1))
                        .andExpect(
                                jsonPath(
                                        "$.reviewActions",
                                        containsInAnyOrder(
                                                "KEEP",
                                                "REVIEW",
                                                "PAUSE_TRACKING",
                                                "CANCEL_WITH_PROVIDER",
                                                "DOWNGRADE_WITH_PROVIDER",
                                                "SWITCH_PROVIDER")))
                        .andReturn();
        UUID commitmentId =
                UUID.fromString(
                        JsonPath.read(
                                created.getResponse().getContentAsString(), "$.id"));
        LocalDate preservedPastDate = TEST_TODAY.minusDays(1);
        jdbcTemplate.update(
                """
                INSERT INTO commitment_occurrences (
                    id, commitment_id, scheduled_date, expected_amount_minor, currency,
                    amount_kind, state, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                UUID.randomUUID(),
                commitmentId,
                preservedPastDate,
                49_900L,
                "INR",
                "FIXED",
                "UPCOMING");

        Map<String, Object> attemptedOwnerInjection = new LinkedHashMap<>(create);
        attemptedOwnerInjection.put("ownerUserId", UUID.randomUUID());
        mockMvc.perform(
                        post("/v1/commitments")
                                .with(alice)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        objectMapper.writeValueAsBytes(
                                                attemptedOwnerInjection)))
                .andExpect(status().isBadRequest())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON));

        Map<String, Object> missingRequiredNullable = new LinkedHashMap<>(create);
        missingRequiredNullable.remove("maskedPaymentLabel");
        mockMvc.perform(
                        post("/v1/commitments")
                                .with(alice)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        objectMapper.writeValueAsBytes(
                                                missingRequiredNullable)))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get("/v1/commitments/{id}", commitmentId).with(bob))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").value("The requested resource was not found."));
        mockMvc.perform(
                        get("/v1/commitments/{id}/occurrences", commitmentId)
                                .param("from", "2026-08-01")
                                .param("to", "2026-08-31")
                                .with(bob))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/dashboard/summary")
                                .param("householdId", aliceHousehold.toString())
                                .param("month", "2026-08")
                                .with(bob))
                .andExpect(status().isNotFound())
                .andExpect(
                        jsonPath("$.detail")
                                .value("The requested resource was not found."));
        mockMvc.perform(
                        get("/v1/commitments")
                                .param("householdId", aliceHousehold.toString())
                                .with(bob))
                .andExpect(status().isNotFound())
                .andExpect(
                        jsonPath("$.detail")
                                .value("The requested resource was not found."));
        mockMvc.perform(
                        get("/v1/commitments/upcoming")
                                .param("householdId", aliceHousehold.toString())
                                .with(bob))
                .andExpect(status().isNotFound())
                .andExpect(
                        jsonPath("$.detail")
                                .value("The requested resource was not found."));
        mockMvc.perform(
                        get("/v1/dashboard/calendar")
                                .param("householdId", aliceHousehold.toString())
                                .param("from", "2026-08-01")
                                .param("to", "2026-08-31")
                                .with(bob))
                .andExpect(status().isNotFound())
                .andExpect(
                        jsonPath("$.detail")
                                .value("The requested resource was not found."));

        Map<String, Object> update = updateFrom(create, "StreamBox updated", "ACTIVE");
        update.put("anchorDate", "2026-08-06");
        mockMvc.perform(
                        patch("/v1/commitments/{id}", commitmentId)
                                .with(bob)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(update)))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        delete("/v1/commitments/{id}", commitmentId)
                                .with(bob)
                                .header(HttpHeaders.IF_MATCH, "\"1\""))
                .andExpect(status().isNotFound());

        mockMvc.perform(
                        patch("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(update)))
                .andExpect(status().isPreconditionRequired());
        mockMvc.perform(
                        patch("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "0")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(update)))
                .andExpect(status().isBadRequest());

        mockMvc.perform(
                        patch("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(update)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                .andExpect(jsonPath("$.displayName").value("StreamBox updated"))
                .andExpect(jsonPath("$.version").value(2));
        assertThat(
                        occurrenceCount(commitmentId, preservedPastDate))
                .isEqualTo(1);
        assertThat(
                        occurrenceCount(commitmentId, LocalDate.of(2026, 8, 5)))
                .isZero();
        assertThat(
                        occurrenceCount(commitmentId, LocalDate.of(2026, 8, 6)))
                .isEqualTo(1);
        mockMvc.perform(
                        patch("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(update)))
                .andExpect(status().isPreconditionFailed());

        mockMvc.perform(
                        delete("/v1/commitments/{id}", commitmentId)
                                .with(alice))
                .andExpect(status().isPreconditionRequired());
        mockMvc.perform(
                        delete("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "2"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        delete("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"1\""))
                .andExpect(status().isPreconditionFailed());
        mockMvc.perform(
                        delete("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"2\""))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/v1/commitments/{id}", commitmentId).with(alice))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"3\""))
                .andExpect(jsonPath("$.status").value("ARCHIVED"));
        assertThat(occurrenceCount(commitmentId, preservedPastDate)).isEqualTo(1);
        assertThat(occurrenceCount(commitmentId, LocalDate.of(2026, 8, 6))).isZero();

        mockMvc.perform(
                        patch("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"3\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(update)))
                .andExpect(status().isNotFound())
                .andExpect(
                        jsonPath("$.detail")
                                .value("The requested resource was not found."));
        mockMvc.perform(
                        delete("/v1/commitments/{id}", commitmentId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"3\""))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/v1/commitments/{id}", commitmentId).with(alice))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"3\""))
                .andExpect(jsonPath("$.status").value("ARCHIVED"))
                .andExpect(jsonPath("$.displayName").value("StreamBox updated"));

        mockMvc.perform(
                        get("/v1/commitments")
                                .param("householdId", aliceHousehold.toString())
                                .with(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
        mockMvc.perform(
                        get("/v1/commitments")
                                .param("householdId", aliceHousehold.toString())
                                .param("includeArchived", "true")
                                .with(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        String excessiveCursor =
                Base64.getUrlEncoder()
                        .withoutPadding()
                        .encodeToString(
                                "v1:10001:20".getBytes(StandardCharsets.UTF_8));
        mockMvc.perform(
                        get("/v1/commitments")
                                .param("householdId", aliceHousehold.toString())
                                .param("cursor", excessiveCursor)
                                .with(alice))
                .andExpect(status().isBadRequest())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    void materializesInclusiveNinetyDayHorizonAndBoundsExtremeInput()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity("m2-horizon", "m2-horizon@example.test", "Horizon");
        UUID household = createHousehold(owner, "Horizon M2");
        LocalDate today = TEST_TODAY;
        Map<String, Object> daily =
                variableCommitment(
                        household,
                        "Daily variable",
                        "OTHER",
                        "INR",
                        null,
                        today.minusDays(5));
        daily.put("frequency", "CUSTOM");
        daily.put("customIntervalUnit", "DAYS");
        daily.put("intervalCount", 1);
        MvcResult created =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(owner)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(objectMapper.writeValueAsBytes(daily)))
                        .andExpect(status().isCreated())
                        .andReturn();
        String commitmentId =
                JsonPath.read(created.getResponse().getContentAsString(), "$.id");

        mockMvc.perform(
                        get("/v1/commitments/upcoming")
                                .param("householdId", household.toString())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value(today.toString()))
                .andExpect(jsonPath("$.to").value(today.plusDays(90).toString()))
                .andExpect(jsonPath("$.items.length()").value(91))
                .andExpect(
                        jsonPath("$.items[0].amountKind")
                                .value("UNKNOWN_VARIABLE"));
        mockMvc.perform(
                        get("/v1/commitments/{id}/occurrences", commitmentId)
                                .param("from", today.toString())
                                .param("to", today.plusDays(90).toString())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(91));

        mockMvc.perform(
                        get("/v1/commitments/upcoming")
                                .param("householdId", household.toString())
                                .param("from", LocalDate.MAX.toString())
                                .with(owner))
                .andExpect(status().isBadRequest())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    void rejectsSensitiveDisplayNamesOnCreateAndUpdateWithoutPersistingThem()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity("m2-sensitive-name", "m2-sensitive-name@example.test", "Guardrail");
        UUID household = createHousehold(owner, "Guardrail M2");
        Map<String, Object> safeCreate =
                fixedCommitment(
                        household,
                        STREAMBOX,
                        "StreamBox Demo",
                        "SUBSCRIPTION",
                        "INR",
                        49900L,
                        LocalDate.of(2026, 8, 5));

        Map<String, Object> digitHeavyCreate = new LinkedHashMap<>(safeCreate);
        digitHeavyCreate.put("displayName", "Card 4111 1111 1111 1111");
        mockMvc.perform(
                        post("/v1/commitments")
                                .with(owner)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        objectMapper.writeValueAsBytes(
                                                digitHeavyCreate)))
                .andExpect(status().isBadRequest())
                .andExpect(
                        content()
                                .contentTypeCompatibleWith(
                                        MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(
                        jsonPath("$.detail")
                                .value(
                                        "displayName must not contain payment account identifiers or authentication secrets."));

        Map<String, Object> keywordCreate = new LinkedHashMap<>(safeCreate);
        keywordCreate.put("displayName", "OTP renewal reminder");
        mockMvc.perform(
                        post("/v1/commitments")
                                .with(owner)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(keywordCreate)))
                .andExpect(status().isBadRequest());
        assertThat(commitmentCount(household)).isZero();

        MvcResult created =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(owner)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(objectMapper.writeValueAsBytes(safeCreate)))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                        .andReturn();
        UUID commitmentId =
                UUID.fromString(
                        JsonPath.read(
                                created.getResponse().getContentAsString(), "$.id"));

        Map<String, Object> digitHeavyUpdate =
                updateFrom(safeCreate, "Account 1234 5678 9012", "ACTIVE");
        mockMvc.perform(
                        patch("/v1/commitments/{id}", commitmentId)
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        objectMapper.writeValueAsBytes(
                                                digitHeavyUpdate)))
                .andExpect(status().isBadRequest());

        Map<String, Object> keywordUpdate =
                updateFrom(safeCreate, "Password renewal reminder", "ACTIVE");
        mockMvc.perform(
                        patch("/v1/commitments/{id}", commitmentId)
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(keywordUpdate)))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get("/v1/commitments/{id}", commitmentId).with(owner))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.displayName").value("StreamBox Demo"))
                .andExpect(jsonPath("$.version").value(1));
        assertThat(commitmentCount(household)).isEqualTo(1);
    }

    @Test
    void merchantSearchAndDashboardKeepCurrenciesAndUnknownAmountsSeparate()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity("m2-summary", "m2-summary@example.test", "Summary");
        UUID household = createHousehold(owner, "Summary M2");

        mockMvc.perform(
                        get("/v1/merchants/search")
                                .param("q", "cloud nest")
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].canonicalName").value("CloudNest Demo"))
                .andExpect(jsonPath("$.items[0].websiteHost").value("cloudnest.example"));

        createCommitment(
                owner,
                fixedCommitment(
                        household,
                        null,
                        "INR fixed",
                        "SUBSCRIPTION",
                        "INR",
                        100L,
                        LocalDate.of(2026, 8, 5)));
        createCommitment(
                owner,
                variableCommitment(
                        household,
                        "INR estimate",
                        "UTILITY",
                        "INR",
                        250L,
                        LocalDate.of(2026, 8, 10)));
        createCommitment(
                owner,
                variableCommitment(
                        household,
                        "USD unknown",
                        "OTHER",
                        "USD",
                        null,
                        LocalDate.of(2026, 8, 15)));

        mockMvc.perform(
                        get("/v1/dashboard/summary")
                                .param("householdId", household.toString())
                                .param("month", "2026-08")
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeCommitmentCount").value(3))
                .andExpect(jsonPath("$.variableCommitmentCount").value(2))
                .andExpect(jsonPath("$.unknownVariableCommitmentCount").value(1))
                .andExpect(jsonPath("$.monthlyProjection.occurrenceCount").value(3))
                .andExpect(
                        jsonPath("$.monthlyProjection.totals[0].currency")
                                .value("INR"))
                .andExpect(
                        jsonPath("$.monthlyProjection.totals[0].fixedAmountMinor")
                                .value(100))
                .andExpect(
                        jsonPath(
                                        "$.monthlyProjection.totals[0].estimatedVariableAmountMinor")
                                .value(250))
                .andExpect(
                        jsonPath("$.monthlyProjection.totals[0].knownTotalMinor")
                                .value(350))
                .andExpect(
                        jsonPath("$.monthlyProjection.totals[1].currency")
                                .value("USD"))
                .andExpect(
                        jsonPath("$.monthlyProjection.totals[1].knownTotalMinor")
                                .value(0))
                .andExpect(
                        jsonPath(
                                        "$.monthlyProjection.totals[1].unknownVariableOccurrenceCount")
                                .value(1))
                .andExpect(jsonPath("$.annualizedProjection.occurrenceCount").value(36))
                .andExpect(
                        jsonPath("$.annualizedProjection.unknownVariableOccurrenceCount")
                                .value(12));

        mockMvc.perform(
                        get("/v1/dashboard/calendar")
                                .param("householdId", household.toString())
                                .param("from", "2026-08-01")
                                .param("to", "2026-08-31")
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.days.length()").value(31))
                .andExpect(
                        jsonPath("$.days[14].items[0].amountKind")
                                .value("UNKNOWN_VARIABLE"));
    }

    private UUID createHousehold(
            JwtRequestPostProcessor identity, String name) throws Exception {
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
                                        .with(identity)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(request))
                        .andExpect(status().isCreated())
                        .andReturn();
        return UUID.fromString(
                JsonPath.read(result.getResponse().getContentAsString(), "$.id"));
    }

    private void createCommitment(
            JwtRequestPostProcessor identity, Map<String, Object> request)
            throws Exception {
        mockMvc.perform(
                        post("/v1/commitments")
                                .with(identity)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(request)))
                .andExpect(status().isCreated());
    }

    private int occurrenceCount(UUID commitmentId, LocalDate scheduledDate) {
        return jdbcTemplate.queryForObject(
                """
                SELECT count(*)
                FROM commitment_occurrences
                WHERE commitment_id = ?
                  AND scheduled_date = ?
                """,
                Integer.class,
                commitmentId,
                scheduledDate);
    }

    private int commitmentCount(UUID householdId) {
        return jdbcTemplate.queryForObject(
                "SELECT count(*) FROM recurring_commitments WHERE household_id = ?",
                Integer.class,
                householdId);
    }

    private static Map<String, Object> fixedCommitment(
            UUID householdId,
            UUID merchantId,
            String displayName,
            String category,
            String currency,
            long amount,
            LocalDate anchor) {
        Map<String, Object> request = baseCommitment(householdId, displayName, category, currency, anchor);
        request.put("merchantId", merchantId);
        request.put("amountMinor", amount);
        request.put("estimatedAmountMinor", null);
        request.put("variableAmount", false);
        return request;
    }

    private static Map<String, Object> variableCommitment(
            UUID householdId,
            String displayName,
            String category,
            String currency,
            Long estimate,
            LocalDate anchor) {
        Map<String, Object> request = baseCommitment(householdId, displayName, category, currency, anchor);
        request.put("merchantId", null);
        request.put("amountMinor", null);
        request.put("estimatedAmountMinor", estimate);
        request.put("variableAmount", true);
        return request;
    }

    private static Map<String, Object> baseCommitment(
            UUID householdId,
            String displayName,
            String category,
            String currency,
            LocalDate anchor) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("householdId", householdId);
        request.put("displayName", displayName);
        request.put("category", category);
        request.put("paymentRail", "CARD_RECURRING");
        request.put("currency", currency);
        request.put("frequency", "MONTHLY");
        request.put("intervalCount", 1);
        request.put("customIntervalUnit", null);
        request.put("anchorDate", anchor);
        request.put("monthDayPolicy", "ANCHOR_DAY");
        request.put("maskedPaymentLabel", null);
        return request;
    }

    private static Map<String, Object> updateFrom(
            Map<String, Object> create, String displayName, String status) {
        Map<String, Object> update = new LinkedHashMap<>(create);
        update.remove("householdId");
        update.put("displayName", displayName);
        update.put("status", status);
        return update;
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

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedClockConfiguration {

        @Bean
        @Primary
        Clock commitmentApiTestClock() {
            return Clock.fixed(TEST_NOW, ZoneOffset.UTC);
        }
    }
}
