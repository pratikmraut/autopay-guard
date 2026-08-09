package in.autopayguard.api.household;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.common.idempotency.M5IdempotencyService;
import in.autopayguard.api.common.idempotency.M5IdempotencyService.Claim;
import in.autopayguard.api.common.idempotency.M5IdempotencyService.Operation;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import in.autopayguard.api.common.security.OpaqueCodes;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import in.autopayguard.api.privacy.ConsentService;
import jakarta.validation.ValidationException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HouseholdMembershipService {

    private static final Pattern FAKE_LOCAL_EMAIL =
            Pattern.compile(
                    "^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:autopayguard\\.local|[a-z0-9-]+\\.example\\.test)$");

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final ConsentService consentService;
    private final M5IdempotencyService idempotencyService;
    private final OperationRateLimiter rateLimiter;
    private final HouseholdInvitationExpiryService expiryService;
    private final AuditService auditService;
    private final Clock clock;

    HouseholdMembershipService(
            JdbcTemplate jdbcTemplate,
            CurrentUserService currentUserService,
            ConsentService consentService,
            M5IdempotencyService idempotencyService,
            OperationRateLimiter rateLimiter,
            HouseholdInvitationExpiryService expiryService,
            AuditService auditService,
            Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.consentService = consentService;
        this.idempotencyService = idempotencyService;
        this.rateLimiter = rateLimiter;
        this.expiryService = expiryService;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void registerFounder(UUID householdId, UUID userId, Instant now) {
        jdbcTemplate.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status, optimistic_version,
                    joined_at, removed_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'OWNER', 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                householdId,
                householdId,
                userId,
                now,
                now,
                now);
    }

    @Transactional(readOnly = true)
    public HouseholdMemberCollectionResponse listMembers(
            Jwt jwt, UUID householdId, UUID cursor, int limit) {
        requirePageLimit(limit);
        CurrentUser user = currentUserService.resolve(jwt);
        requireConsentedReadAccess(householdId, user.id());
        List<Object> arguments = new ArrayList<>();
        arguments.add(householdId);
        String cursorPredicate = "";
        if (cursor != null) {
            MemberCursor value = requireMemberCursor(cursor, householdId);
            cursorPredicate =
                    """
                     AND (
                         CASE WHEN m.role = 'OWNER' THEN 0 ELSE 1 END > ?
                         OR (
                             CASE WHEN m.role = 'OWNER' THEN 0 ELSE 1 END = ?
                             AND (
                                 m.joined_at > ?
                                 OR (m.joined_at = ? AND m.id > ?)
                             )
                         )
                     )
                    """;
            arguments.add(value.roleOrder());
            arguments.add(value.roleOrder());
            arguments.add(value.joinedAt());
            arguments.add(value.joinedAt());
            arguments.add(value.id());
        }
        arguments.add(limit + 1);
        List<HouseholdMemberResponse> rows =
                jdbcTemplate.query(
                        """
                        SELECT m.id, m.user_id, u.display_name, m.role, m.status,
                               m.optimistic_version, m.joined_at, m.removed_at
                        FROM household_members m
                        JOIN users u ON u.id = m.user_id
                        WHERE m.household_id = ?
                        """
                                + cursorPredicate
                                + """
                        ORDER BY
                            CASE WHEN m.role = 'OWNER' THEN 0 ELSE 1 END,
                            m.joined_at ASC, m.id ASC
                        LIMIT ?
                        """,
                        HouseholdMembershipService::mapMember,
                        arguments.toArray());
        boolean hasMore = rows.size() > limit;
        List<HouseholdMemberResponse> items =
                hasMore
                        ? List.copyOf(rows.subList(0, limit))
                        : List.copyOf(rows);
        return new HouseholdMemberCollectionResponse(
                items,
                hasMore && !items.isEmpty()
                        ? items.getLast().id()
                        : null);
    }

    private MemberCursor requireMemberCursor(UUID cursor, UUID householdId) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT m.id,
                           CASE WHEN m.role = 'OWNER' THEN 0 ELSE 1 END
                               AS role_order,
                           m.joined_at
                    FROM household_members m
                    WHERE m.id = ? AND m.household_id = ?
                    """,
                    (row, rowNumber) ->
                            new MemberCursor(
                                    row.getObject("id", UUID.class),
                                    row.getInt("role_order"),
                                    row.getTimestamp("joined_at").toInstant()),
                    cursor,
                    householdId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    @Transactional(readOnly = true)
    public HouseholdCollectionResponse listAccessibleHouseholds(
            UUID userId, UUID cursor, int limit) {
        requirePageLimit(limit);
        boolean memberAccessGranted = consentService.isSharingGranted(userId);
        HouseholdCursor scanCursor =
                cursor == null
                        ? null
                        : requireAccessibleHouseholdCursor(
                                cursor, userId, memberAccessGranted);
        List<HouseholdResponse> visible = new ArrayList<>(limit + 1);
        boolean exhausted = false;
        int batchSize = Math.min(101, Math.max(limit + 1, 50));

        while (visible.size() <= limit && !exhausted) {
            List<Object> arguments = new ArrayList<>();
            arguments.add(userId);
            String cursorPredicate = "";
            if (scanCursor != null) {
                cursorPredicate =
                        """
                         AND (
                             h.created_at > ?
                             OR (h.created_at = ? AND h.id > ?)
                         )
                        """;
                arguments.add(scanCursor.createdAt());
                arguments.add(scanCursor.createdAt());
                arguments.add(scanCursor.id());
            }
            arguments.add(batchSize);
            List<AccessibleHouseholdRow> rows =
                    jdbcTemplate.query(
                            """
                            SELECT h.id, h.name, h.owner_user_id, h.default_currency,
                                   h.timezone, h.created_at, h.updated_at, m.role
                            FROM household_members m
                            JOIN households h ON h.id = m.household_id
                            WHERE m.user_id = ? AND m.status = 'ACTIVE'
                            """
                                    + cursorPredicate
                                    + """
                                    ORDER BY h.created_at ASC, h.id ASC
                                    LIMIT ?
                                    """,
                            HouseholdMembershipService::mapAccessibleHousehold,
                            arguments.toArray());
            exhausted = rows.size() < batchSize;
            if (rows.isEmpty()) {
                break;
            }
            for (AccessibleHouseholdRow row : rows) {
                HouseholdResponse household = row.household();
                if (household.accessRole() == HouseholdMemberRole.OWNER
                        || (memberAccessGranted
                                && consentService.isSharingGranted(
                                        household.ownerUserId()))) {
                    visible.add(household);
                    if (visible.size() > limit) {
                        break;
                    }
                }
            }
            AccessibleHouseholdRow last = rows.getLast();
            scanCursor =
                    new HouseholdCursor(
                            last.household().id(), last.createdAt());
        }

        boolean hasMore = visible.size() > limit;
        List<HouseholdResponse> page =
                hasMore
                        ? List.copyOf(visible.subList(0, limit))
                        : List.copyOf(visible);
        return new HouseholdCollectionResponse(
                page,
                hasMore && !page.isEmpty()
                        ? page.getLast().id()
                        : null);
    }

    private HouseholdCursor requireAccessibleHouseholdCursor(
            UUID cursor, UUID userId, boolean memberAccessGranted) {
        try {
            AccessibleHouseholdRow row =
                    jdbcTemplate.queryForObject(
                            """
                            SELECT h.id, h.name, h.owner_user_id, h.default_currency,
                                   h.timezone, h.created_at, h.updated_at, m.role
                            FROM household_members m
                            JOIN households h ON h.id = m.household_id
                            WHERE h.id = ? AND m.user_id = ?
                              AND m.status = 'ACTIVE'
                            """,
                            HouseholdMembershipService::mapAccessibleHousehold,
                            cursor,
                            userId);
            if (row == null
                    || (row.household().accessRole()
                                    != HouseholdMemberRole.OWNER
                            && (!memberAccessGranted
                                    || !consentService.isSharingGranted(
                                            row.household().ownerUserId())))) {
                throw new ResourceNotFoundException();
            }
            return new HouseholdCursor(cursor, row.createdAt());
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private static AccessibleHouseholdRow mapAccessibleHousehold(
            ResultSet resultSet, int rowNumber) throws SQLException {
        HouseholdMemberRole role =
                HouseholdMemberRole.valueOf(resultSet.getString("role"));
        Instant createdAt =
                resultSet.getObject(
                                "created_at",
                                java.time.OffsetDateTime.class)
                        .toInstant();
        return new AccessibleHouseholdRow(
                new HouseholdResponse(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("name"),
                        resultSet.getObject("owner_user_id", UUID.class),
                        resultSet.getString("default_currency"),
                        resultSet.getString("timezone"),
                        createdAt,
                        resultSet.getObject(
                                        "updated_at",
                                        java.time.OffsetDateTime.class)
                                .toInstant(),
                        role,
                        role == HouseholdMemberRole.OWNER),
                createdAt);
    }

    @Transactional
    public CreatedHouseholdInvitationResponse createInvitation(
            Jwt jwt, UUID householdId, CreateHouseholdInvitationRequest request) {
        CurrentUser owner = currentUserService.resolve(jwt);
        rateLimiter.check(
                jwt, OperationRateLimiter.Operation.INVITATION_CREATE);
        requireOwnerAccess(householdId, owner.id());
        if (!consentService.isSharingGranted(owner.id())) {
            throw new RequestConflictException(
                    "Grant the current household-sharing consent before inviting a member.");
        }
        String email = validatedFakeEmail(request.inviteeEmail());
        if (email.equals(owner.email())) {
            throw new RequestConflictException(
                    "The household owner is already a member.");
        }
        Integer eligibleFakeIdentityCount =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM users
                        WHERE lower(email) = ? AND deleted_at IS NULL
                        """,
                        Integer.class,
                        email);
        if (eligibleFakeIdentityCount == null || eligibleFakeIdentityCount != 1) {
            throw new RequestConflictException(
                    "The invitation target must first sign in as an existing fake local identity.");
        }
        expiryService.expireForTarget(householdId, email);
        Instant now = clock.instant();
        Integer activeInvitationCount =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM household_invitations
                        WHERE household_id = ? AND invitee_email = ?
                          AND status = 'PENDING' AND expires_at > ?
                        """,
                        Integer.class,
                        householdId,
                        email,
                        now);
        if (activeInvitationCount != null && activeInvitationCount > 0) {
            throw new RequestConflictException(
                    "An active invitation already exists for this fake account.");
        }
        Integer activeMemberCount =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM household_members m
                        JOIN users u ON u.id = m.user_id
                        WHERE m.household_id = ? AND m.status = 'ACTIVE'
                          AND lower(u.email) = ?
                        """,
                        Integer.class,
                        householdId,
                        email);
        if (activeMemberCount != null && activeMemberCount > 0) {
            throw new RequestConflictException(
                    "That fake account is already an active member.");
        }

        String code = OpaqueCodes.random256BitCode();
        UUID invitationId = UUID.randomUUID();
        Instant expiresAt = now.plus(24, ChronoUnit.HOURS);
        try {
            jdbcTemplate.update(
                    """
                    INSERT INTO household_invitations (
                        id, household_id, invitee_email, role, token_hash,
                        pending_key, status,
                        accepted_by_user_id, optimistic_version, expires_at,
                        accepted_at, revoked_at, created_at, updated_at
                    ) VALUES (?, ?, ?, 'MEMBER', ?, ?, 'PENDING', NULL, 0, ?,
                              NULL, NULL, ?, ?)
                    """,
                    invitationId,
                    householdId,
                    email,
                    OpaqueCodes.sha256(code),
                    householdId + "|" + email,
                    expiresAt,
                    now,
                    now);
        } catch (DataIntegrityViolationException exception) {
            throw new RequestConflictException(
                    "An active invitation already exists for this fake account.");
        }
        auditService.record(
                owner.id(),
                ActorRole.USER,
                Action.HOUSEHOLD_INVITATION_CREATED,
                ResourceType.HOUSEHOLD_INVITATION,
                invitationId);
        HouseholdInvitationResponse invitation =
                invitation(invitationId, owner.id());
        return new CreatedHouseholdInvitationResponse(invitation, code, false);
    }

    @Transactional(readOnly = true)
    public HouseholdInvitationCollectionResponse listHouseholdInvitations(
            Jwt jwt, UUID householdId, UUID cursor, int limit) {
        requirePageLimit(limit);
        CurrentUser owner = currentUserService.resolve(jwt);
        requireOwnerAccess(householdId, owner.id());
        expiryService.expireForHousehold(householdId);
        List<Object> arguments = new ArrayList<>();
        arguments.add(householdId);
        String cursorPredicate = "";
        if (cursor != null) {
            InvitationCursor value =
                    requireHouseholdInvitationCursor(cursor, householdId);
            cursorPredicate =
                    """
                     AND (
                         i.created_at < ?
                         OR (i.created_at = ? AND i.id < ?)
                     )
                    """;
            arguments.add(value.createdAt());
            arguments.add(value.createdAt());
            arguments.add(value.id());
        }
        arguments.add(limit + 1);
        List<HouseholdInvitationResponse> rows =
                jdbcTemplate.query(
                        invitationSelect()
                                + """
                                  WHERE i.household_id = ?
                                  """
                                + cursorPredicate
                                + """
                                  ORDER BY i.created_at DESC, i.id DESC
                                  LIMIT ?
                                  """,
                        HouseholdMembershipService::mapInvitation,
                        arguments.toArray());
        boolean hasMore = rows.size() > limit;
        List<HouseholdInvitationResponse> items =
                hasMore
                        ? List.copyOf(rows.subList(0, limit))
                        : List.copyOf(rows);
        return new HouseholdInvitationCollectionResponse(
                items,
                hasMore && !items.isEmpty()
                        ? items.getLast().id()
                        : null);
    }

    @Transactional(readOnly = true)
    public HouseholdInvitationCollectionResponse listIncomingInvitations(
            Jwt jwt, UUID cursor, int limit) {
        requirePageLimit(limit);
        CurrentUser user = currentUserService.resolve(jwt);
        String inviteeEmail = user.email().toLowerCase(Locale.ROOT);
        expiryService.expireForInvitee(inviteeEmail);
        if (!consentService.isSharingGranted(user.id())) {
            return new HouseholdInvitationCollectionResponse(List.of(), null);
        }
        InvitationCursor requestedCursor =
                cursor == null
                        ? null
                        : requireIncomingInvitationCursor(cursor, inviteeEmail);
        InvitationCursor scanCursor = requestedCursor;
        Instant now = clock.instant();
        List<HouseholdInvitationResponse> visible = new ArrayList<>(limit + 1);
        boolean exhausted = false;
        while (visible.size() <= limit && !exhausted) {
            List<Object> arguments = new ArrayList<>();
            arguments.add(inviteeEmail);
            arguments.add(now);
            String cursorPredicate = "";
            if (scanCursor != null) {
                cursorPredicate =
                        """
                         AND (
                             i.created_at > ?
                             OR (i.created_at = ? AND i.id > ?)
                         )
                        """;
                arguments.add(scanCursor.createdAt());
                arguments.add(scanCursor.createdAt());
                arguments.add(scanCursor.id());
            }
            int batchSize = Math.min(101, Math.max(limit + 1, 25));
            arguments.add(batchSize);
            List<IncomingInvitation> candidates =
                    jdbcTemplate.query(
                            """
                            SELECT i.id, i.household_id, h.name AS household_name,
                                   i.invitee_email, i.status, i.optimistic_version,
                                   i.expires_at, i.created_at, h.owner_user_id
                            FROM household_invitations i
                            JOIN households h ON h.id = i.household_id
                            WHERE i.invitee_email = ? AND i.status = 'PENDING'
                              AND i.expires_at > ?
                            """
                                    + cursorPredicate
                                    + """
                                    ORDER BY i.created_at ASC, i.id ASC
                                    LIMIT ?
                                    """,
                            (resultSet, rowNumber) ->
                                    new IncomingInvitation(
                                            mapInvitation(resultSet, rowNumber),
                                            resultSet.getObject(
                                                    "owner_user_id",
                                                    UUID.class)),
                            arguments.toArray());
            for (IncomingInvitation candidate : candidates) {
                if (consentService.isSharingGranted(candidate.ownerUserId())) {
                    visible.add(candidate.response());
                    if (visible.size() > limit) {
                        break;
                    }
                }
            }
            exhausted = candidates.size() < batchSize;
            if (!candidates.isEmpty()) {
                HouseholdInvitationResponse last =
                        candidates.getLast().response();
                scanCursor = new InvitationCursor(last.id(), last.createdAt());
            } else {
                exhausted = true;
            }
        }
        boolean hasMore = visible.size() > limit;
        List<HouseholdInvitationResponse> items =
                hasMore
                        ? List.copyOf(visible.subList(0, limit))
                        : List.copyOf(visible);
        return new HouseholdInvitationCollectionResponse(
                items,
                hasMore && !items.isEmpty()
                        ? items.getLast().id()
                        : null);
    }

    @Transactional
    public HouseholdMemberResponse acceptInvitation(
            Jwt jwt, String idempotencyKey, AcceptHouseholdInvitationRequest request) {
        CurrentUser user = currentUserService.resolve(jwt);
        String tokenHash = OpaqueCodes.sha256(request.invitationCode());
        Claim inspected =
                idempotencyService.inspect(
                        user.id(),
                        Operation.INVITATION_ACCEPT,
                        idempotencyKey,
                        List.of(tokenHash));
        if (inspected.replay()) {
            return idempotencyService.replay(
                    inspected, HouseholdMemberResponse.class);
        }
        rateLimiter.check(
                jwt, OperationRateLimiter.Operation.INVITATION_ACCEPT);
        expiryService.expireByTokenHash(tokenHash);
        Claim claim =
                idempotencyService.begin(
                        user.id(),
                        Operation.INVITATION_ACCEPT,
                        idempotencyKey,
                        List.of(tokenHash));
        if (claim.replay()) {
            return idempotencyService.replay(claim, HouseholdMemberResponse.class);
        }
        if (!consentService.isSharingGranted(user.id())) {
            throw new RequestConflictException(
                    "Grant the current household-sharing consent before accepting an invitation.");
        }

        List<UUID> householdIds =
                jdbcTemplate.query(
                        """
                        SELECT household_id
                        FROM household_invitations
                        WHERE token_hash = ?
                        """,
                        (row, rowNumber) ->
                                row.getObject("household_id", UUID.class),
                        tokenHash);
        if (householdIds.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        List<UUID> lockedHouseholds =
                jdbcTemplate.query(
                        """
                        SELECT id
                        FROM households
                        WHERE id = ?
                        FOR UPDATE
                        """,
                        (row, rowNumber) -> row.getObject("id", UUID.class),
                        householdIds.getFirst());
        if (lockedHouseholds.isEmpty()) {
            throw new ResourceNotFoundException();
        }

        List<InvitationRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT i.id, i.household_id, i.invitee_email, i.status,
                               i.optimistic_version, i.expires_at,
                               h.owner_user_id
                        FROM household_invitations i
                        JOIN households h ON h.id = i.household_id
                        WHERE i.token_hash = ?
                        FOR UPDATE
                        """,
                        HouseholdMembershipService::mapInvitationRow,
                        tokenHash);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        InvitationRow invitation = rows.getFirst();
        Instant now = clock.instant();
        if (!"PENDING".equals(invitation.status())
                || !invitation.inviteeEmail().equals(user.email().toLowerCase(Locale.ROOT))
                || !invitation.expiresAt().isAfter(now)) {
            throw new ResourceNotFoundException();
        }
        if (!consentService.isSharingGranted(invitation.ownerUserId())) {
            throw new RequestConflictException(
                    "The household owner's current sharing consent is required before acceptance.");
        }

        HouseholdMemberResponse member =
                upsertAcceptedMember(invitation.householdId(), user, now);
        jdbcTemplate.update(
                """
                UPDATE household_invitations
                SET status = 'ACCEPTED', pending_key = NULL, accepted_by_user_id = ?,
                    accepted_at = ?, optimistic_version = optimistic_version + 1,
                    updated_at = ?
                WHERE id = ? AND optimistic_version = ? AND status = 'PENDING'
                """,
                user.id(),
                now,
                now,
                invitation.id(),
                invitation.version());
        idempotencyService.complete(
                user.id(),
                Operation.INVITATION_ACCEPT,
                claim,
                member.id(),
                200,
                member,
                member.version());
        auditService.record(
                user.id(),
                ActorRole.USER,
                Action.HOUSEHOLD_INVITATION_ACCEPTED,
                ResourceType.HOUSEHOLD_INVITATION,
                invitation.id());
        return member;
    }

    @Transactional
    public void revokeInvitation(
            Jwt jwt, UUID householdId, UUID invitationId, long expectedVersion) {
        CurrentUser owner = currentUserService.resolve(jwt);
        requireOwnerAccess(householdId, owner.id());
        expiryService.expireById(invitationId);
        Instant now = clock.instant();
        int updated =
                jdbcTemplate.update(
                        """
                UPDATE household_invitations
                SET status = 'REVOKED', pending_key = NULL, revoked_at = ?,
                            optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE id = ? AND household_id = ? AND status = 'PENDING'
                          AND optimistic_version = ? AND expires_at > ?
                        """,
                        now,
                        now,
                        invitationId,
                        householdId,
                        expectedVersion,
                        now);
        if (updated == 0) {
            if (invitationExists(invitationId, householdId)) {
                throw new PreconditionFailedException();
            }
            throw new ResourceNotFoundException();
        }
        auditService.record(
                owner.id(),
                ActorRole.USER,
                Action.HOUSEHOLD_INVITATION_REVOKED,
                ResourceType.HOUSEHOLD_INVITATION,
                invitationId);
    }

    @Transactional
    public void removeMember(
            Jwt jwt, UUID householdId, UUID memberId, long expectedVersion) {
        CurrentUser owner = currentUserService.resolve(jwt);
        lockOwnerMutationScope(householdId, owner.id());
        List<HouseholdMemberResponse> rows =
                jdbcTemplate.query(
                        """
                        SELECT m.id, m.user_id, u.display_name, m.role, m.status,
                               m.optimistic_version, m.joined_at, m.removed_at
                        FROM household_members m
                        JOIN users u ON u.id = m.user_id
                        WHERE m.id = ? AND m.household_id = ?
                        FOR UPDATE
                        """,
                        HouseholdMembershipService::mapMember,
                        memberId,
                        householdId);
        if (rows.isEmpty() || rows.getFirst().status() != HouseholdMemberStatus.ACTIVE) {
            throw new ResourceNotFoundException();
        }
        HouseholdMemberResponse member = rows.getFirst();
        if (member.role() == HouseholdMemberRole.OWNER) {
            throw new RequestConflictException(
                    "The immutable household founder cannot be removed in this milestone.");
        }
        if (member.version() != expectedVersion) {
            throw new PreconditionFailedException();
        }
        Instant now = clock.instant();
        jdbcTemplate.update(
                """
                UPDATE recurring_commitments
                SET responsible_member_id = NULL,
                    optimistic_version = optimistic_version + 1,
                    updated_at = ?
                WHERE household_id = ? AND responsible_member_id = ?
                """,
                now,
                householdId,
                memberId);
        jdbcTemplate.update(
                """
                UPDATE household_members
                SET status = 'REMOVED', removed_at = ?,
                    optimistic_version = optimistic_version + 1,
                    updated_at = ?
                WHERE id = ? AND optimistic_version = ?
                """,
                now,
                now,
                memberId,
                expectedVersion);
        auditService.record(
                owner.id(),
                ActorRole.USER,
                Action.HOUSEHOLD_MEMBER_REMOVED,
                ResourceType.HOUSEHOLD_MEMBER,
                memberId);
    }

    @Transactional(readOnly = true)
    public ActiveHouseholdAccess requireActiveAccess(
            UUID householdId, UUID userId) {
        List<ActiveHouseholdAccess> rows =
                jdbcTemplate.query(
                        """
                        SELECT h.id AS household_id, m.id AS member_id, m.user_id,
                               h.owner_user_id, m.role,
                               h.default_currency, h.timezone
                        FROM household_members m
                        JOIN households h ON h.id = m.household_id
                        WHERE m.household_id = ? AND m.user_id = ?
                          AND m.status = 'ACTIVE'
                        """,
                        HouseholdMembershipService::mapAccess,
                        householdId,
                        userId);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        return rows.getFirst();
    }

    @Transactional(readOnly = true)
    public ActiveHouseholdAccess requireOwnerAccess(
            UUID householdId, UUID userId) {
        ActiveHouseholdAccess access = requireActiveAccess(householdId, userId);
        if (!access.owner()) {
            throw new ResourceNotFoundException();
        }
        return access;
    }

    @Transactional
    public void lockOwnerMutationScope(UUID householdId, UUID ownerUserId) {
        List<UUID> rows =
                jdbcTemplate.query(
                        """
                        SELECT h.id
                        FROM households h
                        JOIN household_members m
                          ON m.household_id = h.id
                         AND m.user_id = ?
                         AND m.role = 'OWNER'
                         AND m.status = 'ACTIVE'
                        WHERE h.id = ? AND h.owner_user_id = ?
                        FOR UPDATE
                        """,
                        (resultSet, rowNumber) ->
                                resultSet.getObject("id", UUID.class),
                        ownerUserId,
                        householdId,
                        ownerUserId);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
    }

    @Transactional(readOnly = true)
    public ActiveHouseholdAccess requireConsentedReadAccess(
            UUID householdId, UUID userId) {
        ActiveHouseholdAccess access = requireActiveAccess(householdId, userId);
        if (!access.owner()
                && (!consentService.isSharingGranted(userId)
                        || !consentService.isSharingGranted(access.ownerUserId()))) {
            throw new ResourceNotFoundException();
        }
        return access;
    }

    @Transactional(readOnly = true)
    public UUID requireAssignableMember(UUID householdId, UUID memberId) {
        List<UUID> userIds =
                jdbcTemplate.query(
                        """
                        SELECT user_id
                        FROM household_members
                        WHERE household_id = ? AND id = ?
                          AND role = 'MEMBER' AND status = 'ACTIVE'
                        """,
                        (resultSet, rowNumber) ->
                                resultSet.getObject("user_id", UUID.class),
                        householdId,
                        memberId);
        if (userIds.isEmpty()
                || !consentService.isSharingGranted(userIds.getFirst())) {
            throw new ResourceNotFoundException();
        }
        return userIds.getFirst();
    }

    private HouseholdMemberResponse upsertAcceptedMember(
            UUID householdId, CurrentUser user, Instant now) {
        List<HouseholdMemberResponse> existing =
                jdbcTemplate.query(
                        """
                        SELECT m.id, m.user_id, u.display_name, m.role, m.status,
                               m.optimistic_version, m.joined_at, m.removed_at
                        FROM household_members m
                        JOIN users u ON u.id = m.user_id
                        WHERE m.household_id = ? AND m.user_id = ?
                        FOR UPDATE
                        """,
                        HouseholdMembershipService::mapMember,
                        householdId,
                        user.id());
        UUID memberId;
        if (existing.isEmpty()) {
            memberId = UUID.randomUUID();
            jdbcTemplate.update(
                    """
                    INSERT INTO household_members (
                        id, household_id, user_id, role, status,
                        optimistic_version, joined_at, removed_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, 'MEMBER', 'ACTIVE', 0, ?, NULL, ?, ?)
                    """,
                    memberId,
                    householdId,
                    user.id(),
                    now,
                    now,
                    now);
        } else {
            HouseholdMemberResponse member = existing.getFirst();
            if (member.status() == HouseholdMemberStatus.ACTIVE) {
                throw new RequestConflictException(
                        "The invitation has already been accepted.");
            }
            memberId = member.id();
            jdbcTemplate.update(
                    """
                    UPDATE household_members
                    SET status = 'ACTIVE', removed_at = NULL, joined_at = ?,
                        optimistic_version = optimistic_version + 1,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    now,
                    now,
                    memberId);
        }
        return member(memberId);
    }

    private HouseholdMemberResponse member(UUID memberId) {
        return jdbcTemplate.queryForObject(
                """
                SELECT m.id, m.user_id, u.display_name, m.role, m.status,
                       m.optimistic_version, m.joined_at, m.removed_at
                FROM household_members m
                JOIN users u ON u.id = m.user_id
                WHERE m.id = ?
                """,
                HouseholdMembershipService::mapMember,
                memberId);
    }

    private HouseholdInvitationResponse invitation(UUID invitationId, UUID ownerUserId) {
        List<HouseholdInvitationResponse> rows =
                jdbcTemplate.query(
                        invitationSelect()
                                + """
                                  WHERE i.id = ? AND h.owner_user_id = ?
                                  """,
                        HouseholdMembershipService::mapInvitation,
                        invitationId,
                        ownerUserId);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        return rows.getFirst();
    }

    private boolean invitationExists(UUID invitationId, UUID householdId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*) FROM household_invitations
                        WHERE id = ? AND household_id = ?
                        """,
                        Integer.class,
                        invitationId,
                        householdId);
        return count != null && count > 0;
    }

    private InvitationCursor requireHouseholdInvitationCursor(
            UUID cursor, UUID householdId) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT id, created_at
                    FROM household_invitations
                    WHERE id = ? AND household_id = ?
                    """,
                    HouseholdMembershipService::mapInvitationCursor,
                    cursor,
                    householdId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private InvitationCursor requireIncomingInvitationCursor(
            UUID cursor, String inviteeEmail) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT id, created_at
                    FROM household_invitations
                    WHERE id = ? AND invitee_email = ?
                    """,
                    HouseholdMembershipService::mapInvitationCursor,
                    cursor,
                    inviteeEmail);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private static InvitationCursor mapInvitationCursor(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new InvitationCursor(
                resultSet.getObject("id", UUID.class),
                resultSet.getTimestamp("created_at").toInstant());
    }

    private static void requirePageLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ValidationException("limit must be between 1 and 100.");
        }
    }

    private static String invitationSelect() {
        return """
               SELECT i.id, i.household_id, h.name AS household_name,
                      i.invitee_email, i.status, i.optimistic_version,
                      i.expires_at, i.created_at
               FROM household_invitations i
               JOIN households h ON h.id = i.household_id
               """;
    }

    private static String validatedFakeEmail(String rawEmail) {
        String email = rawEmail.strip().toLowerCase(Locale.ROOT);
        if (!FAKE_LOCAL_EMAIL.matcher(email).matches()) {
            throw new ValidationException(
                    "inviteeEmail must use a reserved fake local account domain.");
        }
        return email;
    }

    private static HouseholdMemberResponse mapMember(ResultSet resultSet, int rowNumber)
            throws SQLException {
        java.sql.Timestamp removedAt = resultSet.getTimestamp("removed_at");
        return new HouseholdMemberResponse(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("user_id", UUID.class),
                resultSet.getString("display_name"),
                HouseholdMemberRole.valueOf(resultSet.getString("role")),
                HouseholdMemberStatus.valueOf(resultSet.getString("status")),
                resultSet.getLong("optimistic_version"),
                resultSet.getTimestamp("joined_at").toInstant(),
                removedAt == null ? null : removedAt.toInstant());
    }

    private static HouseholdInvitationResponse mapInvitation(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new HouseholdInvitationResponse(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("household_id", UUID.class),
                resultSet.getString("household_name"),
                resultSet.getString("invitee_email"),
                resultSet.getString("status"),
                resultSet.getLong("optimistic_version"),
                resultSet.getTimestamp("expires_at").toInstant(),
                resultSet.getTimestamp("created_at").toInstant());
    }

    private static InvitationRow mapInvitationRow(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new InvitationRow(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("household_id", UUID.class),
                resultSet.getString("invitee_email"),
                resultSet.getString("status"),
                resultSet.getLong("optimistic_version"),
                resultSet.getTimestamp("expires_at").toInstant(),
                resultSet.getObject("owner_user_id", UUID.class));
    }

    private static ActiveHouseholdAccess mapAccess(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new ActiveHouseholdAccess(
                resultSet.getObject("household_id", UUID.class),
                resultSet.getObject("member_id", UUID.class),
                resultSet.getObject("user_id", UUID.class),
                resultSet.getObject("owner_user_id", UUID.class),
                HouseholdMemberRole.valueOf(resultSet.getString("role")),
                resultSet.getString("default_currency"),
                resultSet.getString("timezone"));
    }

    private record InvitationRow(
            UUID id,
            UUID householdId,
            String inviteeEmail,
            String status,
            long version,
            Instant expiresAt,
            UUID ownerUserId) {}

    private record MemberCursor(UUID id, int roleOrder, Instant joinedAt) {}

    private record HouseholdCursor(UUID id, Instant createdAt) {}

    private record AccessibleHouseholdRow(
            HouseholdResponse household, Instant createdAt) {}

    private record IncomingInvitation(
            HouseholdInvitationResponse response, UUID ownerUserId) {}

    private record InvitationCursor(UUID id, Instant createdAt) {}
}
