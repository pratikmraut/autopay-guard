package in.autopayguard.api.support;

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
class SupportGrantExpiryService {

    private final JdbcTemplate jdbcTemplate;
    private final AuditService auditService;
    private final Clock clock;

    SupportGrantExpiryService(
            JdbcTemplate jdbcTemplate, AuditService auditService, Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void expireByCodeHash(String codeHash) {
        expireWhere("g.code_hash = ?", codeHash);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void expireById(UUID grantId) {
        expireWhere("g.id = ?", grantId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void expireForOwnerHousehold(UUID ownerUserId, UUID householdId) {
        expireWhere(
                "g.owner_user_id = ? AND g.household_id = ?",
                ownerUserId,
                householdId);
    }

    @Scheduled(fixedDelay = 60_000L)
    @Transactional
    public void expireDueGrants() {
        expireWhere("TRUE");
    }

    private void expireWhere(String predicate, Object... predicateArguments) {
        Instant now = clock.instant();
        List<Object> arguments = new ArrayList<>(List.of(predicateArguments));
        arguments.add(now);
        List<DueGrant> due =
                jdbcTemplate.query(
                        """
                        SELECT g.id, g.owner_user_id
                        FROM support_diagnostic_grants g
                        WHERE g.status = 'ACTIVE'
                          AND
                        """
                                + predicate
                                + """
                                  AND g.expires_at <= ?
                                ORDER BY g.id
                                FOR UPDATE
                                """,
                        (row, rowNumber) ->
                                new DueGrant(
                                        row.getObject("id", UUID.class),
                                        row.getObject(
                                                "owner_user_id", UUID.class)),
                        arguments.toArray());
        for (DueGrant grant : due) {
            int updated =
                    jdbcTemplate.update(
                            """
                            UPDATE support_diagnostic_grants
                            SET status = 'EXPIRED', active_key = NULL,
                                optimistic_version = optimistic_version + 1,
                                updated_at = ?
                            WHERE id = ? AND status = 'ACTIVE'
                              AND expires_at <= ?
                            """,
                            now,
                            grant.id(),
                            now);
            if (updated == 1) {
                auditService.record(
                        grant.ownerUserId(),
                        ActorRole.USER,
                        Action.SUPPORT_GRANT_EXPIRED,
                        ResourceType.SUPPORT_GRANT,
                        grant.id());
            }
        }
    }

    private record DueGrant(UUID id, UUID ownerUserId) {}
}
