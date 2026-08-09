package in.autopayguard.api.support;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import in.autopayguard.api.common.security.OpaqueCodes;
import in.autopayguard.api.household.HouseholdMembershipService;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SupportDiagnosticsService {

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final HouseholdMembershipService membershipService;
    private final OperationRateLimiter rateLimiter;
    private final SupportGrantExpiryService expiryService;
    private final AuditService auditService;
    private final Clock clock;

    SupportDiagnosticsService(
            JdbcTemplate jdbcTemplate,
            CurrentUserService currentUserService,
            HouseholdMembershipService membershipService,
            OperationRateLimiter rateLimiter,
            SupportGrantExpiryService expiryService,
            AuditService auditService,
            Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.membershipService = membershipService;
        this.rateLimiter = rateLimiter;
        this.expiryService = expiryService;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional
    public CreatedSupportCodeResponse create(
            Jwt jwt,
            UUID householdId,
            String idempotencyKey,
            CreateSupportCodeRequest request) {
        if (idempotencyKey != null) {
            throw new jakarta.validation.ValidationException(
                    "Idempotency-Key is not accepted when creating a one-time support code.");
        }
        if (!request.acknowledgeReadOnlyDiagnostics()) {
            throw new jakarta.validation.ValidationException(
                    "Read-only redacted diagnostics must be acknowledged.");
        }
        CurrentUser owner = currentUserService.resolve(jwt);
        rateLimiter.check(jwt, OperationRateLimiter.Operation.SUPPORT_GRANT);
        membershipService.requireOwnerAccess(householdId, owner.id());
        expiryService.expireForOwnerHousehold(owner.id(), householdId);
        Integer active =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM support_diagnostic_grants
                        WHERE owner_user_id = ? AND household_id = ?
                          AND status = 'ACTIVE' AND expires_at > ?
                        """,
                        Integer.class,
                        owner.id(),
                        householdId,
                        clock.instant());
        if (active != null && active > 0) {
            throw new RequestConflictException(
                    "An active support code already exists for this household.");
        }

        UUID id = UUID.randomUUID();
        String code = OpaqueCodes.random256BitCode();
        Instant now = clock.instant();
        Instant expiresAt = now.plus(15, ChronoUnit.MINUTES);
        jdbcTemplate.update(
                """
                INSERT INTO support_diagnostic_grants (
                    id, owner_user_id, household_id, code_hash, active_key,
                    status, optimistic_version, expires_at, revoked_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                id,
                owner.id(),
                householdId,
                OpaqueCodes.sha256(code),
                householdId.toString(),
                expiresAt,
                now,
                now);
        auditService.record(
                owner.id(),
                ActorRole.USER,
                Action.SUPPORT_GRANT_CREATED,
                ResourceType.SUPPORT_GRANT,
                id);
        return new CreatedSupportCodeResponse(
                new SupportCodeResponse(id, "ACTIVE", 0, expiresAt, now),
                code);
    }

    @Transactional
    public void revoke(
            Jwt jwt,
            UUID householdId,
            UUID grantId,
            long expectedVersion) {
        CurrentUser owner = currentUserService.resolve(jwt);
        membershipService.requireOwnerAccess(householdId, owner.id());
        expiryService.expireById(grantId);
        Instant now = clock.instant();
        int changed =
                jdbcTemplate.update(
                        """
                        UPDATE support_diagnostic_grants
                        SET status = 'REVOKED', active_key = NULL, revoked_at = ?,
                            optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE id = ? AND household_id = ? AND owner_user_id = ?
                          AND status = 'ACTIVE' AND optimistic_version = ?
                          AND expires_at > ?
                        """,
                        now,
                        now,
                        grantId,
                        householdId,
                        owner.id(),
                        expectedVersion,
                        now);
        if (changed == 0) {
            Integer exists =
                    jdbcTemplate.queryForObject(
                            """
                            SELECT COUNT(*)
                            FROM support_diagnostic_grants
                            WHERE id = ? AND household_id = ? AND owner_user_id = ?
                            """,
                            Integer.class,
                            grantId,
                            householdId,
                            owner.id());
            if (exists != null && exists > 0) {
                throw new PreconditionFailedException();
            }
            throw new ResourceNotFoundException();
        }
        auditService.record(
                owner.id(),
                ActorRole.USER,
                Action.SUPPORT_GRANT_REVOKED,
                ResourceType.SUPPORT_GRANT,
                grantId);
    }

    @Transactional
    public SupportDiagnosticsResponse resolve(
            Jwt jwt, ResolveSupportDiagnosticsRequest request) {
        CurrentUser supportUser = currentUserService.resolve(jwt);
        rateLimiter.check(
                jwt,
                OperationRateLimiter.Operation.SUPPORT_DIAGNOSTIC);
        String codeHash = OpaqueCodes.sha256(request.supportCode());
        expiryService.expireByCodeHash(codeHash);
        List<GrantRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT id, owner_user_id, household_id, status,
                               optimistic_version, expires_at, created_at
                        FROM support_diagnostic_grants
                        WHERE code_hash = ?
                        FOR UPDATE
                        """,
                        SupportDiagnosticsService::mapGrant,
                        codeHash);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        GrantRow grant = rows.getFirst();
        Instant now = clock.instant();
        if (!"ACTIVE".equals(grant.status()) || !grant.expiresAt().isAfter(now)) {
            throw new ResourceNotFoundException();
        }

        long activeCommitments =
                count(
                        """
                        SELECT COUNT(*)
                        FROM recurring_commitments
                        WHERE household_id = ? AND status = 'ACTIVE'
                        """,
                        grant.householdId());
        long failedNotifications =
                count(
                        """
                        SELECT COUNT(*)
                        FROM notification_deliveries d
                        JOIN notifications n ON n.id = d.notification_id
                        WHERE n.household_id = ? AND d.status = 'DEAD'
                        """,
                        grant.householdId());
        long pendingPrivacyRequests =
                count(
                        """
                        SELECT COUNT(*)
                        FROM privacy_requests
                        WHERE requester_user_id = ?
                          AND status IN ('REQUESTED', 'PROCESSING', 'BLOCKED')
                        """,
                        grant.ownerUserId());
        Long latestVersion =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COALESCE(MAX(optimistic_version), 0)
                        FROM recurring_commitments
                        WHERE household_id = ?
                        """,
                        Long.class,
                        grant.householdId());
        auditService.record(
                supportUser.id(),
                ActorRole.SUPPORT_READ,
                Action.SUPPORT_DIAGNOSTICS_VIEWED,
                ResourceType.SUPPORT_GRANT,
                grant.id());
        return new SupportDiagnosticsResponse(
                "support-diagnostics-v1",
                failedNotifications > 0 ? "ATTENTION" : "HEALTHY",
                activeCommitments,
                failedNotifications,
                pendingPrivacyRequests,
                latestVersion == null ? 0 : latestVersion,
                now,
                grant.expiresAt());
    }

    private long count(String sql, Object parameter) {
        Long value = jdbcTemplate.queryForObject(sql, Long.class, parameter);
        return value == null ? 0 : value;
    }

    private static GrantRow mapGrant(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new GrantRow(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("owner_user_id", UUID.class),
                resultSet.getObject("household_id", UUID.class),
                resultSet.getString("status"),
                resultSet.getLong("optimistic_version"),
                resultSet.getTimestamp("expires_at").toInstant(),
                resultSet.getTimestamp("created_at").toInstant());
    }

    private record GrantRow(
            UUID id,
            UUID ownerUserId,
            UUID householdId,
            String status,
            long version,
            Instant expiresAt,
            Instant createdAt) {}
}
