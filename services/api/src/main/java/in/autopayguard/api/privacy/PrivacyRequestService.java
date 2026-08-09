package in.autopayguard.api.privacy;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
import in.autopayguard.api.common.concurrency.UserMutationFenceService;
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
import in.autopayguard.api.identity.FakeLocalIdentityPolicy;
import jakarta.validation.ValidationException;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PrivacyRequestService {

    private static final Set<String> IANA_ZONE_IDS = ZoneId.getAvailableZoneIds();
    private static final String CORRECTION_FIELD = "TIMEZONE";
    private static final String CANONICAL_DEMO_EMAIL = "demo@autopayguard.local";
    private static final String TOMBSTONE_DOMAIN =
            "autopay-guard/deletion-tombstone/v1:";
    static final Duration EXPORT_RETENTION =
            Duration.ofHours(23).plusMinutes(55);
    static final long EXPORT_PURGE_INTERVAL_MILLIS = 60_000L;

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final UserMutationFenceService userMutationFenceService;
    private final M5IdempotencyService idempotencyService;
    private final OperationRateLimiter rateLimiter;
    private final PrivacyExportService exportService;
    private final AuditService auditService;
    private final Clock clock;

    PrivacyRequestService(
            JdbcTemplate jdbcTemplate,
            CurrentUserService currentUserService,
            UserMutationFenceService userMutationFenceService,
            M5IdempotencyService idempotencyService,
            OperationRateLimiter rateLimiter,
            PrivacyExportService exportService,
            AuditService auditService,
            Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.userMutationFenceService = userMutationFenceService;
        this.idempotencyService = idempotencyService;
        this.rateLimiter = rateLimiter;
        this.exportService = exportService;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional
    public PrivacyRequestCollectionResponse listOwn(
            Jwt jwt, UUID cursor, int limit) {
        CurrentUser user = currentUserService.resolve(jwt);
        expireDueArtifacts(clock.instant());
        return page(user.id(), cursor, limit, false);
    }

    @Transactional
    public PrivacyRequestCollectionResponse listForAdmin(
            Jwt jwt, UUID cursor, int limit) {
        CurrentUser administrator = currentUserService.resolve(jwt);
        expireDueArtifacts(clock.instant());
        PrivacyRequestCollectionResponse response =
                page(null, cursor, limit, true);
        auditService.record(
                administrator.id(),
                ActorRole.PRIVACY_ADMIN,
                Action.PRIVACY_REQUESTS_VIEWED,
                ResourceType.AUDIT_QUERY,
                UUID.randomUUID());
        return response;
    }

    @Transactional
    public PrivacyRequestResponse getOwn(Jwt jwt, UUID requestId) {
        CurrentUser user = currentUserService.resolve(jwt);
        expireDueArtifacts(clock.instant());
        return response(requestId, user.id());
    }

    @Transactional(isolation = Isolation.REPEATABLE_READ)
    public PrivacyRequestResponse create(
            Jwt jwt, String idempotencyKey, CreatePrivacyRequest request) {
        CurrentUser user = currentUserService.resolve(jwt);
        String requestedCorrectionValue =
                request.correctionValue() == null
                        ? null
                        : request.correctionValue().strip();
        Claim inspected =
                idempotencyService.inspect(
                        user.id(),
                        Operation.PRIVACY_REQUEST,
                        idempotencyKey,
                        java.util.Arrays.asList(
                                request.requestType().name(),
                                requestedCorrectionValue));
        if (inspected.replay()) {
            return idempotencyService.replay(
                    inspected, PrivacyRequestResponse.class);
        }
        rateLimiter.check(jwt, OperationRateLimiter.Operation.PRIVACY_REQUEST);
        String correctionValue = validatedCorrection(request);
        Claim claim =
                idempotencyService.begin(
                        user.id(),
                        Operation.PRIVACY_REQUEST,
                        idempotencyKey,
                        java.util.Arrays.asList(
                                request.requestType().name(),
                                correctionValue));
        if (claim.replay()) {
            return idempotencyService.replay(claim, PrivacyRequestResponse.class);
        }

        UUID requestId = UUID.randomUUID();
        Instant now = clock.instant();
        jdbcTemplate.update(
                """
                INSERT INTO privacy_requests (
                    id, requester_user_id, request_type, status,
                    correction_field, correction_value, optimistic_version,
                    created_at, updated_at, completed_at
                ) VALUES (?, ?, ?, 'REQUESTED', ?, ?, 0, ?, ?, NULL)
                """,
                requestId,
                user.id(),
                request.requestType().name(),
                request.requestType() == PrivacyRequestType.CORRECTION
                        ? CORRECTION_FIELD
                        : null,
                correctionValue,
                now,
                now);
        appendEvent(
                requestId,
                user.id(),
                null,
                PrivacyRequestStatus.REQUESTED,
                null,
                now);
        auditService.record(
                user.id(),
                ActorRole.USER,
                Action.PRIVACY_REQUEST_CREATED,
                ResourceType.PRIVACY_REQUEST,
                requestId);

        if (request.requestType() == PrivacyRequestType.EXPORT) {
            generateExport(requestId, user.id(), now);
        }

        PrivacyRequestResponse response = response(requestId, user.id());
        idempotencyService.complete(
                user.id(),
                Operation.PRIVACY_REQUEST,
                claim,
                requestId,
                201,
                response,
                response.version());
        return response;
    }

    @Transactional
    public PrivacyRequestResponse cancel(
            Jwt jwt,
            UUID requestId,
            long expectedVersion,
            String idempotencyKey) {
        CurrentUser user = currentUserService.resolve(jwt);
        Claim claim =
                idempotencyService.begin(
                        user.id(),
                        Operation.PRIVACY_TRANSITION,
                        idempotencyKey,
                        List.of(
                                "CANCEL",
                                requestId.toString(),
                                Long.toString(expectedVersion)));
        if (claim.replay()) {
            return idempotencyService.replay(claim, PrivacyRequestResponse.class);
        }

        RequestRow row = lockedOwn(requestId, user.id());
        requireVersion(row.version(), expectedVersion);
        if (row.status() != PrivacyRequestStatus.REQUESTED) {
            throw new RequestConflictException(
                    "Only a request that has not started processing can be cancelled.");
        }
        Instant now = clock.instant();
        updateStatus(
                row,
                PrivacyRequestStatus.CANCELLED,
                null,
                now);
        appendEvent(
                row.id(),
                user.id(),
                row.status(),
                PrivacyRequestStatus.CANCELLED,
                "REQUESTER_CANCELLED",
                now);
        auditService.record(
                user.id(),
                ActorRole.USER,
                Action.PRIVACY_REQUEST_CANCELLED,
                ResourceType.PRIVACY_REQUEST,
                requestId);

        PrivacyRequestResponse response = response(requestId, user.id());
        idempotencyService.complete(
                user.id(),
                Operation.PRIVACY_TRANSITION,
                claim,
                requestId,
                200,
                response,
                response.version());
        return response;
    }

    @Transactional
    public PrivacyRequestResponse execute(
            Jwt jwt,
            UUID requestId,
            long expectedVersion,
            String idempotencyKey) {
        CurrentUser administrator = currentUserService.resolve(jwt);
        Claim claim =
                idempotencyService.begin(
                        administrator.id(),
                        Operation.PRIVACY_TRANSITION,
                        idempotencyKey,
                        List.of(
                                "EXECUTE",
                                requestId.toString(),
                                Long.toString(expectedVersion)));
        if (claim.replay()) {
            return idempotencyService.replay(claim, PrivacyRequestResponse.class);
        }

        RequestRow row = locked(requestId);
        requireVersion(row.version(), expectedVersion);
        if (row.status() != PrivacyRequestStatus.REQUESTED) {
            throw new RequestConflictException(
                    "Only a requested privacy operation can be executed.");
        }
        if (row.deletedAt() != null) {
            throw new RequestConflictException(
                    "The privacy request subject is already deleted.");
        }

        PrivacyRequestResponse response;
        if (row.type() == PrivacyRequestType.CORRECTION) {
            response = executeCorrection(row, administrator.id());
        } else if (row.type() == PrivacyRequestType.DELETION) {
            response = executeDeletion(row, administrator.id());
        } else {
            throw new RequestConflictException(
                    "Export requests are generated by the requester and are not admin-executed.");
        }
        if (response.status() != PrivacyRequestStatus.EXECUTED
                || row.type() != PrivacyRequestType.DELETION) {
            idempotencyService.complete(
                    administrator.id(),
                    Operation.PRIVACY_TRANSITION,
                    claim,
                    requestId,
                    200,
                    response,
                    response.version());
        }
        return response;
    }

    @Transactional
    public ExportDownload download(Jwt jwt, UUID requestId) {
        CurrentUser user = currentUserService.resolve(jwt);
        Instant now = clock.instant();
        expireDueArtifacts(now);
        RequestRow request = lockedOwn(requestId, user.id());
        if (request.type() != PrivacyRequestType.EXPORT) {
            throw new ResourceNotFoundException();
        }
        if (request.status() == PrivacyRequestStatus.EXPIRED) {
            return ExportDownload.gone();
        }
        if (request.status() != PrivacyRequestStatus.READY) {
            throw new RequestConflictException("The export artifact is not ready.");
        }
        List<ArtifactRow> artifacts =
                jdbcTemplate.query(
                        """
                        SELECT schema_version, payload, payload_sha256,
                               byte_count, expires_at
                        FROM privacy_export_artifacts
                        WHERE request_id = ? AND requester_user_id = ?
                        FOR UPDATE
                        """,
                        PrivacyRequestService::mapArtifact,
                        requestId,
                        user.id());
        if (artifacts.isEmpty()) {
            throw new RequestConflictException("The export artifact is unavailable.");
        }
        ArtifactRow artifact = artifacts.getFirst();
        if (!artifact.expiresAt().isAfter(now) || artifact.payload() == null) {
            expireArtifact(request, user.id(), now);
            return ExportDownload.gone();
        }
        byte[] payload = artifact.payload().getBytes(StandardCharsets.UTF_8);
        if (payload.length != artifact.byteCount()
                || !OpaqueCodes.sha256(artifact.payload()).equals(artifact.sha256())) {
            throw new IllegalStateException("The stored export artifact failed integrity checks.");
        }
        auditService.record(
                user.id(),
                ActorRole.USER,
                Action.PRIVACY_EXPORT_DOWNLOADED,
                ResourceType.PRIVACY_REQUEST,
                requestId);
        return new ExportDownload(
                false, payload, artifact.sha256(), artifact.schemaVersion());
    }

    @Scheduled(fixedDelay = EXPORT_PURGE_INTERVAL_MILLIS)
    @Transactional
    public void purgeExpiredExports() {
        expireDueArtifacts(clock.instant());
    }

    private void generateExport(UUID requestId, UUID requesterUserId, Instant now) {
        RequestRow requested = locked(requestId);
        updateStatus(requested, PrivacyRequestStatus.PROCESSING, null, now);
        appendEvent(
                requestId,
                requesterUserId,
                PrivacyRequestStatus.REQUESTED,
                PrivacyRequestStatus.PROCESSING,
                null,
                now);
        try {
            PrivacyExportService.Artifact artifact =
                    exportService.build(requesterUserId, now);
            Instant expiresAt = now.plus(EXPORT_RETENTION);
            jdbcTemplate.update(
                    """
                    INSERT INTO privacy_export_artifacts (
                        request_id, requester_user_id, schema_version,
                        payload, payload_sha256, byte_count,
                        generated_at, expires_at, purged_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    requestId,
                    requesterUserId,
                    PrivacyExportService.SCHEMA_VERSION,
                    artifact.text(),
                    artifact.sha256(),
                    artifact.payload().length,
                    now,
                    expiresAt);
            RequestRow processing = locked(requestId);
            updateStatus(processing, PrivacyRequestStatus.READY, now, now);
            appendEvent(
                    requestId,
                    requesterUserId,
                    PrivacyRequestStatus.PROCESSING,
                    PrivacyRequestStatus.READY,
                    null,
                    now);
            auditService.record(
                    requesterUserId,
                    ActorRole.USER,
                    Action.PRIVACY_EXPORT_GENERATED,
                    ResourceType.PRIVACY_REQUEST,
                    requestId);
        } catch (PrivacyExportService.ExportTooLargeException
                | IllegalStateException exception) {
            RequestRow processing = locked(requestId);
            updateStatus(processing, PrivacyRequestStatus.FAILED, null, now);
            appendEvent(
                    requestId,
                    requesterUserId,
                    PrivacyRequestStatus.PROCESSING,
                    PrivacyRequestStatus.FAILED,
                    "LOCAL_POLICY",
                    now);
        }
    }

    private PrivacyRequestResponse executeCorrection(
            RequestRow row, UUID administratorUserId) {
        if (!FakeLocalIdentityPolicy.isEligibleEmail(row.email())) {
            throw new RequestConflictException(
                    "The privacy request subject is not eligible for correction.");
        }
        String timezone = validatedTimezone(row.correctionValue());
        Instant now = clock.instant();
        updateStatus(row, PrivacyRequestStatus.PROCESSING, null, now);
        appendEvent(
                row.id(),
                administratorUserId,
                PrivacyRequestStatus.REQUESTED,
                PrivacyRequestStatus.PROCESSING,
                null,
                now);
        int updated =
                jdbcTemplate.update(
                        """
                        UPDATE users
                        SET timezone = ?, updated_at = ?
                        WHERE id = ? AND deleted_at IS NULL
                        """,
                        timezone,
                        now,
                        row.requesterUserId());
        if (updated != 1) {
            throw new RequestConflictException(
                    "The privacy request subject is not eligible for correction.");
        }
        RequestRow processing = locked(row.id());
        updateStatus(processing, PrivacyRequestStatus.EXECUTED, now, now);
        appendEvent(
                row.id(),
                administratorUserId,
                PrivacyRequestStatus.PROCESSING,
                PrivacyRequestStatus.EXECUTED,
                null,
                now);
        auditService.record(
                administratorUserId,
                ActorRole.PRIVACY_ADMIN,
                Action.PRIVACY_CORRECTION_EXECUTED,
                ResourceType.PRIVACY_REQUEST,
                row.id());
        return response(row.id(), row.requesterUserId());
    }

    private PrivacyRequestResponse executeDeletion(
            RequestRow row, UUID administratorUserId) {
        userMutationFenceService.lockLiveUser(row.requesterUserId());
        lockMembershipScope(row.requesterUserId());
        String blockReason = deletionBlockReason(row);
        Instant now = clock.instant();
        if (blockReason != null) {
            updateStatus(row, PrivacyRequestStatus.BLOCKED, null, now);
            appendEvent(
                    row.id(),
                    administratorUserId,
                    PrivacyRequestStatus.REQUESTED,
                    PrivacyRequestStatus.BLOCKED,
                    blockReason,
                    now);
            auditService.record(
                    administratorUserId,
                    ActorRole.PRIVACY_ADMIN,
                    Action.PRIVACY_DELETION_BLOCKED,
                    ResourceType.PRIVACY_REQUEST,
                    row.id());
            return response(row.id(), row.requesterUserId());
        }

        updateStatus(row, PrivacyRequestStatus.PROCESSING, null, now);
        appendEvent(
                row.id(),
                administratorUserId,
                PrivacyRequestStatus.REQUESTED,
                PrivacyRequestStatus.PROCESSING,
                null,
                now);
        eraseSubjectData(row, now);
        auditService.record(
                administratorUserId,
                ActorRole.PRIVACY_ADMIN,
                Action.PRIVACY_DELETION_EXECUTED,
                ResourceType.PRIVACY_REQUEST,
                row.id());
        return new PrivacyRequestResponse(
                row.id(),
                PrivacyRequestType.DELETION,
                PrivacyRequestStatus.EXECUTED,
                null,
                null,
                row.version() + 2,
                row.createdAt(),
                now,
                now,
                null);
    }

    private void eraseSubjectData(RequestRow row, Instant now) {
        UUID userId = row.requesterUserId();
        String subjectHash =
                OpaqueCodes.sha256(TOMBSTONE_DOMAIN + row.oidcSubject());
        jdbcTemplate.update(
                """
                INSERT INTO deletion_tombstones (
                    subject_hash, execution_id, created_at
                ) VALUES (?, ?, ?)
                """,
                subjectHash,
                UUID.randomUUID(),
                now);

        deleteSubjectAuditEvents(userId, row.email());
        jdbcTemplate.update(
                """
                DELETE FROM household_invitations
                WHERE accepted_by_user_id = ? OR lower(invitee_email) = lower(?)
                """,
                userId,
                row.email());
        jdbcTemplate.update(
                """
                UPDATE recurring_commitments
                SET responsible_member_id = NULL, updated_at = ?
                WHERE responsible_member_id IN (
                    SELECT id FROM household_members WHERE user_id = ?
                )
                """,
                now,
                userId);
        jdbcTemplate.update(
                """
                DELETE FROM m5_idempotency_records
                WHERE operation = 'FEEDBACK_REVIEW'
                  AND resource_id IN (
                      SELECT id FROM cancellation_guide_feedback
                      WHERE owner_user_id = ?
                  )
                """,
                userId);
        jdbcTemplate.update(
                """
                DELETE FROM guide_feedback_reviews
                WHERE feedback_id IN (
                    SELECT id FROM cancellation_guide_feedback
                    WHERE owner_user_id = ?
                )
                """,
                userId);
        /*
         * The household and its commitments both cascade from the owner, while
         * recurring_commitments also has an immediate RESTRICT reference to the
         * owner's household_members row. Delete the owned commitments first so
         * PostgreSQL never has to resolve that circular cascade under RESTRICT.
         * Imported commitments are also referenced by a result-state CHECK on
         * their import items. Clear both result columns before the commitment
         * delete so ON DELETE SET NULL cannot leave selected=TRUE without a
         * created commitment.
         */
        jdbcTemplate.update(
                """
                UPDATE commitment_import_items
                SET selected = NULL, created_commitment_id = NULL,
                    updated_at = ?
                WHERE created_commitment_id IN (
                    SELECT id FROM recurring_commitments
                    WHERE data_owner_user_id = ?
                )
                """,
                now,
                userId);
        jdbcTemplate.update(
                "DELETE FROM recurring_commitments WHERE data_owner_user_id = ?",
                userId);
        jdbcTemplate.update(
                "DELETE FROM households WHERE owner_user_id = ?",
                userId);
        jdbcTemplate.update(
                "DELETE FROM household_members WHERE user_id = ?",
                userId);
        jdbcTemplate.update(
                "DELETE FROM notification_preferences WHERE user_id = ?",
                userId);
        jdbcTemplate.update(
                "DELETE FROM privacy_export_artifacts WHERE requester_user_id = ?",
                userId);
        jdbcTemplate.update(
                "DELETE FROM operation_rate_events WHERE actor_key = ?",
                OperationRateLimiter.actorKeyForSubject(row.oidcSubject()));
        jdbcTemplate.update(
                "DELETE FROM operation_rate_locks WHERE actor_key = ?",
                OperationRateLimiter.actorKeyForSubject(row.oidcSubject()));
        jdbcTemplate.update(
                "DELETE FROM m5_idempotency_records WHERE actor_user_id = ?",
                userId);
        jdbcTemplate.update(
                """
                DELETE FROM m5_idempotency_records
                WHERE resource_id IN (
                    SELECT id FROM privacy_requests
                    WHERE requester_user_id = ?
                )
                """,
                userId);
        jdbcTemplate.update(
                "DELETE FROM idempotency_records WHERE owner_user_id = ?",
                userId);
        jdbcTemplate.update(
                """
                DELETE FROM privacy_notice_acknowledgement_locks
                WHERE user_id = ?
                """,
                userId);
        jdbcTemplate.update(
                "DELETE FROM privacy_notice_acknowledgements WHERE user_id = ?",
                userId);
        jdbcTemplate.update(
                "DELETE FROM consent_event_locks WHERE user_id = ?",
                userId);
        jdbcTemplate.update(
                "DELETE FROM consent_events WHERE user_id = ?",
                userId);
        jdbcTemplate.update(
                """
                DELETE FROM privacy_request_event_locks
                WHERE request_id IN (
                    SELECT id FROM privacy_requests
                    WHERE requester_user_id = ?
                )
                """,
                userId);
        jdbcTemplate.update(
                """
                DELETE FROM privacy_request_events
                WHERE request_id IN (
                    SELECT id FROM privacy_requests
                    WHERE requester_user_id = ?
                )
                """,
                userId);
        jdbcTemplate.update(
                "DELETE FROM privacy_requests WHERE requester_user_id = ?",
                userId);
        int deleted =
                jdbcTemplate.update(
                        "DELETE FROM users WHERE id = ? AND deleted_at IS NULL",
                        userId);
        if (deleted != 1) {
            throw new RequestConflictException(
                    "The privacy request subject is not eligible for deletion.");
        }
    }

    private void deleteSubjectAuditEvents(UUID userId, String email) {
        String predicate =
                """
                actor_user_id = ?
                OR (
                    resource_type = 'PRIVACY_REQUEST'
                    AND resource_id IN (
                        SELECT id FROM privacy_requests
                        WHERE requester_user_id = ?
                    )
                )
                OR (
                    resource_type = 'NOTICE_ACKNOWLEDGEMENT'
                    AND resource_id IN (
                        SELECT id FROM privacy_notice_acknowledgements
                        WHERE user_id = ?
                    )
                )
                OR (
                    resource_type = 'CONSENT_EVENT'
                    AND resource_id IN (
                        SELECT id FROM consent_events
                        WHERE user_id = ?
                    )
                )
                OR (
                    resource_type = 'HOUSEHOLD_MEMBER'
                    AND resource_id IN (
                        SELECT id FROM household_members
                        WHERE user_id = ?
                    )
                )
                OR (
                    resource_type = 'HOUSEHOLD_INVITATION'
                    AND resource_id IN (
                        SELECT i.id
                        FROM household_invitations i
                        JOIN households h ON h.id = i.household_id
                        WHERE h.owner_user_id = ?
                           OR lower(i.invitee_email) = lower(?)
                           OR i.accepted_by_user_id = ?
                    )
                )
                OR (
                    resource_type = 'RECURRING_COMMITMENT'
                    AND resource_id IN (
                        SELECT c.id
                        FROM recurring_commitments c
                        LEFT JOIN household_members responsible
                          ON responsible.household_id = c.household_id
                         AND responsible.id = c.responsible_member_id
                        WHERE c.data_owner_user_id = ?
                           OR responsible.user_id = ?
                    )
                )
                OR (
                    resource_type = 'GUIDE_FEEDBACK'
                    AND resource_id IN (
                        SELECT id FROM cancellation_guide_feedback
                        WHERE owner_user_id = ?
                    )
                )
                OR (
                    resource_type = 'SUPPORT_GRANT'
                    AND resource_id IN (
                        SELECT id FROM support_diagnostic_grants
                        WHERE owner_user_id = ?
                    )
                )
                """;
        Object[] arguments = {
            userId,
            userId,
            userId,
            userId,
            userId,
            userId,
            email,
            userId,
            userId,
            userId,
            userId,
            userId
        };
        String subjectEvents =
                "SELECT id FROM audit_events WHERE " + predicate;
        jdbcTemplate.update(
                "DELETE FROM audit_event_locks WHERE id IN ("
                        + subjectEvents
                        + ")",
                arguments);
        jdbcTemplate.update(
                "DELETE FROM audit_events WHERE " + predicate,
                arguments);
    }

    private String deletionBlockReason(RequestRow row) {
        if (row.deletionProtected()
                || CANONICAL_DEMO_EMAIL.equalsIgnoreCase(row.email())
                || !FakeLocalIdentityPolicy.isEligibleEmail(row.email())) {
            return "LOCAL_POLICY";
        }
        Integer sharedHouseholds =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(DISTINCT mine.household_id)
                        FROM household_members mine
                        JOIN household_members other
                          ON other.household_id = mine.household_id
                         AND other.status = 'ACTIVE'
                         AND other.user_id <> mine.user_id
                        WHERE mine.user_id = ? AND mine.status = 'ACTIVE'
                        """,
                        Integer.class,
                        row.requesterUserId());
        return sharedHouseholds != null && sharedHouseholds > 0
                ? "HOUSEHOLD_HAS_OTHER_MEMBERS"
                : null;
    }

    private void lockMembershipScope(UUID userId) {
        jdbcTemplate.query(
                """
                SELECT h.id
                FROM households h
                JOIN household_members mine ON mine.household_id = h.id
                WHERE mine.user_id = ?
                ORDER BY h.id
                FOR UPDATE
                """,
                (resultSet, rowNumber) -> resultSet.getObject("id", UUID.class),
                userId);
        jdbcTemplate.query(
                """
                SELECT id
                FROM household_members
                WHERE household_id IN (
                    SELECT household_id FROM household_members WHERE user_id = ?
                )
                ORDER BY household_id, id
                FOR UPDATE
                """,
                (resultSet, rowNumber) -> resultSet.getObject("id", UUID.class),
                userId);
    }

    private void expireDueArtifacts(Instant now) {
        List<RequestRow> due =
                jdbcTemplate.query(
                        """
                        SELECT r.id, r.requester_user_id, r.request_type, r.status,
                               r.correction_field, r.correction_value,
                               r.optimistic_version, r.created_at, r.updated_at,
                               r.completed_at, u.deleted_at, u.deletion_protected,
                               u.oidc_subject, u.email
                        FROM privacy_requests r
                        JOIN users u ON u.id = r.requester_user_id
                        JOIN privacy_export_artifacts a ON a.request_id = r.id
                        WHERE r.status = 'READY'
                          AND a.purged_at IS NULL
                          AND a.expires_at <= ?
                        ORDER BY r.id
                        FOR UPDATE
                        """,
                        PrivacyRequestService::mapRequest,
                        now);
        for (RequestRow row : due) {
            expireArtifact(row, row.requesterUserId(), now);
        }
    }

    private void expireArtifact(RequestRow row, UUID actorUserId, Instant now) {
        int purged =
                jdbcTemplate.update(
                        """
                        UPDATE privacy_export_artifacts
                        SET payload = NULL, purged_at = ?
                        WHERE request_id = ? AND purged_at IS NULL
                        """,
                        now,
                        row.id());
        if (purged == 1 && row.status() == PrivacyRequestStatus.READY) {
            updateStatus(row, PrivacyRequestStatus.EXPIRED, null, now);
            appendEvent(
                    row.id(),
                    actorUserId,
                    PrivacyRequestStatus.READY,
                    PrivacyRequestStatus.EXPIRED,
                    "LOCAL_POLICY",
                    now);
            auditService.record(
                    actorUserId,
                    ActorRole.USER,
                    Action.PRIVACY_EXPORT_EXPIRED,
                    ResourceType.PRIVACY_REQUEST,
                    row.id());
        }
    }

    private void updateStatus(
            RequestRow row,
            PrivacyRequestStatus target,
            Instant completedAt,
            Instant now) {
        int updated =
                jdbcTemplate.update(
                        """
                        UPDATE privacy_requests
                        SET status = ?, optimistic_version = optimistic_version + 1,
                            updated_at = ?, completed_at = ?
                        WHERE id = ? AND optimistic_version = ?
                        """,
                        target.name(),
                        now,
                        completedAt,
                        row.id(),
                        row.version());
        if (updated != 1) {
            throw new PreconditionFailedException();
        }
    }

    private void appendEvent(
            UUID requestId,
            UUID actorUserId,
            PrivacyRequestStatus from,
            PrivacyRequestStatus to,
            String reason,
            Instant now) {
        UUID eventId = UUID.randomUUID();
        Object[] values = {
            eventId,
            requestId,
            actorUserId,
            from == null ? "NONE" : from.name(),
            to.name(),
            reason == null ? "NONE" : reason,
            now,
            now
        };
        jdbcTemplate.update(
                """
                INSERT INTO privacy_request_events (
                    id, request_id, actor_user_id, from_status,
                    to_status, reason_code, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        jdbcTemplate.update(
                """
                INSERT INTO privacy_request_event_locks (
                    id, request_id, actor_user_id, from_status,
                    to_status, reason_code, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values);
    }

    private PrivacyRequestResponse response(UUID requestId, UUID requesterUserId) {
        List<PrivacyRequestResponse> responses =
                queryResponses(
                        """
                        SELECT r.id, r.request_type, r.status, r.correction_field,
                               r.correction_value, r.optimistic_version,
                               r.created_at, r.updated_at, r.completed_at,
                               a.schema_version, a.payload_sha256, a.byte_count,
                               a.generated_at, a.expires_at
                        FROM privacy_requests r
                        LEFT JOIN privacy_export_artifacts a
                          ON a.request_id = r.id
                         AND a.purged_at IS NULL
                        WHERE r.id = ? AND r.requester_user_id = ?
                        """,
                        requestId,
                        requesterUserId);
        if (responses.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        return responses.getFirst();
    }

    private PrivacyRequestCollectionResponse page(
            UUID requesterUserId, UUID cursor, int limit, boolean ascending) {
        if (limit < 1 || limit > 100) {
            throw new ValidationException("limit must be between 1 and 100.");
        }
        List<Object> arguments = new ArrayList<>();
        String predicate;
        if (requesterUserId == null) {
            predicate = "";
        } else {
            predicate = "WHERE r.requester_user_id = ?";
            arguments.add(requesterUserId);
        }
        if (cursor != null) {
            RequestCursor value = requireCursor(cursor, requesterUserId);
            predicate +=
                    requesterUserId == null
                            ? "WHERE "
                            : " AND ";
            predicate +=
                    ascending
                            ? "(r.created_at > ? OR (r.created_at = ? AND r.id > ?))"
                            : "(r.created_at < ? OR (r.created_at = ? AND r.id < ?))";
            arguments.add(value.createdAt());
            arguments.add(value.createdAt());
            arguments.add(value.id());
        }
        arguments.add(limit + 1);
        String direction = ascending ? "ASC" : "DESC";
        List<PrivacyRequestResponse> rows =
                queryResponses(
                        """
                        SELECT r.id, r.request_type, r.status, r.correction_field,
                               r.correction_value, r.optimistic_version,
                               r.created_at, r.updated_at, r.completed_at,
                               a.schema_version, a.payload_sha256, a.byte_count,
                               a.generated_at, a.expires_at
                        FROM privacy_requests r
                        LEFT JOIN privacy_export_artifacts a
                          ON a.request_id = r.id
                         AND a.purged_at IS NULL
                        """
                                + predicate
                                + " ORDER BY r.created_at "
                                + direction
                                + ", r.id "
                                + direction
                                + " LIMIT ?",
                        arguments.toArray());
        boolean hasMore = rows.size() > limit;
        List<PrivacyRequestResponse> items =
                hasMore
                        ? List.copyOf(rows.subList(0, limit))
                        : List.copyOf(rows);
        UUID nextCursor =
                hasMore && !items.isEmpty()
                        ? items.getLast().id()
                        : null;
        return new PrivacyRequestCollectionResponse(items, nextCursor);
    }

    private RequestCursor requireCursor(UUID cursor, UUID requesterUserId) {
        try {
            if (requesterUserId == null) {
                return jdbcTemplate.queryForObject(
                        """
                        SELECT id, created_at
                        FROM privacy_requests
                        WHERE id = ?
                        """,
                        (row, rowNumber) ->
                                new RequestCursor(
                                        row.getObject("id", UUID.class),
                                        instant(row, "created_at")),
                        cursor);
            }
            return jdbcTemplate.queryForObject(
                    """
                    SELECT id, created_at
                    FROM privacy_requests
                    WHERE id = ? AND requester_user_id = ?
                    """,
                    (row, rowNumber) ->
                            new RequestCursor(
                                    row.getObject("id", UUID.class),
                                    instant(row, "created_at")),
                    cursor,
                    requesterUserId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private RequestRow lockedOwn(UUID requestId, UUID requesterUserId) {
        List<RequestRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT r.id, r.requester_user_id, r.request_type, r.status,
                               r.correction_field, r.correction_value,
                               r.optimistic_version, r.created_at, r.updated_at,
                               r.completed_at, u.deleted_at, u.deletion_protected,
                               u.oidc_subject, u.email
                        FROM privacy_requests r
                        JOIN users u ON u.id = r.requester_user_id
                        WHERE r.id = ? AND r.requester_user_id = ?
                        FOR UPDATE
                        """,
                        PrivacyRequestService::mapRequest,
                        requestId,
                        requesterUserId);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        return rows.getFirst();
    }

    private RequestRow locked(UUID requestId) {
        List<RequestRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT r.id, r.requester_user_id, r.request_type, r.status,
                               r.correction_field, r.correction_value,
                               r.optimistic_version, r.created_at, r.updated_at,
                               r.completed_at, u.deleted_at, u.deletion_protected,
                               u.oidc_subject, u.email
                        FROM privacy_requests r
                        JOIN users u ON u.id = r.requester_user_id
                        WHERE r.id = ?
                        FOR UPDATE
                        """,
                        PrivacyRequestService::mapRequest,
                        requestId);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        return rows.getFirst();
    }

    private List<PrivacyRequestResponse> queryResponses(
            String sql, Object... arguments) {
        return jdbcTemplate.query(sql, PrivacyRequestService::mapResponse, arguments);
    }

    private static RequestRow mapRequest(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new RequestRow(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("requester_user_id", UUID.class),
                PrivacyRequestType.valueOf(resultSet.getString("request_type")),
                PrivacyRequestStatus.valueOf(resultSet.getString("status")),
                resultSet.getString("correction_field"),
                resultSet.getString("correction_value"),
                resultSet.getLong("optimistic_version"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"),
                nullableInstant(resultSet, "completed_at"),
                nullableInstant(resultSet, "deleted_at"),
                resultSet.getBoolean("deletion_protected"),
                resultSet.getString("oidc_subject"),
                resultSet.getString("email"));
    }

    private static PrivacyRequestResponse mapResponse(
            ResultSet resultSet, int rowNumber) throws SQLException {
        String schemaVersion = resultSet.getString("schema_version");
        PrivacyExportMetadata export =
                schemaVersion == null
                        ? null
                        : new PrivacyExportMetadata(
                                schemaVersion,
                                resultSet.getString("payload_sha256"),
                                resultSet.getLong("byte_count"),
                                instant(resultSet, "generated_at"),
                                instant(resultSet, "expires_at"));
        return new PrivacyRequestResponse(
                resultSet.getObject("id", UUID.class),
                PrivacyRequestType.valueOf(resultSet.getString("request_type")),
                PrivacyRequestStatus.valueOf(resultSet.getString("status")),
                resultSet.getString("correction_field"),
                resultSet.getString("correction_value"),
                resultSet.getLong("optimistic_version"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"),
                nullableInstant(resultSet, "completed_at"),
                export);
    }

    private static ArtifactRow mapArtifact(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new ArtifactRow(
                resultSet.getString("schema_version"),
                resultSet.getString("payload"),
                resultSet.getString("payload_sha256"),
                resultSet.getLong("byte_count"),
                instant(resultSet, "expires_at"));
    }

    private static Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        return resultSet.getObject(column, OffsetDateTime.class).toInstant();
    }

    private static Instant nullableInstant(ResultSet resultSet, String column)
            throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static String validatedCorrection(CreatePrivacyRequest request) {
        if (request.requestType() == PrivacyRequestType.CORRECTION) {
            if (request.correctionValue() == null
                    || request.correctionValue().isBlank()) {
                throw new ValidationException(
                        "correctionValue is required for a correction request.");
            }
            return validatedTimezone(request.correctionValue());
        }
        if (request.correctionValue() != null) {
            throw new ValidationException(
                    "correctionValue is allowed only for a correction request.");
        }
        return null;
    }

    private static String validatedTimezone(String rawValue) {
        String timezone = rawValue == null ? "" : rawValue.strip();
        if (!IANA_ZONE_IDS.contains(timezone)) {
            throw new ValidationException(
                    "correctionValue must be a supported IANA time-zone identifier.");
        }
        try {
            return ZoneId.of(timezone).getId();
        } catch (DateTimeException exception) {
            throw new ValidationException(
                    "correctionValue must be a supported IANA time-zone identifier.");
        }
    }

    private static void requireVersion(long actualVersion, long expectedVersion) {
        if (actualVersion != expectedVersion) {
            throw new PreconditionFailedException();
        }
    }

    public record ExportDownload(
            boolean expired,
            byte[] payload,
            String sha256,
            String schemaVersion) {

        static ExportDownload gone() {
            return new ExportDownload(true, new byte[0], null, null);
        }
    }

    private record RequestRow(
            UUID id,
            UUID requesterUserId,
            PrivacyRequestType type,
            PrivacyRequestStatus status,
            String correctionField,
            String correctionValue,
            long version,
            Instant createdAt,
            Instant updatedAt,
            Instant completedAt,
            Instant deletedAt,
            boolean deletionProtected,
            String oidcSubject,
            String email) {}

    private record ArtifactRow(
            String schemaVersion,
            String payload,
            String sha256,
            long byteCount,
            Instant expiresAt) {}

    private record RequestCursor(UUID id, Instant createdAt) {}
}
