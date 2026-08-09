package in.autopayguard.api.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.autopayguard.api.common.rate.OperationRateLimiter;
import in.autopayguard.api.common.security.OpaqueCodes;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(SupportGrantExpiryServiceTest.FixedClockConfiguration.class)
class SupportGrantExpiryServiceTest {

    private static final String SUPPORT_CODE = "A".repeat(43);
    private static final Instant TEST_NOW =
            Instant.parse("2026-07-28T05:00:00Z");

    @Autowired private SupportGrantExpiryService expiryService;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private MockMvc mockMvc;

    @Test
    void exactExpiryBoundaryPersistsTerminalStateAuditAndSafeNotFound()
            throws Exception {
        UUID ownerId = UUID.randomUUID();
        UUID householdId = UUID.randomUUID();
        UUID grantId = UUID.randomUUID();
        Instant expiresAt = TEST_NOW;
        Instant createdAt = expiresAt.minus(15, ChronoUnit.MINUTES);

        try {
            jdbcTemplate.update(
                    """
                    INSERT INTO users (
                        id, oidc_subject, email, display_name, timezone, locale,
                        age_confirmed_at, privacy_notice_accepted_at,
                        privacy_notice_version, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'Asia/Kolkata', 'en-IN',
                              NULL, NULL, NULL, ?, ?)
                    """,
                    ownerId,
                    "support-expiry-owner-" + ownerId,
                    "support-expiry-owner-" + ownerId + "@example.test",
                    "Support Expiry Owner",
                    createdAt,
                    createdAt);
            jdbcTemplate.update(
                    """
                    INSERT INTO households (
                        id, name, owner_user_id, default_currency, timezone,
                        created_at, updated_at
                    ) VALUES (?, 'Support expiry household', ?, 'INR',
                              'Asia/Kolkata', ?, ?)
                    """,
                    householdId,
                    ownerId,
                    createdAt,
                    createdAt);
            jdbcTemplate.update(
                    """
                    INSERT INTO household_members (
                        id, household_id, user_id, role, status,
                        optimistic_version, joined_at, removed_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, 'OWNER', 'ACTIVE', 0, ?, NULL, ?, ?)
                    """,
                    UUID.randomUUID(),
                    householdId,
                    ownerId,
                    createdAt,
                    createdAt,
                    createdAt);
            jdbcTemplate.update(
                    """
                    INSERT INTO support_diagnostic_grants (
                        id, owner_user_id, household_id, code_hash, active_key,
                        status, optimistic_version, expires_at, revoked_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0, ?, NULL, ?, ?)
                    """,
                    grantId,
                    ownerId,
                    householdId,
                    OpaqueCodes.sha256(SUPPORT_CODE),
                    householdId.toString(),
                    expiresAt,
                    createdAt,
                    createdAt);

            expiryService.expireById(grantId);

            Map<String, Object> grant =
                    jdbcTemplate.queryForMap(
                            """
                            SELECT status, active_key, optimistic_version
                            FROM support_diagnostic_grants
                            WHERE id = ?
                            """,
                            grantId);
            assertThat(grant.get("status")).isEqualTo("EXPIRED");
            assertThat(grant.get("active_key")).isNull();
            assertThat(((Number) grant.get("optimistic_version")).longValue())
                    .isEqualTo(1L);
            assertThat(auditCount(grantId)).isEqualTo(1);

            mockMvc.perform(
                            post("/v1/support/diagnostics/resolve")
                                    .with(
                                            jwt()
                                                    .jwt(
                                                            token ->
                                                                    token.subject(
                                                                                    "support-expiry-reader")
                                                                            .claim(
                                                                                    "email",
                                                                                    "support-expiry-reader@example.test")
                                                                            .claim(
                                                                                    "name",
                                                                                    "Support Expiry Reader"))
                                                    .authorities(
                                                            new SimpleGrantedAuthority(
                                                                    "ROLE_SUPPORT_READ")))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {
                                              "supportCode": "%s"
                                            }
                                            """
                                                    .formatted(SUPPORT_CODE)))
                    .andExpect(status().isNotFound());

            assertThat(auditCount(grantId)).isEqualTo(1);
        } finally {
            jdbcTemplate.update(
                    "DELETE FROM audit_event_locks WHERE resource_id = ?",
                    grantId);
            jdbcTemplate.update(
                    "DELETE FROM audit_events WHERE resource_id = ?",
                    grantId);
            jdbcTemplate.update(
                    "DELETE FROM support_diagnostic_grants WHERE id = ?",
                    grantId);
            jdbcTemplate.update(
                    "DELETE FROM household_members WHERE household_id = ?",
                    householdId);
            jdbcTemplate.update("DELETE FROM households WHERE id = ?", householdId);
            jdbcTemplate.update("DELETE FROM users WHERE id = ?", ownerId);
            jdbcTemplate.update(
                    """
                    DELETE FROM users
                    WHERE oidc_subject = 'support-expiry-reader'
                    """);
            jdbcTemplate.update(
                    "DELETE FROM operation_rate_events WHERE actor_key = ?",
                    OperationRateLimiter.actorKeyForSubject(
                            "support-expiry-reader"));
        }
    }

    @Test
    void repeatedInvalidCodesPersistAttemptsAndReachRateLimit()
            throws Exception {
        String subject = "support-invalid-code-reader";
        String actorKey = OperationRateLimiter.actorKeyForSubject(subject);
        try {
            for (int index = 0; index < 20; index++) {
                mockMvc.perform(
                                post("/v1/support/diagnostics/resolve")
                                        .with(
                                                jwt()
                                                        .jwt(
                                                                token ->
                                                                        token.subject(subject)
                                                                                .claim(
                                                                                        "email",
                                                                                        "support-invalid-code-reader@example.test")
                                                                                .claim(
                                                                                        "name",
                                                                                        "Invalid Code Reader"))
                                                        .authorities(
                                                                new SimpleGrantedAuthority(
                                                                        "ROLE_SUPPORT_READ")))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "supportCode": "%s"
                                                }
                                                """
                                                        .formatted(
                                                                "B".repeat(
                                                                        43))))
                        .andExpect(status().isNotFound());
            }

