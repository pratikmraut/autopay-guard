package in.autopayguard.api.household;

import static org.assertj.core.api.Assertions.assertThat;

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
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
@Import(HouseholdInvitationExpiryServiceTest.FixedClockConfiguration.class)
class HouseholdInvitationExpiryServiceTest {

    private static final Instant TEST_NOW =
            Instant.parse("2026-07-28T05:00:00Z");

    @Autowired private HouseholdInvitationExpiryService expiryService;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void exactExpiryBoundaryPersistsTerminalStateAndOneAuditEvent() {
        UUID ownerId = UUID.randomUUID();
        UUID householdId = UUID.randomUUID();
        UUID invitationId = UUID.randomUUID();
        Instant expiresAt = TEST_NOW;
        Instant createdAt = expiresAt.minus(1, ChronoUnit.DAYS);

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
                    "expiry-owner-" + ownerId,
                    "expiry-owner-" + ownerId + "@example.test",
                    "Expiry Owner",
                    createdAt,
                    createdAt);
            jdbcTemplate.update(
                    """
                    INSERT INTO households (
                        id, name, owner_user_id, default_currency, timezone,
                        created_at, updated_at
                    ) VALUES (?, 'Expiry household', ?, 'INR',
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
                    INSERT INTO household_invitations (
                        id, household_id, invitee_email, role, token_hash,
                        pending_key, status, accepted_by_user_id,
                        optimistic_version, expires_at, accepted_at,
                        revoked_at, created_at, updated_at
                    ) VALUES (?, ?, ?, 'MEMBER', ?, ?, 'PENDING', NULL,
                              0, ?, NULL, NULL, ?, ?)
                    """,
                    invitationId,
                    householdId,
                    "expiry-invitee-" + invitationId + "@example.test",
                    "a".repeat(64),
                    householdId + ":expiry-invitee-" + invitationId,
                    expiresAt,
                    createdAt,
                    createdAt);

            expiryService.expireById(invitationId);

            Map<String, Object> invitation =
                    jdbcTemplate.queryForMap(
                            """
                            SELECT status, pending_key, optimistic_version
                            FROM household_invitations
                            WHERE id = ?
                            """,
                            invitationId);
            assertThat(invitation.get("status")).isEqualTo("EXPIRED");
            assertThat(invitation.get("pending_key")).isNull();
            assertThat(((Number) invitation.get("optimistic_version")).longValue())
                    .isEqualTo(1L);
            assertThat(auditCount(invitationId)).isEqualTo(1);

            expiryService.expireById(invitationId);
            assertThat(auditCount(invitationId)).isEqualTo(1);
        } finally {
            jdbcTemplate.update(
                    "DELETE FROM audit_event_locks WHERE resource_id = ?",
                    invitationId);
            jdbcTemplate.update(
                    "DELETE FROM audit_events WHERE resource_id = ?",
                    invitationId);
            jdbcTemplate.update(
                    "DELETE FROM household_invitations WHERE id = ?",
                    invitationId);
            jdbcTemplate.update(
                    "DELETE FROM household_members WHERE household_id = ?",
                    householdId);
            jdbcTemplate.update("DELETE FROM households WHERE id = ?", householdId);
            jdbcTemplate.update("DELETE FROM users WHERE id = ?", ownerId);
        }
    }

    private int auditCount(UUID invitationId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM audit_events
                        WHERE resource_id = ?
                          AND action = 'HOUSEHOLD_INVITATION_EXPIRED'
                          AND outcome = 'SUCCEEDED'
                        """,
                        Integer.class,
                        invitationId);
        return count == null ? 0 : count;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedClockConfiguration {

        @Bean
        @Primary
        Clock householdInvitationExpiryTestClock() {
            return Clock.fixed(TEST_NOW, ZoneOffset.UTC);
        }
    }
}
