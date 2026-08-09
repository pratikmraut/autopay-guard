package in.autopayguard.api.household;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
class HouseholdInvitationExpiryService {

    private final JdbcTemplate jdbcTemplate;
    private final AuditService auditService;
    private final Clock clock;

    HouseholdInvitationExpiryService(
            JdbcTemplate jdbcTemplate, AuditService auditService, Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void expireByTokenHash(String tokenHash) {
        expireWhere("i.token_hash = ?", tokenHash);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void expireById(UUID invitationId) {
        expireWhere("i.id = ?", invitationId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void expireForTarget(UUID householdId, String inviteeEmail) {
        expireWhere(
                "i.household_id = ? AND i.invitee_email = ?",
                householdId,
                inviteeEmail);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void expireForHousehold(UUID householdId) {
        expireWhere("i.household_id = ?", householdId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void expireForInvitee(String inviteeEmail) {
        expireWhere("i.invitee_email = ?", inviteeEmail);
    }

    @Scheduled(fixedDelay = 60_000L)
    @Transactional
    public void expireDueInvitations() {
        expireWhere("TRUE");
    }

    private void expireWhere(String predicate, Object... predicateArguments) {
        Instant now = clock.instant();
        List<Object> arguments = new ArrayList<>(List.of(predicateArguments));
        arguments.add(now);
        List<DueInvitation> due =
                jdbcTemplate.query(
                        """
                        SELECT i.id, h.owner_user_id
                        FROM household_invitations i
                        JOIN households h ON h.id = i.household_id
                        WHERE i.status = 'PENDING'
                          AND
                        """
                                + predicate
                                + """
                                  AND i.expires_at <= ?
                                ORDER BY i.id
                                FOR UPDATE
                                """,
                        (row, rowNumber) ->
                                new DueInvitation(
                                        row.getObject("id", UUID.class),
                                        row.getObject(
                                                "owner_user_id", UUID.class)),
                        arguments.toArray());
        for (DueInvitation invitation : due) {
            int updated =
                    jdbcTemplate.update(
                            """
                            UPDATE household_invitations
                            SET status = 'EXPIRED', pending_key = NULL,
                                optimistic_version = optimistic_version + 1,
                                updated_at = ?
                            WHERE id = ? AND status = 'PENDING'
                              AND expires_at <= ?
                            """,
                            now,
                            invitation.id(),
                            now);
            if (updated == 1) {
                auditService.record(
                        invitation.ownerUserId(),
                        ActorRole.USER,
                        Action.HOUSEHOLD_INVITATION_EXPIRED,
                        ResourceType.HOUSEHOLD_INVITATION,
                        invitation.id());
            }
        }
    }

    private record DueInvitation(UUID id, UUID ownerUserId) {}
}