            mockMvc.perform(
                            post("/v1/support/diagnostics/resolve")
                                    .with(
                                            jwt()
                                                    .jwt(
                                                            token ->
                                                                    token.subject(subject)
                                                                            .claim(
                                                                                    "email",
                                                                                    "support-invalid-code-reader@example.test")
                                                                            .claim(
                                                                                    "name",
                                                                                    "Invalid Code Reader"))
                                                    .authorities(
                                                            new SimpleGrantedAuthority(
                                                                    "ROLE_SUPPORT_READ")))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {
                                              "supportCode": "%s"
                                            }
                                            """
                                                    .formatted(
                                                            "B".repeat(43))))
                    .andExpect(status().isTooManyRequests());
            assertThat(
                            jdbcTemplate.queryForObject(
                                    """
                                    SELECT COUNT(*) FROM operation_rate_events
                                    WHERE actor_key = ?
                                      AND operation = 'SUPPORT_DIAGNOSTIC'
                                    """,
                                    Integer.class,
                                    actorKey))
                    .isEqualTo(20);
        } finally {
            jdbcTemplate.update(
                    "DELETE FROM operation_rate_events WHERE actor_key = ?",
                    actorKey);
            jdbcTemplate.update(
                    "DELETE FROM users WHERE oidc_subject = ?",
                    subject);
        }
    }

    private int auditCount(UUID grantId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM audit_events
                        WHERE resource_id = ?
                          AND action = 'SUPPORT_GRANT_EXPIRED'
                          AND outcome = 'SUCCEEDED'
                        """,
                        Integer.class,
                        grantId);
        return count == null ? 0 : count;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedClockConfiguration {

        @Bean
        @Primary
        Clock supportGrantExpiryTestClock() {
            return Clock.fixed(TEST_NOW, ZoneOffset.UTC);
        }
    }
}
