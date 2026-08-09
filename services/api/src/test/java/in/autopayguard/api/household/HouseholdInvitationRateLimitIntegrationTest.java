package in.autopayguard.api.household;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HouseholdInvitationRateLimitIntegrationTest {

    private static final String SUBJECT = "invitation-invalid-code-subject";
    private static final String EMAIL =
            "invitation-invalid-code-subject@example.test";

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void repeatedInvalidInvitationCodesPersistAttemptsAndReachRateLimit()
            throws Exception {
        JwtRequestPostProcessor user = identity();
        String actorKey = OperationRateLimiter.actorKeyForSubject(SUBJECT);
        UUID userId = null;
        UUID householdId = null;
        try {
            MvcResult household =
                    mockMvc.perform(
                                    post("/v1/households")
                                            .with(user)
                                            .contentType(MediaType.APPLICATION_JSON)
                                            .content(
                                                    """
                                                    {
                                                      "name": "Invitation rate household",
                                                      "defaultCurrency": "INR",
                                                      "timezone": "Asia/Kolkata",
                                                      "ageConfirmed": true,
                                                      "privacyNoticeAccepted": true,
                                                      "privacyNoticeVersion": "foundation-v1"
                                                    }
                                                    """))
                            .andExpect(status().isCreated())
                            .andReturn();
            householdId =
                    UUID.fromString(
                            JsonPath.read(
                                    household.getResponse().getContentAsString(),
                                    "$.id"));
            userId =
                    jdbcTemplate.queryForObject(
                            "SELECT id FROM users WHERE oidc_subject = ?",
                            UUID.class,
                            SUBJECT);
            mockMvc.perform(
                            post("/v1/privacy/consents")
                                    .with(user)
                                    .header(
                                            "Idempotency-Key",
                                            "invitation-rate-consent")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {
                                              "purpose": "HOUSEHOLD_SHARING",
                                              "purposeVersion": "foundation-v1",
                                              "action": "GRANTED"
                                            }
                                            """))
                    .andExpect(status().isCreated());

            for (int index = 0; index < 20; index++) {
                mockMvc.perform(
                                post("/v1/household-invitations/accept")
                                        .with(user)
                                        .header(
                                                "Idempotency-Key",
                                                "invalid-invite-attempt-"
                                                        + index)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "invitationCode": "%s"
                                                }
                                                """
                                                        .formatted(
                                                                "C".repeat(
                                                                        43))))
                        .andExpect(status().isNotFound());
            }

            mockMvc.perform(
                            post("/v1/household-invitations/accept")
                                    .with(user)
                                    .header(
                                            "Idempotency-Key",
                                            "invalid-invite-attempt-20")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {
                                              "invitationCode": "%s"
                                            }
                                            """
                                                    .formatted(
                                                            "C".repeat(43))))
                    .andExpect(status().isTooManyRequests());
            assertThat(
                            jdbcTemplate.queryForObject(
                                    """
                                    SELECT COUNT(*) FROM operation_rate_events
                                    WHERE actor_key = ?
                                      AND operation = 'INVITATION_ACCEPT'
                                    """,
                                    Integer.class,
                                    actorKey))
                    .isEqualTo(20);
        } finally {
            jdbcTemplate.update(
                    "DELETE FROM operation_rate_events WHERE actor_key = ?",
                    actorKey);
            if (userId != null) {
                jdbcTemplate.update(
                        "DELETE FROM m5_idempotency_records WHERE actor_user_id = ?",
                        userId);
                jdbcTemplate.update(
                        "DELETE FROM audit_event_locks WHERE actor_user_id = ?",
                        userId);
                jdbcTemplate.update(
                        "DELETE FROM audit_events WHERE actor_user_id = ?",
                        userId);
                jdbcTemplate.update(
                        "DELETE FROM consent_event_locks WHERE user_id = ?",
                        userId);
                jdbcTemplate.update(
                        "DELETE FROM consent_events WHERE user_id = ?",
                        userId);
                jdbcTemplate.update(
                        """
                        DELETE FROM privacy_notice_acknowledgement_locks
                        WHERE user_id = ?
                        """,
                        userId);
                jdbcTemplate.update(
                        """
                        DELETE FROM privacy_notice_acknowledgements
                        WHERE user_id = ?
                        """,
                        userId);
            }
            if (householdId != null) {
                jdbcTemplate.update(
                        "DELETE FROM household_members WHERE household_id = ?",
                        householdId);
                jdbcTemplate.update(
                        "DELETE FROM households WHERE id = ?",
                        householdId);
            }
            if (userId != null) {
                jdbcTemplate.update("DELETE FROM users WHERE id = ?", userId);
            }
        }
    }

    private static JwtRequestPostProcessor identity() {
        return jwt()
                .jwt(
                        token ->
                                token.subject(SUBJECT)
                                        .claim("email", EMAIL)
                                        .claim(
                                                "name",
                                                "Invitation Invalid Code Subject"))
                .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }
}
