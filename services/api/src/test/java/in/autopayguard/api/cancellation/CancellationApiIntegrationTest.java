package in.autopayguard.api.cancellation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
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
@Import(CancellationApiIntegrationTest.ClockConfiguration.class)
class CancellationApiIntegrationTest {

    private static final UUID STREAMBOX =
            UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final Instant BASE_TIME =
            Instant.parse("2026-08-01T00:00:00Z");

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private MutableClock clock;

    @BeforeEach
    void resetClock() {
        clock.set(BASE_TIME);
    }

    @Test
    void fullOwnerFlowPreservesStableReplaysEtagsSafetyAndHonestSavings()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor alice =
                identity("m4-alice-" + suffix, "m4-alice-" + suffix + "@example.test", "Alice");
        JwtRequestPostProcessor bob =
                identity("m4-bob-" + suffix, "m4-bob-" + suffix + "@example.test", "Bob");
        UUID householdId = createHousehold(alice, "Alice household");
        createHousehold(bob, "Bob household");
        CreatedCommitment commitment =
                createCommitment(
                        alice,
                        householdId,
                        "StreamBox M4",
                        LocalDate.of(2026, 8, 5));
        Occurrence occurrence = firstOccurrence(commitment.id());

        mockMvc.perform(
                        post("/v1/occurrences/{occurrenceId}/decisions", occurrence.id())
                                .with(bob)
                                .header("Idempotency-Key", "test-key-00000002")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"decision\":\"CANCEL_WITH_PROVIDER\"}"))
                .andExpect(status().isNotFound());

        MvcResult decisionCreated =
                mockMvc.perform(
                                post(
                                                "/v1/occurrences/{occurrenceId}/decisions",
                                                occurrence.id())
                                        .with(alice)
                                        .header(
                                                "Idempotency-Key",
                                                "decision-create-key-0001")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"decision\":\"CANCEL_WITH_PROVIDER\"}"))
                        .andExpect(status().isCreated())
                        .andExpect(
                                jsonPath("$.occurrenceId")
                                        .value(occurrence.id().toString()))
                        .andReturn();
        UUID decisionId =
                UUID.fromString(read(decisionCreated, "$.id"));

        mockMvc.perform(
                        post(
                                        "/v1/occurrences/{occurrenceId}/decisions",
                                        occurrence.id())
                                .with(alice)
                                .header(
                                        "Idempotency-Key",
                                        "decision-create-key-0001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"decision\":\"KEEP\"}"))
                .andExpect(status().isConflict());

        MvcResult guideResult =
                mockMvc.perform(
                                get(
                                                "/v1/commitments/{commitmentId}/cancellation-guide",
                                                commitment.id())
                                        .with(alice))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.status").value("PUBLISHED"))
                        .andExpect(jsonPath("$.freshness").value("CURRENT"))
                        .andExpect(jsonPath("$.targetsSuppressed").value(false))
                        .andExpect(jsonPath("$.tracks.length()").value(2))
                        .andExpect(
                                jsonPath("$.tracks[0].steps[1].target.uri")
                                        .value(
                                                "https://streambox.example/manage/subscription"))
                        .andReturn();
        UUID guideId = UUID.fromString(read(guideResult, "$.id"));
        int guideVersion =
                JsonPath.read(
                        guideResult.getResponse().getContentAsString(),
                        "$.version");

        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-guide",
                                        commitment.id())
                                .with(bob))
                .andExpect(status().isNotFound());

        byte[] createAttemptBody =
                objectMapper.writeValueAsBytes(
                        attemptRequest(
                                occurrence.id(),
                                decisionId,
                                guideId,
                                guideVersion,
                                null));
        MvcResult attemptCreated =
                mockMvc.perform(
                                post(
                                                "/v1/commitments/{commitmentId}/cancellation-attempts",
                                                commitment.id())
                                        .with(alice)
                                        .header(
                                                "Idempotency-Key",
                                                "attempt-create-key-0001")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(createAttemptBody))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                        .andExpect(jsonPath("$.version").value(0))
                        .andExpect(jsonPath("$.serviceStatus").value("NOT_STARTED"))
                        .andExpect(
                                jsonPath("$.paymentMandateStatus")
                                        .value("NOT_STARTED"))
                        .andExpect(jsonPath("$.verificationStatus").value("PENDING"))
                        .andExpect(jsonPath("$.verificationDueReached").value(false))
                        .andExpect(jsonPath("$.abandoned").value(false))
                        .andReturn();
        UUID attemptId = UUID.fromString(read(attemptCreated, "$.id"));

        Map<String, Object> mismatchedAttempt =
                attemptRequest(
                        occurrence.id(),
                        decisionId,
                        guideId,
                        guideVersion,
                        "Different safe note");
        mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitment.id())
                                .with(alice)
                                .header(
                                        "Idempotency-Key",
                                        "attempt-create-key-0001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        objectMapper.writeValueAsBytes(
                                                mismatchedAttempt)))
                .andExpect(status().isConflict());

        assertForeignAttemptSurfaceIsUniform404(
                bob, householdId, commitment.id(), attemptId, guideId, guideVersion);

        String confirmedTracks =
                """
                {
                  "serviceStatus": "CONFIRMED",
                  "paymentMandateStatus": "CONFIRMED",
                  "abandoned": false
                }
                """;
        mockMvc.perform(
                        patch("/v1/cancellation-attempts/{attemptId}", attemptId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmedTracks))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.completedAt").isNotEmpty());
        mockMvc.perform(
                        patch("/v1/cancellation-attempts/{attemptId}", attemptId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmedTracks))
                .andExpect(status().isPreconditionFailed());

        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        attemptId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .header(
                                        "Idempotency-Key",
                                        "verify-self-key-000001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"SELF_REPORTED\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(
                                jsonPath("$.verificationStatus")
                                        .value("SELF_REPORTED"));

        clock.set(Instant.parse("2026-08-05T18:29:59Z"));
        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        attemptId)
                                .with(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verificationDueReached").value(false));
        clock.set(Instant.parse("2026-08-05T18:30:00Z"));
        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        attemptId)
                                .with(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verificationDueReached").value(true));
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        attemptId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"2\"")
                                .header(
                                        "Idempotency-Key",
                                        "verify-final-key-0001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"VERIFIED\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"3\""))
                .andExpect(jsonPath("$.verificationStatus").value("VERIFIED"))
                .andExpect(jsonPath("$.verificationDueReached").value(true));

        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        attemptId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .header(
                                        "Idempotency-Key",
                                        "verify-self-key-000001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"SELF_REPORTED\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(
                                jsonPath("$.verificationStatus")
                                        .value("SELF_REPORTED"))
                .andExpect(jsonPath("$.verificationDueReached").value(false));

        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        attemptId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"3\"")
                                .header(
                                        "Idempotency-Key",
                                        "verify-dispute-key-001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"DISPUTED\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"4\""))
                .andExpect(jsonPath("$.verificationStatus").value("DISPUTED"));

        mockMvc.perform(
                        patch("/v1/cancellation-attempts/{attemptId}", attemptId)
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"4\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmedTracks))
                .andExpect(status().isConflict());

        mockMvc.perform(
                        get("/v1/savings")
                                .with(alice)
                                .param("householdId", householdId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unquantifiedCount").value(0))
                .andExpect(jsonPath("$.items[0].attemptId").value(attemptId.toString()))
                .andExpect(jsonPath("$.items[0].state").value("REVERSED"))
                .andExpect(
                                jsonPath("$.items[0].reversalReason")
                                        .value("DEBIT_OCCURRED"))
                .andExpect(jsonPath("$.items[0].amountMinor").value(5_988))
                .andExpect(
                                jsonPath("$.currencies[0].totals[3].state")
                                        .value("REVERSED"))
                .andExpect(
                                jsonPath(
                                                "$.currencies[0].totals[3].exactAmountMinor")
                                        .value(5_988));

        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM savings_events WHERE attempt_id = ?",
                                Integer.class,
                                attemptId))
                .isEqualTo(4);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM commitment_occurrences
                                WHERE commitment_id = ? AND state <> 'UPCOMING'
                                """,
                                Integer.class,
                                commitment.id()))
                .isZero();
        mockMvc.perform(
                        get("/v1/commitments/{commitmentId}", commitment.id())
                                .with(alice))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        String unsafeFeedback =
                """
                {
                  "commitmentId": "%s",
                  "guideVersion": %d,
                  "outcome": "UNSAFE_LINK",
                  "note": null
                }
                """
                        .formatted(commitment.id(), guideVersion);
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-guides/{guideId}/feedback",
                                        guideId)
                                .with(alice)
                                .header(
                                        "Idempotency-Key",
                                        "feedback-missing-note-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "commitmentId": "%s",
                                          "guideVersion": %d,
                                          "outcome": "UNSAFE_LINK"
                                        }
                                        """
                                                .formatted(
                                                        commitment.id(),
                                                        guideVersion)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-guides/{guideId}/feedback",
                                        guideId)
                                .with(alice)
                                .header(
                                        "Idempotency-Key",
                                        "unsafe-feedback-key-001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(unsafeFeedback))
                .andExpect(status().isNoContent());
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-guides/{guideId}/feedback",
                                        guideId)
                                .with(alice)
                                .header(
                                        "Idempotency-Key",
                                        "unsafe-feedback-key-001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(unsafeFeedback))
                .andExpect(status().isNoContent());
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-guides/{guideId}/feedback",
                                        guideId)
                                .with(alice)
                                .header(
                                        "Idempotency-Key",
                                        "unsafe-feedback-key-001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        unsafeFeedback.replace(
                                                "\"UNSAFE_LINK\"", "\"WORKED\"")))
                .andExpect(status().isConflict());

        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-guide",
                                        commitment.id())
                                .with(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetsSuppressed").value(true))
                .andExpect(
                                jsonPath("$.targetSuppressionReason")
                                        .value("USER_REPORTED_UNSAFE"))
                .andExpect(jsonPath("$.tracks[0].steps[1].target").isEmpty())
                .andExpect(jsonPath("$.tracks[1].steps[1].target").isEmpty());

        mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitment.id())
                                .with(alice)
                                .header(
                                        "Idempotency-Key",
                                        "attempt-create-key-0001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(createAttemptBody))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.serviceStatus").value("NOT_STARTED"))
                .andExpect(jsonPath("$.verificationStatus").value("PENDING"))
                .andExpect(jsonPath("$.guide.targetsSuppressed").value(true))
                .andExpect(
                                jsonPath("$.guide.tracks[0].steps[1].target")
                                        .isEmpty());

        mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitment.id())
                                .with(alice)
                                .header(
                                        "Idempotency-Key",
                                        "attempt-after-unsafe-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(createAttemptBody))
                .andExpect(status().isConflict());

        mockMvc.perform(
                        delete("/v1/commitments/{commitmentId}", commitment.id())
                                .with(alice)
                                .header(HttpHeaders.IF_MATCH, "\"1\""))
                .andExpect(status().isNoContent());
    }

    @Test
    void unsafeFeedbackIsScopedToTheExactCommitment() throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m5-feedback-scope-" + suffix,
                        "m5-feedback-scope-" + suffix + "@example.test",
                        "Feedback scope");
        UUID householdId = createHousehold(owner, "Feedback scope household");
        CreatedCommitment privateCommitment =
                createCommitment(
                        owner,
                        householdId,
                        "Private StreamBox",
                        LocalDate.of(2026, 8, 5));
        CreatedCommitment sharedCommitment =
                createCommitment(
                        owner,
                        householdId,
                        "Shared StreamBox",
                        LocalDate.of(2026, 8, 6));
        jdbcTemplate.update(
                """
                UPDATE recurring_commitments
                SET visibility = 'HOUSEHOLD'
                WHERE id = ?
                """,
                sharedCommitment.id());

        MvcResult guide =
                mockMvc.perform(
                                get(
                                                "/v1/commitments/{commitmentId}/cancellation-guide",
                                                privateCommitment.id())
                                        .with(owner))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.targetsSuppressed").value(false))
                        .andReturn();
        UUID guideId = UUID.fromString(read(guide, "$.id"));
        int guideVersion = JsonPath.read(guide.getResponse().getContentAsString(), "$.version");

        mockMvc.perform(
                        post(
                                        "/v1/cancellation-guides/{guideId}/feedback",
                                        guideId)
                                .with(owner)
                                .header(
                                        "Idempotency-Key",
                                        "feedback-scope-private-" + suffix)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "commitmentId": "%s",
                                          "guideVersion": %d,
                                          "outcome": "UNSAFE_LINK",
                                          "note": null
                                        }
                                        """
                                                .formatted(
                                                        privateCommitment.id(),
                                                        guideVersion)))
                .andExpect(status().isNoContent());

        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-guide",
                                        privateCommitment.id())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetsSuppressed").value(true))
                .andExpect(
                        jsonPath("$.targetSuppressionReason")
                                .value("USER_REPORTED_UNSAFE"));

        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-guide",
                                        sharedCommitment.id())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(guideId.toString()))
                .andExpect(jsonPath("$.version").value(guideVersion))
                .andExpect(jsonPath("$.targetsSuppressed").value(false))
                .andExpect(jsonPath("$.targetSuppressionReason").value("NONE"))
                .andExpect(jsonPath("$.tracks[0].steps[1].target.uri").isNotEmpty())
                .andExpect(jsonPath("$.tracks[1].steps[1].target.uri").isNotEmpty());
    }

    @Test
    void invalidTracksVerificationAndMassAssignmentFailWithoutChangingState()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m4-guards-" + suffix,
                        "m4-guards-" + suffix + "@example.test",
                        "Guards");
        UUID householdId = createHousehold(owner, "Guard household");
        CreatedCommitment commitment =
                createCommitment(
                        owner,
                        householdId,
                        "Guarded cancellation",
                        LocalDate.of(2026, 8, 5));
        AttemptFixture fixture =
                startAttempt(owner, commitment, "guard-flow-key-01");

        mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitment.id())
                                .with(owner)
                                .header(
                                        "Idempotency-Key",
                                        "guard-missing-note-key1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "occurrenceId": "%s",
                                          "decisionId": "%s",
                                          "guideId": "%s",
                                          "guideVersion": %d
                                        }
                                        """
                                                .formatted(
                                                        fixture.occurrence().id(),
                                                        fixture.decisionId(),
                                                        fixture.guideId(),
                                                        fixture.guideVersion())))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        patch(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "serviceStatus": "NOT_STARTED",
                                          "paymentMandateStatus": "NOT_STARTED"
                                        }
                                        """))
                .andExpect(status().isBadRequest());

        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "guard-incomplete-self-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"SELF_REPORTED\"}"))
                .andExpect(status().isConflict());
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "guard-incomplete-verified")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"VERIFIED\"}"))
                .andExpect(status().isConflict());

        String requestedTracks =
                """
                {
                  "serviceStatus": "REQUESTED",
                  "paymentMandateStatus": "REQUESTED",
                  "abandoned": false
                }
                """;
        mockMvc.perform(
                        patch(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(requestedTracks))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"1\""));
        mockMvc.perform(
                        patch(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "serviceStatus": "NOT_STARTED",
                                          "paymentMandateStatus": "REQUESTED",
                                          "abandoned": false
                                        }
                                        """))
                .andExpect(status().isConflict());
        mockMvc.perform(
                        delete(
                                        "/v1/commitments/{commitmentId}",
                                        commitment.id())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"1\""))
                .andExpect(status().isConflict());

        String confirmedTracks =
                """
                {
                  "serviceStatus": "CONFIRMED",
                  "paymentMandateStatus": "CONFIRMED",
                  "abandoned": false
                }
                """;
        mockMvc.perform(
                        patch(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(confirmedTracks))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"2\""));

        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"2\"")
                                .header(
                                        "Idempotency-Key",
                                        "guard-pre-due-verified1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"VERIFIED\"}"))
                .andExpect(status().isConflict());
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"2\"")
                                .header(
                                        "Idempotency-Key",
                                        "guard-pre-due-disputed1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"DISPUTED\"}"))
                .andExpect(status().isConflict());

        mockMvc.perform(
                        patch(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"2\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "serviceStatus": "CONFIRMED",
                                          "paymentMandateStatus": "CONFIRMED",
                                          "abandoned": false,
                                          "ownerUserId": "00000000-0000-0000-0000-000000000000"
                                        }
                                        """))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"2\"")
                                .header(
                                        "Idempotency-Key",
                                        "guard-unknown-json-key1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "status": "SELF_REPORTED",
                                          "version": 999
                                        }
                                        """))
                .andExpect(status().isBadRequest());

        mockMvc.perform(
                        patch(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"2\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "serviceStatus": "CONFIRMED",
                                          "paymentMandateStatus": "CONFIRMED",
                                          "abandoned": true
                                        }
                                        """))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"3\""))
                .andExpect(jsonPath("$.abandoned").value(true));
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"3\"")
                                .header(
                                        "Idempotency-Key",
                                        "guard-abandoned-verify01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"SELF_REPORTED\"}"))
                .andExpect(status().isConflict());
        mockMvc.perform(
                        patch(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"3\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "serviceStatus": "CONFIRMED",
                                          "paymentMandateStatus": "CONFIRMED",
                                          "abandoned": true
                                        }
                                        """))
                .andExpect(status().isConflict());
        mockMvc.perform(
                        delete(
                                        "/v1/commitments/{commitmentId}",
                                        commitment.id())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"1\""))
                .andExpect(status().isNoContent());
    }

    @Test
    void guideRemainsCurrentThroughReviewDueDateThenSuppressesAndBlocksAttempts()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m4-review-" + suffix,
                        "m4-review-" + suffix + "@example.test",
                        "Review");
        UUID householdId = createHousehold(owner, "Review household");
        CreatedCommitment commitment =
                createCommitment(
                        owner,
                        householdId,
                        "Review boundary",
                        LocalDate.of(2026, 8, 5));
        PreparedCancellation prepared =
                prepareCancellation(owner, commitment, "review-boundary-key1");

        clock.set(Instant.parse("2026-09-25T23:59:59Z"));
        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-guide",
                                        commitment.id())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.freshness").value("CURRENT"))
                .andExpect(jsonPath("$.targetsSuppressed").value(false));

        clock.set(Instant.parse("2026-09-26T00:00:00Z"));
        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-guide",
                                        commitment.id())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.freshness").value("REVIEW_DUE"))
                .andExpect(jsonPath("$.targetsSuppressed").value(true))
                .andExpect(
                                jsonPath("$.targetSuppressionReason")
                                        .value("REVIEW_DUE"))
                .andExpect(jsonPath("$.tracks[0].steps[1].target").isEmpty());

        byte[] body =
                objectMapper.writeValueAsBytes(
                        attemptRequest(
                                prepared.occurrence().id(),
                                prepared.decisionId(),
                                prepared.guideId(),
                                prepared.guideVersion(),
                                null));
        mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitment.id())
                                .with(owner)
                                .header(
                                        "Idempotency-Key",
                                        "review-due-attempt-key1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isConflict());
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM cancellation_attempts
                                WHERE commitment_id = ?
                                """,
                                Integer.class,
                                commitment.id()))
                .isZero();

        clock.set(Instant.parse("2026-09-25T12:00:00Z"));
        mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitment.id())
                                .with(owner)
                                .header(
                                        "Idempotency-Key",
                                        "review-due-attempt-key1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.ETAG, "\"0\""));
    }

    @Test
    void savingsKeepExactEstimatedUnknownAndCurrenciesSemanticallySeparate()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m4-ledger-" + suffix,
                        "m4-ledger-" + suffix + "@example.test",
                        "Ledger");
        UUID householdId = createHousehold(owner, "Ledger household");
        CreatedCommitment exactInr =
                createCommitment(
                        owner,
                        householdId,
                        "Exact rupees",
                        LocalDate.of(2026, 8, 5),
                        "CARD_RECURRING",
                        100L,
                        null,
                        "INR",
                        false);
        CreatedCommitment estimatedInr =
                createCommitment(
                        owner,
                        householdId,
                        "Estimated rupees",
                        LocalDate.of(2026, 8, 6),
                        "CARD_RECURRING",
                        null,
                        250L,
                        "INR",
                        true);
        CreatedCommitment exactUsd =
                createCommitment(
                        owner,
                        householdId,
                        "Exact dollars",
                        LocalDate.of(2026, 8, 7),
                        "CARD_RECURRING",
                        200L,
                        null,
                        "USD",
                        false);
        CreatedCommitment unknown =
                createCommitment(
                        owner,
                        householdId,
                        "Unknown manual amount",
                        LocalDate.of(2026, 8, 8),
                        "UNKNOWN",
                        null,
                        null,
                        "INR",
                        true);

        AttemptFixture exactInrAttempt =
                startAttempt(owner, exactInr, "ledger-exact-inr-01");
        AttemptFixture estimatedInrAttempt =
                startAttempt(owner, estimatedInr, "ledger-estimated-inr");
        AttemptFixture exactUsdAttempt =
                startAttempt(owner, exactUsd, "ledger-exact-usd-01");
        AttemptFixture unknownAttempt =
                startAttempt(owner, unknown, "ledger-unknown-key-01");

        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        unknownAttempt.attemptId())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(
                                jsonPath("$.paymentMandateStatus")
                                        .value("NOT_REQUIRED"))
                .andExpect(jsonPath("$.projectedSavingsMinor").isEmpty())
                .andExpect(jsonPath("$.estimated").value(false));

        MvcResult savings =
                mockMvc.perform(
                                get("/v1/savings")
                                        .with(owner)
                                        .param(
                                                "householdId",
                                                householdId.toString()))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.unquantifiedCount").value(1))
                        .andExpect(jsonPath("$.currencies.length()").value(2))
                        .andReturn();
        String json = savings.getResponse().getContentAsString();
        List<Map<String, Object>> currencies =
                JsonPath.read(json, "$.currencies");
        Map<String, Object> inr =
                currencies.stream()
                        .filter(value -> "INR".equals(value.get("currency")))
                        .findFirst()
                        .orElseThrow();
        Map<String, Object> usd =
                currencies.stream()
                        .filter(value -> "USD".equals(value.get("currency")))
                        .findFirst()
                        .orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> inrPotential =
                ((List<Map<String, Object>>) inr.get("totals")).stream()
                        .filter(value -> "POTENTIAL".equals(value.get("state")))
                        .findFirst()
                        .orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> usdPotential =
                ((List<Map<String, Object>>) usd.get("totals")).stream()
                        .filter(value -> "POTENTIAL".equals(value.get("state")))
                        .findFirst()
                        .orElseThrow();
        assertThat(((Number) inrPotential.get("exactAmountMinor")).longValue())
                .isEqualTo(1_200L);
        assertThat(((Number) inrPotential.get("estimatedAmountMinor")).longValue())
                .isEqualTo(3_000L);
        assertThat(((Number) inrPotential.get("exactAttemptCount")).intValue())
                .isOne();
        assertThat(
                        ((Number) inrPotential.get("estimatedAttemptCount"))
                                .intValue())
                .isOne();
        assertThat(((Number) usdPotential.get("exactAmountMinor")).longValue())
                .isEqualTo(2_400L);
        assertThat(((Number) usdPotential.get("estimatedAmountMinor")).longValue())
                .isZero();

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM savings_events
                                WHERE attempt_id IN (?, ?, ?, ?)
                                """,
                                Integer.class,
                                exactInrAttempt.attemptId(),
                                estimatedInrAttempt.attemptId(),
                                exactUsdAttempt.attemptId(),
                                unknownAttempt.attemptId()))
                .isEqualTo(3);

        jdbcTemplate.update(
                """
                UPDATE cancellation_attempts
                SET currency = 'INR',
                    projected_savings_minor = 5000000000000000
                WHERE id IN (?, ?)
                """,
                exactInrAttempt.attemptId(),
                exactUsdAttempt.attemptId());
        MvcResult overflow =
                mockMvc.perform(
                                get("/v1/savings")
                                        .with(owner)
                                        .param(
                                                "householdId",
                                                householdId.toString()))
                .andExpect(status().isConflict())
                .andExpect(
                                jsonPath("$.title")
                                        .value(
                                                "Request conflicts with current state"))
                .andExpect(
                                jsonPath("$.detail")
                                        .value(
                                                "Savings totals exceed the exact supported minor-unit range."))
                .andExpect(jsonPath("$.errorId").doesNotExist())
                .andReturn();
        assertThat(overflow.getResponse().getContentAsString())
                .doesNotContain(
                        "5000000000000000",
                        "stackTrace",
                        "RequestConflictException");
    }

    @Test
    void attemptAndSavingsRollbackAtomicallyWhenIdempotencyCompletionFails()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        String subject = "m4-rollback-" + suffix;
        JwtRequestPostProcessor owner =
                identity(
                        subject,
                        subject + "@example.test",
                        "Rollback");
        UUID householdId = createHousehold(owner, "Rollback household");
        CreatedCommitment commitment =
                createCommitment(
                        owner,
                        householdId,
                        "Atomic rollback",
                        LocalDate.of(2026, 8, 5));
        PreparedCancellation prepared =
                prepareCancellation(owner, commitment, "rollback-prepare-key1");
        byte[] body =
                objectMapper.writeValueAsBytes(
                        attemptRequest(
                                prepared.occurrence().id(),
                                prepared.decisionId(),
                                prepared.guideId(),
                                prepared.guideVersion(),
                                null));
        String key = "rollback-attempt-key-001";
        UUID ownerId =
                jdbcTemplate.queryForObject(
                        "SELECT id FROM users WHERE oidc_subject = ?",
                        UUID.class,
                        subject);

        jdbcTemplate.execute(
                """
                ALTER TABLE idempotency_records
                ADD CONSTRAINT ck_test_reject_attempt_completion
                CHECK (
                    operation <> 'CANCELLATION_ATTEMPT'
                    OR owner_user_id <> CAST('%s' AS UUID)
                )
                """
                        .formatted(ownerId));
        try {
            mockMvc.perform(
                            post(
                                            "/v1/commitments/{commitmentId}/cancellation-attempts",
                                            commitment.id())
                                    .with(owner)
                                    .header("Idempotency-Key", key)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isConflict());
        } finally {
            jdbcTemplate.execute(
                    """
                    ALTER TABLE idempotency_records
                    DROP CONSTRAINT ck_test_reject_attempt_completion
                    """);
        }

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM cancellation_attempts
                                WHERE commitment_id = ?
                                """,
                                Integer.class,
                                commitment.id()))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM savings_events e
                                JOIN cancellation_attempts a ON a.id = e.attempt_id
                                WHERE a.commitment_id = ?
                                """,
                                Integer.class,
                                commitment.id()))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM idempotency_records r
                                JOIN users u ON u.id = r.owner_user_id
                                WHERE u.oidc_subject = ?
                                  AND r.operation = 'CANCELLATION_ATTEMPT'
                                """,
                                Integer.class,
                                subject))
                .isZero();

        mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitment.id())
                                .with(owner)
                                .header("Idempotency-Key", key)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated());
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM cancellation_attempts
                                WHERE commitment_id = ?
                                """,
                                Integer.class,
                                commitment.id()))
                .isOne();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM savings_events e
                                JOIN cancellation_attempts a ON a.id = e.attempt_id
                                WHERE a.commitment_id = ?
                                """,
                                Integer.class,
                                commitment.id()))
                .isOne();
    }

    @Test
    void runtimeRejectsAPublishedGuideMissingAnyFixedManifestStep()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m4-manifest-" + suffix,
                        "m4-manifest-" + suffix + "@example.test",
                        "Manifest");
        UUID householdId = createHousehold(owner, "Manifest household");
        CreatedCommitment commitment =
                createCommitment(
                        owner,
                        householdId,
                        "Manifest validation",
                        LocalDate.of(2026, 8, 5));
        UUID guideId =
                UUID.fromString(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT g.id
                                FROM cancellation_guides g
                                JOIN recurring_commitments c
                                  ON c.merchant_id = g.merchant_id
                                WHERE c.id = ?
                                """,
                                String.class,
                                commitment.id()));

        installPublishedGuideV2(guideId);
        try {
            jdbcTemplate.update(
                    """
                    DELETE FROM cancellation_published_target_locks
                    WHERE guide_id = ?
                      AND guide_version = 2
                      AND track = 'PAYMENT_MANDATE'
                      AND sequence_number = 2
                    """,
                    guideId);
            jdbcTemplate.update(
                    """
                    DELETE FROM cancellation_published_step_locks
                    WHERE guide_id = ?
                      AND guide_version = 2
                      AND track = 'PAYMENT_MANDATE'
                      AND sequence_number = 2
                    """,
                    guideId);
            jdbcTemplate.update(
                    """
                    DELETE FROM cancellation_guide_steps
                    WHERE guide_id = ?
                      AND guide_version = 2
                      AND track = 'PAYMENT_MANDATE'
                      AND sequence_number = 2
                    """,
                    guideId);

            mockMvc.perform(
                            get(
                                            "/v1/commitments/{commitmentId}/cancellation-guide",
                                            commitment.id())
                                    .with(owner))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.detail").value("An unexpected error occurred."));
        } finally {
            removePublishedGuideV2(guideId);
        }
    }

    @Test
    void newerPublishedGuideDoesNotRewriteAnExistingAttemptPinnedToV1()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m4-pinning-" + suffix,
                        "m4-pinning-" + suffix + "@example.test",
                        "Pinning");
        UUID householdId = createHousehold(owner, "Pinning household");
        CreatedCommitment commitment =
                createCommitment(
                        owner,
                        householdId,
                        "Pinned guide",
                        LocalDate.of(2026, 8, 5));
        AttemptFixture fixture =
                startAttempt(owner, commitment, "pinning-v1-attempt-key");
        String v1Instruction =
                "Review the fictional service terms and confirm what access or benefits would end. Do not enter credentials in AutoPay Guard.";
        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.guideVersion").value(1))
                .andExpect(jsonPath("$.guide.version").value(1))
                .andExpect(
                                jsonPath(
                                                "$.guide.tracks[0].steps[0].instruction")
                                        .value(v1Instruction));

        installPublishedGuideV2(fixture.guideId());
        try {
            mockMvc.perform(
                            get(
                                            "/v1/commitments/{commitmentId}/cancellation-guide",
                                            commitment.id())
                                    .with(owner))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.version").value(2))
                    .andExpect(
                                    jsonPath("$.riskNotice")
                                            .value(
                                                    "V2 fictional guidance with a distinct immutable snapshot."))
                    .andExpect(
                                    jsonPath(
                                                    "$.tracks[0].steps[0].instruction")
                                            .value(
                                                    "V2: " + v1Instruction));

            mockMvc.perform(
                            get(
                                            "/v1/cancellation-attempts/{attemptId}",
                                            fixture.attemptId())
                                    .with(owner))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.guideId").value(fixture.guideId().toString()))
                    .andExpect(jsonPath("$.guideVersion").value(1))
                    .andExpect(jsonPath("$.guide.version").value(1))
                    .andExpect(
                                    jsonPath(
                                                    "$.guide.tracks[0].steps[0].instruction")
                                            .value(v1Instruction))
                    .andExpect(jsonPath("$.guide.targetsSuppressed").value(false));

            mockMvc.perform(
                            post(
                                            "/v1/cancellation-guides/{guideId}/feedback",
                                            fixture.guideId())
                                    .with(owner)
                                    .header(
                                            "Idempotency-Key",
                                            "pinning-v1-unsafe-key1")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {
                                              "commitmentId": "%s",
                                              "guideVersion": 1,
                                              "outcome": "UNSAFE_LINK",
                                              "note": null
                                            }
                                            """
                                                    .formatted(commitment.id())))
                    .andExpect(status().isNoContent());
            mockMvc.perform(
                            get(
                                            "/v1/cancellation-attempts/{attemptId}",
                                            fixture.attemptId())
                                    .with(owner))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.guide.version").value(1))
                    .andExpect(
                                    jsonPath(
                                                    "$.guide.tracks[0].steps[0].instruction")
                                            .value(v1Instruction))
                    .andExpect(jsonPath("$.guide.targetsSuppressed").value(true))
                    .andExpect(
                                    jsonPath("$.guide.tracks[0].steps[1].target")
                                            .isEmpty());
        } finally {
            removePublishedGuideV2(fixture.guideId());
        }
    }

    @Test
    void recurrenceReplacementDoesNotCarryAnOldOccurrenceDecisionForward()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m4-recurrence-" + suffix,
                        "m4-recurrence-" + suffix + "@example.test",
                        "Recurrence");
        UUID householdId = createHousehold(owner, "Recurrence household");
        CreatedCommitment commitment =
                createCommitment(
                        owner,
                        householdId,
                        "Before replacement",
                        LocalDate.of(2026, 8, 5));
        Occurrence oldOccurrence = firstOccurrence(commitment.id());
        MvcResult decision =
                mockMvc.perform(
                                post(
                                                "/v1/occurrences/{occurrenceId}/decisions",
                                                oldOccurrence.id())
                                        .with(owner)
                                        .header(
                                                "Idempotency-Key",
                                                "replacement-decision-001")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"decision\":\"CANCEL_WITH_PROVIDER\"}"))
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID oldDecisionId = UUID.fromString(read(decision, "$.id"));

        Map<String, Object> update =
                commitmentBody(
                        householdId,
                        "After replacement",
                        LocalDate.of(2026, 8, 5));
        update.remove("householdId");
        update.put("status", "ACTIVE");
        mockMvc.perform(
                        patch("/v1/commitments/{commitmentId}", commitment.id())
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"1\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(update)))
                .andExpect(status().isOk());
        Occurrence newOccurrence = firstOccurrence(commitment.id());
        assertThat(newOccurrence.id()).isNotEqualTo(oldOccurrence.id());
        assertThat(newOccurrence.date()).isEqualTo(oldOccurrence.date());

        mockMvc.perform(
                        get("/v1/decisions/inbox")
                                .with(owner)
                                .param("householdId", householdId.toString())
                                .param("from", "2026-08-01")
                                .param("to", "2026-08-31"))
                .andExpect(status().isOk())
                .andExpect(
                                jsonPath("$.items[0].occurrenceId")
                                        .value(newOccurrence.id().toString()))
                .andExpect(jsonPath("$.items[0].currentDecision").isEmpty());

        MvcResult guide =
                mockMvc.perform(
                                get(
                                                "/v1/commitments/{commitmentId}/cancellation-guide",
                                                commitment.id())
                                        .with(owner))
                        .andExpect(status().isOk())
                        .andReturn();
        Map<String, Object> attempt =
                attemptRequest(
                        newOccurrence.id(),
                        oldDecisionId,
                        UUID.fromString(read(guide, "$.id")),
                        JsonPath.read(
                                guide.getResponse().getContentAsString(),
                                "$.version"),
                        null);
        mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitment.id())
                                .with(owner)
                                .header(
                                        "Idempotency-Key",
                                        "replacement-attempt-key1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsBytes(attempt)))
                .andExpect(status().isNotFound());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM occurrence_decisions WHERE id = ?",
                                Integer.class,
                                oldDecisionId))
                .isOne();
    }

    @Test
    void concurrentSameKeyAttemptCreationReturnsOneStableResourceWithout500()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        JwtRequestPostProcessor owner =
                identity(
                        "m4-concurrent-" + suffix,
                        "m4-concurrent-" + suffix + "@example.test",
                        "Concurrent");
        UUID householdId = createHousehold(owner, "Concurrent household");
        CreatedCommitment commitment =
                createCommitment(
                        owner,
                        householdId,
                        "Concurrent attempt",
                        LocalDate.of(2026, 8, 5));
        Occurrence occurrence = firstOccurrence(commitment.id());
        MvcResult decision =
                mockMvc.perform(
                                post(
                                                "/v1/occurrences/{occurrenceId}/decisions",
                                                occurrence.id())
                                        .with(owner)
                                        .header(
                                                "Idempotency-Key",
                                                "concurrent-decision-001")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"decision\":\"CANCEL_WITH_PROVIDER\"}"))
                        .andExpect(status().isCreated())
                        .andReturn();
        MvcResult guide =
                mockMvc.perform(
                                get(
                                                "/v1/commitments/{commitmentId}/cancellation-guide",
                                                commitment.id())
                                        .with(owner))
                        .andExpect(status().isOk())
                        .andReturn();
        byte[] body =
                objectMapper.writeValueAsBytes(
                        attemptRequest(
                                occurrence.id(),
                                UUID.fromString(read(decision, "$.id")),
                                UUID.fromString(read(guide, "$.id")),
                                JsonPath.read(
                                        guide.getResponse().getContentAsString(),
                                        "$.version"),
                                null));

        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<MvcResult> first =
                    executor.submit(
                            () ->
                                    createAttemptConcurrently(
                                            start,
                                            suffix,
                                            commitment.id(),
                                            body));
            Future<MvcResult> second =
                    executor.submit(
                            () ->
                                    createAttemptConcurrently(
                                            start,
                                            suffix,
                                            commitment.id(),
                                            body));
            start.countDown();
            MvcResult firstResult = first.get();
            MvcResult secondResult = second.get();

            assertThat(firstResult.getResponse().getStatus()).isEqualTo(201);
            assertThat(secondResult.getResponse().getStatus()).isEqualTo(201);
            assertThat(read(firstResult, "$.id")).isEqualTo(read(secondResult, "$.id"));
            assertThat(firstResult.getResponse().getHeader(HttpHeaders.ETAG))
                    .isEqualTo("\"0\"");
            assertThat(secondResult.getResponse().getHeader(HttpHeaders.ETAG))
                    .isEqualTo("\"0\"");
        }
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*)
                                FROM cancellation_attempts
                                WHERE commitment_id = ?
                                """,
                                Integer.class,
                                commitment.id()))
                .isOne();
    }

    @Test
    void abandonmentAndArchiveRaceNeverArchivesAnUnresolvedAttempt()
            throws Exception {
        String suffix = UUID.randomUUID().toString();
        String subject = "m4-archive-race-" + suffix;
        JwtRequestPostProcessor owner =
                identity(subject, subject + "@example.test", "Archive race");
        UUID householdId = createHousehold(owner, "Archive race household");
        CreatedCommitment commitment =
                createCommitment(
                        owner,
                        householdId,
                        "Archive race",
                        LocalDate.of(2026, 8, 5));
        AttemptFixture fixture =
                startAttempt(owner, commitment, "archive-race-start-key");

        CountDownLatch start = new CountDownLatch(1);
        int archiveStatus;
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<MvcResult> abandon =
                    executor.submit(
                            () -> {
                                start.await();
                                return mockMvc.perform(
                                                patch(
                                                                "/v1/cancellation-attempts/{attemptId}",
                                                                fixture.attemptId())
                                                        .with(
                                                                identity(
                                                                        subject,
                                                                        subject
                                                                                + "@example.test",
                                                                        "Archive race"))
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"0\"")
                                                        .contentType(
                                                                MediaType
                                                                        .APPLICATION_JSON)
                                                        .content(
                                                                """
                                                                {
                                                                  "serviceStatus": "NOT_STARTED",
                                                                  "paymentMandateStatus": "NOT_STARTED",
                                                                  "abandoned": true
                                                                }
                                                                """))
                                        .andReturn();
                            });
            Future<MvcResult> archive =
                    executor.submit(
                            () -> {
                                start.await();
                                return mockMvc.perform(
                                                delete(
                                                                "/v1/commitments/{commitmentId}",
                                                                commitment.id())
                                                        .with(
                                                                identity(
                                                                        subject,
                                                                        subject
                                                                                + "@example.test",
                                                                        "Archive race"))
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"1\""))
                                        .andReturn();
                            });
            start.countDown();
            assertThat(abandon.get().getResponse().getStatus()).isEqualTo(200);
            archiveStatus = archive.get().getResponse().getStatus();
            assertThat(archiveStatus).isIn(204, 409);
        }

        mockMvc.perform(
                        get(
                                        "/v1/cancellation-attempts/{attemptId}",
                                        fixture.attemptId())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.abandoned").value(true));
        if (archiveStatus == 409) {
            mockMvc.perform(
                            delete(
                                            "/v1/commitments/{commitmentId}",
                                            commitment.id())
                                    .with(owner)
                                    .header(HttpHeaders.IF_MATCH, "\"1\""))
                    .andExpect(status().isNoContent());
        }
        mockMvc.perform(
                        get("/v1/commitments/{commitmentId}", commitment.id())
                                .with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARCHIVED"));
    }

    private void assertForeignAttemptSurfaceIsUniform404(
            JwtRequestPostProcessor foreign,
            UUID householdId,
            UUID commitmentId,
            UUID attemptId,
            UUID guideId,
            int guideVersion)
            throws Exception {
        mockMvc.perform(
                        get("/v1/cancellation-attempts/{attemptId}", attemptId)
                                .with(foreign))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitmentId)
                                .with(foreign)
                                .param("householdId", householdId.toString()))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/v1/savings")
                                .with(foreign)
                                .param("householdId", householdId.toString()))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        patch("/v1/cancellation-attempts/{attemptId}", attemptId)
                                .with(foreign)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "serviceStatus": "REQUESTED",
                                          "paymentMandateStatus": "NOT_STARTED",
                                          "abandoned": false
                                        }
                                        """))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-attempts/{attemptId}/verify",
                                        attemptId)
                                .with(foreign)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "foreign-verify-key-0001")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"DISPUTED\"}"))
                .andExpect(status().isNotFound());
        String feedback =
                """
                {
                  "commitmentId": "%s",
                  "guideVersion": %d,
                  "outcome": "WORKED",
                  "note": null
                }
                """
                        .formatted(commitmentId, guideVersion);
        mockMvc.perform(
                        post(
                                        "/v1/cancellation-guides/{guideId}/feedback",
                                        guideId)
                                .with(foreign)
                                .header(
                                        "Idempotency-Key",
                                        "foreign-feedback-key-01")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(feedback))
                .andExpect(status().isNotFound());
    }

    private MvcResult createAttemptConcurrently(
            CountDownLatch start,
            String suffix,
            UUID commitmentId,
            byte[] body)
            throws Exception {
        start.await();
        return mockMvc.perform(
                        post(
                                        "/v1/commitments/{commitmentId}/cancellation-attempts",
                                        commitmentId)
                                .with(
                                        identity(
                                                "m4-concurrent-" + suffix,
                                                "m4-concurrent-"
                                                        + suffix
                                                        + "@example.test",
                                                "Concurrent"))
                                .header(
                                        "Idempotency-Key",
                                        "concurrent-attempt-key1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andReturn();
    }

    private AttemptFixture startAttempt(
            JwtRequestPostProcessor identity,
            CreatedCommitment commitment,
            String keyStem)
            throws Exception {
        PreparedCancellation prepared =
                prepareCancellation(identity, commitment, keyStem);
        MvcResult result =
                mockMvc.perform(
                                post(
                                                "/v1/commitments/{commitmentId}/cancellation-attempts",
                                                commitment.id())
                                        .with(identity)
                                        .header(
                                                "Idempotency-Key",
                                                keyStem + "-attempt-key")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                objectMapper.writeValueAsBytes(
                                                        attemptRequest(
                                                                prepared
                                                                        .occurrence()
                                                                        .id(),
                                                                prepared
                                                                        .decisionId(),
                                                                prepared.guideId(),
                                                                prepared
                                                                        .guideVersion(),
                                                                null))))
                        .andExpect(status().isCreated())
                        .andReturn();
        return new AttemptFixture(
                commitment,
                prepared.occurrence(),
                prepared.decisionId(),
                prepared.guideId(),
                prepared.guideVersion(),
                UUID.fromString(read(result, "$.id")));
    }

    private PreparedCancellation prepareCancellation(
            JwtRequestPostProcessor identity,
            CreatedCommitment commitment,
            String keyStem)
            throws Exception {
        Occurrence occurrence = firstOccurrence(commitment.id());
        MvcResult decision =
                mockMvc.perform(
                                post(
                                                "/v1/occurrences/{occurrenceId}/decisions",
                                                occurrence.id())
                                        .with(identity)
                                        .header(
                                                "Idempotency-Key",
                                                keyStem + "-decision-key")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"decision\":\"CANCEL_WITH_PROVIDER\"}"))
                        .andExpect(status().isCreated())
                        .andReturn();
        MvcResult guide =
                mockMvc.perform(
                                get(
                                                "/v1/commitments/{commitmentId}/cancellation-guide",
                                                commitment.id())
                                        .with(identity))
                        .andExpect(status().isOk())
                        .andReturn();
        return new PreparedCancellation(
                occurrence,
                UUID.fromString(read(decision, "$.id")),
                UUID.fromString(read(guide, "$.id")),
                JsonPath.read(
                        guide.getResponse().getContentAsString(),
                        "$.version"));
    }

    private UUID createHousehold(
            JwtRequestPostProcessor identity, String name) throws Exception {
        String body =
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
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andReturn();
        return UUID.fromString(read(result, "$.id"));
    }

    private CreatedCommitment createCommitment(
            JwtRequestPostProcessor identity,
            UUID householdId,
            String displayName,
            LocalDate anchor)
            throws Exception {
        return createCommitment(
                identity,
                householdId,
                displayName,
                anchor,
                "CARD_RECURRING",
                499L,
                null,
                "INR",
                false);
    }

    private CreatedCommitment createCommitment(
            JwtRequestPostProcessor identity,
            UUID householdId,
            String displayName,
            LocalDate anchor,
            String paymentRail,
            Long amountMinor,
            Long estimatedAmountMinor,
            String currency,
            boolean variableAmount)
            throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/v1/commitments")
                                        .with(identity)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                objectMapper.writeValueAsBytes(
                                                        commitmentBody(
                                                                householdId,
                                                                displayName,
                                                                anchor,
                                                                paymentRail,
                                                                amountMinor,
                                                                estimatedAmountMinor,
                                                                currency,
                                                                variableAmount))))
                        .andExpect(status().isCreated())
                        .andExpect(header().string(HttpHeaders.ETAG, "\"1\""))
                        .andReturn();
        return new CreatedCommitment(
                UUID.fromString(read(result, "$.id")),
                result.getResponse().getHeader(HttpHeaders.ETAG));
    }

    private static Map<String, Object> commitmentBody(
            UUID householdId, String displayName, LocalDate anchor) {
        return commitmentBody(
                householdId,
                displayName,
                anchor,
                "CARD_RECURRING",
                499L,
                null,
                "INR",
                false);
    }

    private static Map<String, Object> commitmentBody(
            UUID householdId,
            String displayName,
            LocalDate anchor,
            String paymentRail,
            Long amountMinor,
            Long estimatedAmountMinor,
            String currency,
            boolean variableAmount) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("householdId", householdId);
        body.put("merchantId", STREAMBOX);
        body.put("displayName", displayName);
        body.put("category", "SUBSCRIPTION");
        body.put("paymentRail", paymentRail);
        body.put("amountMinor", amountMinor);
        body.put("estimatedAmountMinor", estimatedAmountMinor);
        body.put("currency", currency);
        body.put("frequency", "MONTHLY");
        body.put("intervalCount", 1);
        body.put("customIntervalUnit", null);
        body.put("anchorDate", anchor);
        body.put("monthDayPolicy", "ANCHOR_DAY");
        body.put("variableAmount", variableAmount);
        body.put("maskedPaymentLabel", null);
        return body;
    }

    private static Map<String, Object> attemptRequest(
            UUID occurrenceId,
            UUID decisionId,
            UUID guideId,
            int guideVersion,
            String note) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("occurrenceId", occurrenceId);
        body.put("decisionId", decisionId);
        body.put("guideId", guideId);
        body.put("guideVersion", guideVersion);
        body.put("note", note);
        return body;
    }

    private void installPublishedGuideV2(UUID guideId) {
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_versions (
                    guide_id, version, status, risk_notice,
                    structural_reviewed_at, review_interval_days,
                    published_at, created_at
                ) VALUES (
                    ?, 2, 'PUBLISHED',
                    'V2 fictional guidance with a distinct immutable snapshot.',
                    TIMESTAMP WITH TIME ZONE '2026-07-28 00:00:00+00:00',
                    60,
                    TIMESTAMP WITH TIME ZONE '2026-07-28 00:00:00+00:00',
                    TIMESTAMP WITH TIME ZONE '2026-07-28 00:00:00+00:00'
                )
                """,
                guideId);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_steps (
                    guide_id, guide_version, track, sequence_number,
                    action_type, title, instruction, target_key, target_uri
                )
                SELECT
                    guide_id, 2, track, sequence_number,
                    action_type, 'V2 ' || title, 'V2: ' || instruction,
                    target_key, target_uri
                FROM cancellation_guide_steps
                WHERE guide_id = ? AND guide_version = 1
                """,
                guideId);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_published_version_locks (
                    guide_id, version, status, risk_notice,
                    structural_reviewed_at, review_interval_days,
                    published_at, created_at
                )
                SELECT
                    guide_id, version, status, risk_notice,
                    structural_reviewed_at, review_interval_days,
                    published_at, created_at
                FROM cancellation_guide_versions
                WHERE guide_id = ? AND version = 2
                """,
                guideId);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_published_step_locks (
                    guide_id, guide_version, track, sequence_number,
                    action_type, title, instruction
                )
                SELECT
                    guide_id, guide_version, track, sequence_number,
                    action_type, title, instruction
                FROM cancellation_guide_steps
                WHERE guide_id = ? AND guide_version = 2
                """,
                guideId);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_published_target_locks (
                    guide_id, guide_version, track, sequence_number,
                    action_type, title, instruction, target_key, target_uri
                )
                SELECT
                    guide_id, guide_version, track, sequence_number,
                    action_type, title, instruction, target_key, target_uri
                FROM cancellation_guide_steps
                WHERE guide_id = ?
                  AND guide_version = 2
                  AND target_key IS NOT NULL
                """,
                guideId);
        jdbcTemplate.update(
                """
                UPDATE cancellation_guide_catalog_state
                SET current_published_version = 2,
                    optimistic_version = optimistic_version + 1,
                    updated_at = TIMESTAMP WITH TIME ZONE '2026-07-28 00:00:00+00:00'
                WHERE guide_id = ?
                """,
                guideId);
    }

    private void removePublishedGuideV2(UUID guideId) {
        jdbcTemplate.update(
                """
                UPDATE cancellation_guide_catalog_state
                SET current_published_version = 1,
                    optimistic_version = optimistic_version + 1,
                    updated_at = TIMESTAMP WITH TIME ZONE '2026-07-27 00:00:00+00:00'
                WHERE guide_id = ?
                """,
                guideId);
        jdbcTemplate.update(
                """
                DELETE FROM cancellation_published_target_locks
                WHERE guide_id = ? AND guide_version = 2
                """,
                guideId);
        jdbcTemplate.update(
                """
                DELETE FROM cancellation_published_step_locks
                WHERE guide_id = ? AND guide_version = 2
                """,
                guideId);
        jdbcTemplate.update(
                """
                DELETE FROM cancellation_guide_steps
                WHERE guide_id = ? AND guide_version = 2
                """,
                guideId);
        jdbcTemplate.update(
                """
                DELETE FROM cancellation_published_version_locks
                WHERE guide_id = ? AND version = 2
                """,
                guideId);
        jdbcTemplate.update(
                """
                DELETE FROM cancellation_guide_versions
                WHERE guide_id = ? AND version = 2
                """,
                guideId);
    }

    private Occurrence firstOccurrence(UUID commitmentId) {
        return jdbcTemplate.queryForObject(
                """
                SELECT id, scheduled_date
                FROM commitment_occurrences
                WHERE commitment_id = ?
                ORDER BY scheduled_date, id
                FETCH FIRST 1 ROW ONLY
                """,
                (row, ignored) ->
                        new Occurrence(
                                row.getObject("id", UUID.class),
                                row.getObject("scheduled_date", LocalDate.class)),
                commitmentId);
    }

    private static String read(MvcResult result, String path) throws Exception {
        return JsonPath.read(result.getResponse().getContentAsString(), path);
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

    private record CreatedCommitment(UUID id, String etag) {}

    private record Occurrence(UUID id, LocalDate date) {}

    private record PreparedCancellation(
            Occurrence occurrence,
            UUID decisionId,
            UUID guideId,
            int guideVersion) {}

    private record AttemptFixture(
            CreatedCommitment commitment,
            Occurrence occurrence,
            UUID decisionId,
            UUID guideId,
            int guideVersion,
            UUID attemptId) {}

    @TestConfiguration(proxyBeanMethods = false)
    static class ClockConfiguration {

        @Bean
        @Primary
        MutableClock m4MutableClock() {
            return new MutableClock(BASE_TIME, ZoneOffset.UTC);
        }
    }

    static final class MutableClock extends Clock {

        private final AtomicReference<Instant> current;
        private final ZoneId zone;

        MutableClock(Instant initial, ZoneId zone) {
            this(new AtomicReference<>(initial), zone);
        }

        private MutableClock(AtomicReference<Instant> current, ZoneId zone) {
            this.current = current;
            this.zone = zone;
        }

        void set(Instant value) {
            current.set(value);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId requestedZone) {
            return new MutableClock(current, requestedZone);
        }

        @Override
        public Instant instant() {
            return current.get();
        }
    }
}
