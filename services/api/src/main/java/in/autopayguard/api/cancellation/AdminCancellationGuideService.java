package in.autopayguard.api.cancellation;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.common.idempotency.M5IdempotencyService;
import in.autopayguard.api.common.idempotency.M5IdempotencyService.Operation;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class AdminCancellationGuideService {

    private static final int REQUIRED_STEP_COUNT = 4;
    private final CurrentUserService currentUserService;
    private final M5IdempotencyService idempotencyService;
    private final OperationRateLimiter rateLimiter;
    private final AuditService auditService;
    private final CancellationTargetRepository targetRepository;
    private final SafeGuideTargetPolicy targetPolicy;
    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    AdminCancellationGuideService(
            CurrentUserService currentUserService,
            M5IdempotencyService idempotencyService,
            OperationRateLimiter rateLimiter,
            AuditService auditService,
            CancellationTargetRepository targetRepository,
            SafeGuideTargetPolicy targetPolicy,
            JdbcTemplate jdbcTemplate,
            Clock clock) {
        this.currentUserService = currentUserService;
        this.idempotencyService = idempotencyService;
        this.rateLimiter = rateLimiter;
        this.auditService = auditService;
        this.targetRepository = targetRepository;
        this.targetPolicy = targetPolicy;
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    @Transactional
    AdminCancellationGuideCollectionResponse list(Jwt jwt) {
        currentUserService.resolve(jwt);
        List<AdminCancellationGuideSummaryResponse> items =
                jdbcTemplate.query(
                        """
                        SELECT g.id AS guide_id, g.merchant_id,
                               m.canonical_name AS merchant_name,
                               m.category AS merchant_category,
                               s.state, s.current_published_version,
                               s.optimistic_version, s.updated_at
                        FROM cancellation_guides g
                        JOIN merchants m ON m.id = g.merchant_id
                        JOIN cancellation_guide_catalog_state s
                          ON s.guide_id = g.id
                        ORDER BY m.normalized_name, g.id
                        """,
                        AdminCancellationGuideService::mapGuideSummary);
        return new AdminCancellationGuideCollectionResponse(List.copyOf(items));
    }

    @Transactional
    AdminCancellationGuideSummaryResponse get(Jwt jwt, UUID guideId) {
        currentUserService.resolve(jwt);
        return requireGuideSummary(guideId);
    }

    @Transactional
    AdminCancellationGuideVersionCollectionResponse versions(
            Jwt jwt, UUID guideId, UUID cursor, int limit) {
        requirePageLimit(limit);
        currentUserService.resolve(jwt);
        requireGuideSummary(guideId);
        List<Object> arguments = new ArrayList<>();
        arguments.add(guideId);
        String cursorPredicate = "";
        if (cursor != null) {
            GuideVersionCursor value = requireVersionCursor(cursor, guideId);
            cursorPredicate =
                    """
                     AND (
                         v.created_at < ?
                         OR (v.created_at = ? AND v.version < ?)
                     )
                    """;
            arguments.add(value.createdAt());
            arguments.add(value.createdAt());
            arguments.add(value.version());
        }
        arguments.add(limit + 1);
        List<AdminCancellationGuideVersionResponse> items =
                jdbcTemplate.query(
                        """
                        SELECT v.guide_id, v.version AS guide_version,
                               v.status, v.risk_notice,
                               v.structural_reviewed_at,
                               v.review_interval_days, v.published_at,
                               v.created_at, d.draft_id,
                               d.optimistic_version AS draft_version
                        FROM cancellation_guide_versions v
                        LEFT JOIN cancellation_guide_draft_states d
                         ON d.guide_id = v.guide_id
                         AND d.guide_version = v.version
                        WHERE v.guide_id = ?
                        """
                                + cursorPredicate
                                + """
                                ORDER BY v.created_at DESC, v.version DESC
                                LIMIT ?
                                """,
                        AdminCancellationGuideService::mapGuideVersion,
                        arguments.toArray());
        boolean hasMore = items.size() > limit;
        List<AdminCancellationGuideVersionResponse> page =
                hasMore
                        ? List.copyOf(items.subList(0, limit))
                        : List.copyOf(items);
        return new AdminCancellationGuideVersionCollectionResponse(
                page,
                hasMore && !page.isEmpty()
                        ? versionCursor(
                                guideId, page.getLast().guideVersion())
                        : null);
    }

    @Transactional
    AdminCancellationGuideDraftResponse createDraft(
            Jwt jwt, UUID guideId, String idempotencyKey) {
        CurrentUser admin = currentUserService.resolve(jwt);
        M5IdempotencyService.Claim claim =
                idempotencyService.begin(
                        admin.id(),
                        Operation.GUIDE_DRAFT_CREATE,
                        idempotencyKey,
                        List.of(guideId.toString()));
        if (claim.replay()) {
            return idempotencyService.replay(
                    claim, AdminCancellationGuideDraftResponse.class);
        }

        CatalogHead head = lockCatalogHead(guideId);
        Integer draftCount =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM cancellation_guide_versions
                        WHERE guide_id = ? AND status = 'DRAFT'
                        """,
                        Integer.class,
                        guideId);
        if (draftCount != null && draftCount > 0) {
            throw new RequestConflictException(
                    "This guide already has an editable draft.");
        }

        Integer sourceVersion =
                head.currentPublishedVersion() != null
                        ? head.currentPublishedVersion()
                        : jdbcTemplate.queryForObject(
                                """
                                SELECT MAX(version)
                                FROM cancellation_guide_versions
                                WHERE guide_id = ? AND status = 'PUBLISHED'
                                """,
                                Integer.class,
                                guideId);
        if (sourceVersion == null) {
            throw new RequestConflictException(
                    "This guide has no immutable published version to clone.");
        }
        SourceVersion source =
                requirePublishedVersion(guideId, sourceVersion);
        Integer nextVersion =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COALESCE(MAX(version), 0) + 1
                        FROM cancellation_guide_versions
                        WHERE guide_id = ?
                        """,
                        Integer.class,
                        guideId);
        if (nextVersion == null) {
            throw new IllegalStateException("The next guide version is unavailable.");
        }

        Instant now = clock.instant();
        UUID draftId = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_versions (
                    guide_id, version, status, risk_notice,
                    structural_reviewed_at, review_interval_days,
                    published_at, created_at
                ) VALUES (?, ?, 'DRAFT', ?, ?, ?, NULL, ?)
                """,
                guideId,
                nextVersion,
                source.riskNotice(),
                source.structuralReviewedAt(),
                source.reviewIntervalDays(),
                now);
        int cloned =
                jdbcTemplate.update(
                        """
                        INSERT INTO cancellation_guide_steps (
                            guide_id, guide_version, track, sequence_number,
                            action_type, title, instruction,
                            target_key, target_uri
                        )
                        SELECT guide_id, ?, track, sequence_number,
                               action_type, title, instruction,
                               target_key, target_uri
                        FROM cancellation_guide_steps
                        WHERE guide_id = ? AND guide_version = ?
                        """,
                        nextVersion,
                        guideId,
                        source.version());
        if (cloned != REQUIRED_STEP_COUNT) {
            throw new IllegalStateException(
                    "The current guide structure cannot be cloned safely.");
        }
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_draft_states (
                    draft_id, guide_id, guide_version, optimistic_version,
                    created_by_user_id, created_at, updated_at
                ) VALUES (?, ?, ?, 0, ?, ?, ?)
                """,
                draftId,
                guideId,
                nextVersion,
                admin.id(),
                now,
                now);
        recordLifecycle(
                guideId,
                nextVersion,
                admin.id(),
                GuideLifecycleAction.DRAFT_CREATED,
                now);
        auditService.record(
                admin.id(),
                ActorRole.GUIDE_ADMIN,
                Action.GUIDE_DRAFT_CREATED,
                ResourceType.CANCELLATION_GUIDE,
                guideId);

        AdminCancellationGuideDraftResponse response = requireDraft(draftId, false);
        idempotencyService.complete(
                admin.id(),
                Operation.GUIDE_DRAFT_CREATE,
                claim,
                draftId,
                201,
                response,
                response.version());
        return response;
    }

    @Transactional
    AdminCancellationGuideDraftResponse getDraft(Jwt jwt, UUID draftId) {
        currentUserService.resolve(jwt);
        return requireDraft(draftId, false);
    }

    @Transactional
    AdminCancellationGuideDraftResponse updateDraft(
            Jwt jwt,
            UUID draftId,
            long expectedVersion,
            UpdateAdminCancellationGuideDraftRequest rawRequest) {
        CurrentUser admin = currentUserService.resolve(jwt);
        UpdateAdminCancellationGuideDraftRequest request =
                normalizeAndValidate(rawRequest);
        DraftIdentity draft = lockDraft(draftId);
        requireEditableDraft(draft, expectedVersion);

        List<AdminCancellationGuideDraftStepResponse> existingSteps =
                loadSteps(draft.guideId(), draft.guideVersion());
        Set<StepKey> expectedKeys = new HashSet<>();
        for (AdminCancellationGuideDraftStepResponse step : existingSteps) {
            expectedKeys.add(new StepKey(step.track(), step.sequenceNumber()));
        }
        Set<StepKey> suppliedKeys = new HashSet<>();
        for (UpdateAdminCancellationGuideDraftStepRequest step : request.steps()) {
            if (!suppliedKeys.add(new StepKey(step.track(), step.sequenceNumber()))) {
                throw new ValidationException(
                        "Each draft step may be supplied exactly once.");
            }
        }
        if (!suppliedKeys.equals(expectedKeys)
                || suppliedKeys.size() != REQUIRED_STEP_COUNT) {
            throw new ValidationException(
                    "The request must preserve all four existing guide steps.");
        }

        Instant now = clock.instant();
        int versionUpdated =
                jdbcTemplate.update(
                        """
                        UPDATE cancellation_guide_versions
                        SET risk_notice = ?, review_interval_days = ?
                        WHERE guide_id = ? AND version = ? AND status = 'DRAFT'
                        """,
                        request.riskNotice(),
                        request.reviewIntervalDays(),
                        draft.guideId(),
                        draft.guideVersion());
        if (versionUpdated != 1) {
            throw new PreconditionFailedException();
        }
        for (UpdateAdminCancellationGuideDraftStepRequest step : request.steps()) {
            int changed =
                    jdbcTemplate.update(
                            """
                            UPDATE cancellation_guide_steps
                            SET title = ?, instruction = ?
                            WHERE guide_id = ? AND guide_version = ?
                              AND track = ? AND sequence_number = ?
                            """,
                            step.title(),
                            step.instruction(),
                            draft.guideId(),
                            draft.guideVersion(),
                            step.track().name(),
                            step.sequenceNumber());
            if (changed != 1) {
                throw new PreconditionFailedException();
            }
        }
        int stateUpdated =
                jdbcTemplate.update(
                        """
                        UPDATE cancellation_guide_draft_states
                        SET optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE draft_id = ? AND optimistic_version = ?
                        """,
                        now,
                        draftId,
                        expectedVersion);
        if (stateUpdated != 1) {
            throw new PreconditionFailedException();
        }
        recordLifecycle(
                draft.guideId(),
                draft.guideVersion(),
                admin.id(),
                GuideLifecycleAction.DRAFT_SAVED,
                now);
        auditService.record(
                admin.id(),
                ActorRole.GUIDE_ADMIN,
                Action.GUIDE_DRAFT_SAVED,
                ResourceType.CANCELLATION_GUIDE,
                draft.guideId());
        return requireDraft(draftId, false);
    }

    @Transactional
    AdminCancellationGuidePublicationResponse publish(
            Jwt jwt, UUID draftId, long expectedVersion, String idempotencyKey) {
        CurrentUser admin = currentUserService.resolve(jwt);
        M5IdempotencyService.Claim inspected =
                idempotencyService.inspect(
                        admin.id(),
                        Operation.GUIDE_PUBLISH,
                        idempotencyKey,
                        List.of(
                                draftId.toString(),
                                Long.toString(expectedVersion)));
        if (inspected.replay()) {
            return idempotencyService.replay(
                    inspected, AdminCancellationGuidePublicationResponse.class);
        }
        rateLimiter.check(
                jwt, OperationRateLimiter.Operation.GUIDE_PUBLISH);
        M5IdempotencyService.Claim claim =
                idempotencyService.begin(
                        admin.id(),
                        Operation.GUIDE_PUBLISH,
                        idempotencyKey,
                        List.of(
                                draftId.toString(),
                                Long.toString(expectedVersion)));
        if (claim.replay()) {
            return idempotencyService.replay(
                    claim, AdminCancellationGuidePublicationResponse.class);
        }

        DraftIdentity draft = lockDraft(draftId);
        requireEditableDraft(draft, expectedVersion);
        CatalogHead head = lockCatalogHead(draft.guideId());
        validateDraft(draft.guideId(), draft.guideVersion());

        Instant now = clock.instant();
        int published =
                jdbcTemplate.update(
                        """
                        UPDATE cancellation_guide_versions
                        SET status = 'PUBLISHED',
                            structural_reviewed_at = ?,
                            published_at = ?
                        WHERE guide_id = ? AND version = ? AND status = 'DRAFT'
                        """,
                        now,
                        now,
                        draft.guideId(),
                        draft.guideVersion());
        if (published != 1) {
            throw new PreconditionFailedException();
        }
        int draftStateUpdated =
                jdbcTemplate.update(
                        """
                        UPDATE cancellation_guide_draft_states
                        SET optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE draft_id = ? AND optimistic_version = ?
                        """,
                        now,
                        draftId,
                        expectedVersion);
        if (draftStateUpdated != 1) {
            throw new PreconditionFailedException();
        }

        insertPublishedLocks(draft.guideId(), draft.guideVersion());
        int headUpdated =
                jdbcTemplate.update(
                        """
                        UPDATE cancellation_guide_catalog_state
                        SET current_published_version = ?,
                            state = 'ACTIVE',
                            optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE guide_id = ? AND optimistic_version = ?
                        """,
                        draft.guideVersion(),
                        now,
                        draft.guideId(),
                        head.optimisticVersion());
        if (headUpdated != 1) {
            throw new PreconditionFailedException();
        }
        recordLifecycle(
                draft.guideId(),
                draft.guideVersion(),
                admin.id(),
                GuideLifecycleAction.PUBLISHED,
                now);
        auditService.record(
                admin.id(),
                ActorRole.GUIDE_ADMIN,
                Action.GUIDE_PUBLISHED,
                ResourceType.CANCELLATION_GUIDE,
                draft.guideId());

        AdminCancellationGuidePublicationResponse response =
                new AdminCancellationGuidePublicationResponse(
                        draft.guideId(),
                        draft.guideVersion(),
                        "ACTIVE",
                        head.optimisticVersion() + 1,
                        now);
        idempotencyService.complete(
                admin.id(),
                Operation.GUIDE_PUBLISH,
                claim,
                draft.guideId(),
                200,
                response,
                response.catalogVersion());
        return response;
    }

    @Transactional
    AdminCancellationGuideSummaryResponse retire(
            Jwt jwt, UUID guideId, long expectedVersion, String idempotencyKey) {
        CurrentUser admin = currentUserService.resolve(jwt);
        M5IdempotencyService.Claim claim =
                idempotencyService.begin(
                        admin.id(),
                        Operation.GUIDE_RETIRE,
                        idempotencyKey,
                        List.of(
                                guideId.toString(),
                                Long.toString(expectedVersion)));
        if (claim.replay()) {
            return idempotencyService.replay(
                    claim, AdminCancellationGuideSummaryResponse.class);
        }

        CatalogHead head = lockCatalogHead(guideId);
        if (head.optimisticVersion() != expectedVersion) {
            throw new PreconditionFailedException();
        }
        if (!"ACTIVE".equals(head.state())
                || head.currentPublishedVersion() == null) {
            throw new RequestConflictException("The guide is already retired.");
        }

        Instant now = clock.instant();
        int changed =
                jdbcTemplate.update(
                        """
                        UPDATE cancellation_guide_catalog_state
                        SET current_published_version = NULL,
                            state = 'RETIRED',
                            optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE guide_id = ? AND optimistic_version = ?
                          AND state = 'ACTIVE'
                        """,
                        now,
                        guideId,
                        expectedVersion);
        if (changed != 1) {
            throw new PreconditionFailedException();
        }
        recordLifecycle(
                guideId,
                head.currentPublishedVersion(),
                admin.id(),
                GuideLifecycleAction.RETIRED,
                now);
        auditService.record(
                admin.id(),
                ActorRole.GUIDE_ADMIN,
                Action.GUIDE_RETIRED,
                ResourceType.CANCELLATION_GUIDE,
                guideId);

        AdminCancellationGuideSummaryResponse response = requireGuideSummary(guideId);
        idempotencyService.complete(
                admin.id(),
                Operation.GUIDE_RETIRE,
                claim,
                guideId,
                200,
                response,
                response.version());
        return response;
    }

    private AdminCancellationGuideSummaryResponse requireGuideSummary(UUID guideId) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT g.id AS guide_id, g.merchant_id,
                           m.canonical_name AS merchant_name,
                           m.category AS merchant_category,
                           s.state, s.current_published_version,
                           s.optimistic_version, s.updated_at
                    FROM cancellation_guides g
                    JOIN merchants m ON m.id = g.merchant_id
                    JOIN cancellation_guide_catalog_state s
                      ON s.guide_id = g.id
                    WHERE g.id = ?
                    """,
                    AdminCancellationGuideService::mapGuideSummary,
                    guideId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private CatalogHead lockCatalogHead(UUID guideId) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT guide_id, current_published_version,
                           state, optimistic_version
                    FROM cancellation_guide_catalog_state
                    WHERE guide_id = ?
                    FOR UPDATE
                    """,
                    (row, rowNumber) ->
                            new CatalogHead(
                                    row.getObject("guide_id", UUID.class),
                                    nullableInteger(
                                            row,
                                            "current_published_version"),
                                    row.getString("state"),
                                    row.getLong("optimistic_version")),
                    guideId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private SourceVersion requirePublishedVersion(UUID guideId, int version) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT version, status, risk_notice,
                           structural_reviewed_at, review_interval_days
                    FROM cancellation_guide_versions
                    WHERE guide_id = ? AND version = ?
                    """,
                    (row, rowNumber) -> {
                        if (!"PUBLISHED".equals(row.getString("status"))) {
                            throw new IllegalStateException(
                                    "The catalog head is not published.");
                        }
                        return new SourceVersion(
                                row.getInt("version"),
                                row.getString("risk_notice"),
                                instant(row, "structural_reviewed_at"),
                                row.getInt("review_interval_days"));
                    },
                    guideId,
                    version);
        } catch (EmptyResultDataAccessException exception) {
            throw new IllegalStateException(
                    "The catalog head version is missing.", exception);
        }
    }

    private DraftIdentity lockDraft(UUID draftId) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT d.draft_id, d.guide_id, d.guide_version,
                           d.optimistic_version, v.status
                    FROM cancellation_guide_draft_states d
                    JOIN cancellation_guide_versions v
                      ON v.guide_id = d.guide_id
                     AND v.version = d.guide_version
                    WHERE d.draft_id = ?
                    FOR UPDATE
                    """,
                    (row, rowNumber) ->
                            new DraftIdentity(
                                    row.getObject("draft_id", UUID.class),
                                    row.getObject("guide_id", UUID.class),
                                    row.getInt("guide_version"),
                                    row.getLong("optimistic_version"),
                                    GuideStatus.valueOf(row.getString("status"))),
                    draftId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private AdminCancellationGuideDraftResponse requireDraft(
            UUID draftId, boolean includeNonDraft) {
        final DraftHeader header;
        try {
            header =
                    jdbcTemplate.queryForObject(
                            """
                            SELECT d.draft_id, d.guide_id, d.guide_version,
                                   d.optimistic_version, d.created_at,
                                   d.updated_at, v.status, v.risk_notice,
                                   v.structural_reviewed_at,
                                   v.review_interval_days
                            FROM cancellation_guide_draft_states d
                            JOIN cancellation_guide_versions v
                              ON v.guide_id = d.guide_id
                             AND v.version = d.guide_version
                            WHERE d.draft_id = ?
                            """,
                            (row, rowNumber) ->
                                    new DraftHeader(
                                            row.getObject(
                                                    "draft_id", UUID.class),
                                            row.getObject(
                                                    "guide_id", UUID.class),
                                            row.getInt("guide_version"),
                                            GuideStatus.valueOf(
                                                    row.getString("status")),
                                            row.getString("risk_notice"),
                                            instant(
                                                    row,
                                                    "structural_reviewed_at"),
                                            row.getInt(
                                                    "review_interval_days"),
                                            row.getLong(
                                                    "optimistic_version"),
                                            instant(row, "created_at"),
                                            instant(row, "updated_at")),
                            draftId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
        if (!includeNonDraft && header.status() != GuideStatus.DRAFT) {
            throw new ResourceNotFoundException();
        }
        return new AdminCancellationGuideDraftResponse(
                header.draftId(),
                header.guideId(),
                header.guideVersion(),
                header.status(),
                header.riskNotice(),
                header.structuralReviewedAt(),
                header.reviewIntervalDays(),
                loadSteps(header.guideId(), header.guideVersion()),
                header.optimisticVersion(),
                header.createdAt(),
                header.updatedAt());
    }

    private List<AdminCancellationGuideDraftStepResponse> loadSteps(
            UUID guideId, int guideVersion) {
        List<AdminCancellationGuideDraftStepResponse> steps =
                jdbcTemplate.query(
                        """
                        SELECT track, sequence_number, action_type,
                               title, instruction, target_key, target_uri
                        FROM cancellation_guide_steps
                        WHERE guide_id = ? AND guide_version = ?
                        ORDER BY track, sequence_number
                        """,
                        (row, rowNumber) ->
                                new AdminCancellationGuideDraftStepResponse(
                                        GuideTrackKind.valueOf(
                                                row.getString("track")),
                                        row.getInt("sequence_number"),
                                        GuideStepKind.valueOf(
                                                row.getString("action_type")),
                                        row.getString("title"),
                                        row.getString("instruction"),
                                        row.getString("target_key"),
                                        row.getString("target_uri")),
                        guideId,
                        guideVersion);
        return List.copyOf(steps);
    }

    private void requireEditableDraft(
            DraftIdentity draft, long expectedVersion) {
        if (draft.status() != GuideStatus.DRAFT) {
            throw new PreconditionFailedException();
        }
        if (draft.optimisticVersion() != expectedVersion) {
            throw new PreconditionFailedException();
        }
    }

    private void validateDraft(UUID guideId, int guideVersion) {
        List<AdminCancellationGuideDraftStepResponse> steps =
                loadSteps(guideId, guideVersion);
        if (steps.size() != REQUIRED_STEP_COUNT) {
            throw new RequestConflictException(
                    "A guide must contain exactly two steps in each track.");
        }
        Map<GuideTrackKind, List<AdminCancellationGuideDraftStepResponse>> byTrack =
                new HashMap<>();
        for (AdminCancellationGuideDraftStepResponse step : steps) {
            byTrack.computeIfAbsent(step.track(), ignored -> new ArrayList<>())
                    .add(step);
        }
        for (GuideTrackKind track : GuideTrackKind.values()) {
            List<AdminCancellationGuideDraftStepResponse> trackSteps =
                    byTrack.getOrDefault(track, List.of());
            trackSteps =
                    trackSteps.stream()
                            .sorted(
                                    Comparator.comparingInt(
                                            AdminCancellationGuideDraftStepResponse
                                                    ::sequenceNumber))
                            .toList();
            if (trackSteps.size() != 2
                    || trackSteps.get(0).sequenceNumber() != 1
                    || trackSteps.get(1).sequenceNumber() != 2) {
                throw new RequestConflictException(
                        "A guide must contain exactly two ordered steps in each track.");
            }
            for (AdminCancellationGuideDraftStepResponse step : trackSteps) {
                if (step.actionType() == GuideStepKind.INFORMATION) {
                    if (step.targetKey() != null || step.targetUri() != null) {
                        throw new RequestConflictException(
                                "Informational guide steps cannot contain targets.");
                    }
                    continue;
                }
                CancellationTargetEntity allowlist =
                        targetRepository
                                .findById(step.targetKey())
                                .orElseThrow(
                                        () ->
                                                new RequestConflictException(
                                                        "A guide target is unavailable."));
                try {
                    targetPolicy.validate(
                            step.actionType(), step.targetUri(), allowlist);
                } catch (IllegalStateException exception) {
                    throw new RequestConflictException(
                            "A guide target does not match the enabled local allowlist.");
                }
            }
        }
    }

    private void insertPublishedLocks(UUID guideId, int guideVersion) {
        int versionLocks =
                jdbcTemplate.update(
                        """
                        INSERT INTO cancellation_published_version_locks (
                            guide_id, version, status, risk_notice,
                            structural_reviewed_at, review_interval_days,
                            published_at, created_at
                        )
                        SELECT guide_id, version, status, risk_notice,
                               structural_reviewed_at, review_interval_days,
                               published_at, created_at
                        FROM cancellation_guide_versions
                        WHERE guide_id = ? AND version = ?
                          AND status = 'PUBLISHED'
                        """,
                        guideId,
                        guideVersion);
        int stepLocks =
                jdbcTemplate.update(
                        """
                        INSERT INTO cancellation_published_step_locks (
                            guide_id, guide_version, track, sequence_number,
                            action_type, title, instruction
                        )
                        SELECT guide_id, guide_version, track, sequence_number,
                               action_type, title, instruction
                        FROM cancellation_guide_steps
                        WHERE guide_id = ? AND guide_version = ?
                        """,
                        guideId,
                        guideVersion);
        Integer targetCount =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM cancellation_guide_steps
                        WHERE guide_id = ? AND guide_version = ?
                          AND target_key IS NOT NULL
                        """,
                        Integer.class,
                        guideId,
                        guideVersion);
        int targetLocks =
                jdbcTemplate.update(
                        """
                        INSERT INTO cancellation_published_target_locks (
                            guide_id, guide_version, track, sequence_number,
                            action_type, title, instruction,
                            target_key, target_uri
                        )
                        SELECT guide_id, guide_version, track, sequence_number,
                               action_type, title, instruction,
                               target_key, target_uri
                        FROM cancellation_guide_steps
                        WHERE guide_id = ? AND guide_version = ?
                          AND target_key IS NOT NULL
                        """,
                        guideId,
                        guideVersion);
        if (versionLocks != 1
                || stepLocks != REQUIRED_STEP_COUNT
                || targetCount == null
                || targetCount < 1
                || targetLocks != targetCount) {
            throw new IllegalStateException(
                    "Published guide lock snapshots are incomplete.");
        }
    }

    private void recordLifecycle(
            UUID guideId,
            Integer guideVersion,
            UUID actorUserId,
            GuideLifecycleAction action,
            Instant now) {
        UUID eventId = UUID.randomUUID();
        Object[] values = {
            eventId,
            guideId,
            guideVersion,
            actorUserId,
            action.name(),
            now,
            now
        };
        jdbcTemplate.update(
                """
                INSERT INTO guide_lifecycle_events (
                    id, guide_id, guide_version, actor_user_id,
                    action, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        jdbcTemplate.update(
                """
                INSERT INTO guide_lifecycle_event_locks (
                    id, guide_id, guide_version, actor_user_id,
                    action, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
    }

    private static UpdateAdminCancellationGuideDraftRequest normalizeAndValidate(
            UpdateAdminCancellationGuideDraftRequest request) {
        String riskNotice = normalizedText(request.riskNotice(), "riskNotice");
        List<UpdateAdminCancellationGuideDraftStepRequest> steps =
                request.steps().stream()
                        .map(
                                step ->
                                        new UpdateAdminCancellationGuideDraftStepRequest(
                                                step.track(),
                                                step.sequenceNumber(),
                                                normalizedText(
                                                        step.title(), "title"),
                                                normalizedText(
                                                        step.instruction(),
                                                        "instruction")))
                        .toList();
        return new UpdateAdminCancellationGuideDraftRequest(
                riskNotice, request.reviewIntervalDays(), steps);
    }

    private static String normalizedText(String value, String field) {
        String normalized = value.strip();
        if (normalized.isEmpty()) {
            throw new ValidationException(field + " must not be blank.");
        }
        if (normalized.chars().anyMatch(Character::isISOControl)) {
            throw new ValidationException(
                    field + " must not contain control characters.");
        }
        return normalized;
    }

    private GuideVersionCursor requireVersionCursor(
            UUID cursor, UUID guideId) {
        int version =
                (int) (cursor.getLeastSignificantBits() & 0xFFFF_FFFFL);
        if (version < 1 || !cursor.equals(versionCursor(guideId, version))) {
            throw new ResourceNotFoundException();
        }
        try {
            Instant createdAt =
                    jdbcTemplate.queryForObject(
                            """
                            SELECT created_at
                            FROM cancellation_guide_versions
                            WHERE guide_id = ? AND version = ?
                            """,
                            (row, rowNumber) -> instant(row, "created_at"),
                            guideId,
                            version);
            return new GuideVersionCursor(version, createdAt);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private static UUID versionCursor(UUID guideId, int version) {
        try {
            byte[] digest =
                    MessageDigest.getInstance("SHA-256")
                            .digest(
                                    (guideId + "|" + version)
                                            .getBytes(StandardCharsets.UTF_8));
            ByteBuffer fingerprint = ByteBuffer.wrap(digest);
            long mostSignificantBits = fingerprint.getLong();
            long leastSignificantBits =
                    (Integer.toUnsignedLong(fingerprint.getInt()) << 32)
                            | Integer.toUnsignedLong(version);
            return new UUID(mostSignificantBits, leastSignificantBits);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(
                    "SHA-256 is required for guide-version cursors.",
                    exception);
        }
    }

    private static void requirePageLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ValidationException("limit must be between 1 and 100.");
        }
    }

    private static AdminCancellationGuideSummaryResponse mapGuideSummary(
            ResultSet row, int rowNumber) throws SQLException {
        return new AdminCancellationGuideSummaryResponse(
                row.getObject("guide_id", UUID.class),
                row.getObject("merchant_id", UUID.class),
                row.getString("merchant_name"),
                row.getString("merchant_category"),
                row.getString("state"),
                nullableInteger(row, "current_published_version"),
                row.getLong("optimistic_version"),
                instant(row, "updated_at"));
    }

    private static AdminCancellationGuideVersionResponse mapGuideVersion(
            ResultSet row, int rowNumber) throws SQLException {
        Object draftVersion = row.getObject("draft_version");
        return new AdminCancellationGuideVersionResponse(
                row.getObject("guide_id", UUID.class),
                row.getInt("guide_version"),
                GuideStatus.valueOf(row.getString("status")),
                row.getString("risk_notice"),
                instant(row, "structural_reviewed_at"),
                row.getInt("review_interval_days"),
                nullableInstant(row, "published_at"),
                instant(row, "created_at"),
                row.getObject("draft_id", UUID.class),
                draftVersion == null ? null : ((Number) draftVersion).longValue());
    }

    private static Integer nullableInteger(ResultSet row, String column)
            throws SQLException {
        Object value = row.getObject(column);
        return value == null ? null : ((Number) value).intValue();
    }

    private static Instant instant(ResultSet row, String column)
            throws SQLException {
        return row.getObject(column, OffsetDateTime.class).toInstant();
    }

    private static Instant nullableInstant(ResultSet row, String column)
            throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private record CatalogHead(
            UUID guideId,
            Integer currentPublishedVersion,
            String state,
            long optimisticVersion) {}

    private record SourceVersion(
            int version,
            String riskNotice,
            Instant structuralReviewedAt,
            int reviewIntervalDays) {}

    private record DraftIdentity(
            UUID draftId,
            UUID guideId,
            int guideVersion,
            long optimisticVersion,
            GuideStatus status) {}

    private record DraftHeader(
            UUID draftId,
            UUID guideId,
            int guideVersion,
            GuideStatus status,
            String riskNotice,
            Instant structuralReviewedAt,
            int reviewIntervalDays,
            long optimisticVersion,
            Instant createdAt,
            Instant updatedAt) {}

    private record StepKey(GuideTrackKind track, int sequenceNumber) {}

    private record GuideVersionCursor(int version, Instant createdAt) {}

    private enum GuideLifecycleAction {
        DRAFT_CREATED,
        DRAFT_SAVED,
        PUBLISHED,
        RETIRED
    }
}
