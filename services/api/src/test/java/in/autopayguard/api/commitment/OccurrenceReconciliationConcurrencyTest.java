package in.autopayguard.api.commitment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OccurrenceReconciliationConcurrencyTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private OccurrenceReconciliationService reconciliationService;

    @Test
    void concurrentRerunsRemainIdempotentUnderUniqueCommitmentDateConstraint()
            throws Exception {
        JwtRequestPostProcessor owner =
                jwt()
                        .jwt(
                                token ->
                                        token.subject("m2-concurrent")
                                                .claim(
                                                        "email",
                                                        "m2-concurrent@example.test")
                                                .claim("name", "Concurrent"))
                        .authorities(
                                new org.springframework.security.core.authority.SimpleGrantedAuthority(
                                        "ROLE_USER"));
        String householdRequest =
                """
                {
                  "name": "Concurrent household",
                  "defaultCurrency": "INR",
                  "timezone": "Asia/Kolkata",
                  "ageConfirmed": true,
                  "privacyNoticeAccepted": true,
                  "privacyNoticeVersion": "foundation-v1"
                }
                """;
        MvcResult householdCreated =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(owner)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(householdRequest))
                        .andExpect(status().isCreated())
                        .andReturn();
        String householdId =
                JsonPath.read(
                        householdCreated.getResponse().getContentAsString(),
                        "$.id");
        LocalDate anchor =
                LocalDate.now(ZoneId.of("Asia/Kolkata")).minusDays(3);
        String commitmentRequest =
                """
                {
                  "householdId": "%s",
                  "merchantId": null,
                  "displayName": "Concurrent daily",
                  "category": "OTHER",
                  "paymentRail": "UNKNOWN",
                  "amountMinor": 100,
                  "estimatedAmountMinor": null,
                  "currency": "INR",
                  "frequency": "CUSTOM",
                  "intervalCount": 1,
                  "customIntervalUnit": "DAYS",
                  "anchorDate": "%s",
                  "monthDayPolicy": "ANCHOR_DAY",
                  "variableAmount": false,
                  "maskedPaymentLabel": null
                }
                """
                        .formatted(householdId, anchor);
        MvcResult commitmentCreated =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(owner)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(commitmentRequest))
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID commitmentId =
                UUID.fromString(
                        JsonPath.read(
                                commitmentCreated
                                        .getResponse()
                                        .getContentAsString(),
                                "$.id"));
        jdbcTemplate.update(
                "DELETE FROM commitment_occurrences WHERE commitment_id = ?",
                commitmentId);

        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<?> first =
                    executor.submit(
                            () -> {
                                await(start);
                                reconciliationService.reconcileAll();
                            });
            Future<?> second =
                    executor.submit(
                            () -> {
                                await(start);
                                reconciliationService.reconcileAll();
                            });
            start.countDown();
            first.get();
            second.get();
        }

        MapCounts counts =
                jdbcTemplate.queryForObject(
                        """
                        SELECT count(*) AS total_count,
                               count(DISTINCT scheduled_date) AS distinct_count
                        FROM commitment_occurrences
                        WHERE commitment_id = ?
                        """,
                        (row, ignored) ->
                                new MapCounts(
                                        row.getInt("total_count"),
                                        row.getInt("distinct_count")),
                        commitmentId);
        assertThat(counts.total()).isEqualTo(91);
        assertThat(counts.distinct()).isEqualTo(counts.total());
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    private record MapCounts(int total, int distinct) {}
}
