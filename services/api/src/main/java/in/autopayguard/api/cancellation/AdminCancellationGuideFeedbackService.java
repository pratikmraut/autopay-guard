package in.autopayguard.api.cancellation;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.common.idempotency.M5IdempotencyService;
import in.autopayguard.api.common.idempotency.M5IdempotencyService.Operation;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class AdminCancellationGuideFeedbackService {

    private final CurrentUserService currentUserService;
    private final M5IdempotencyService idempotencyService;
    private final AuditService auditService;
    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    AdminCancellationGuideFeedbackService(
            CurrentUserService currentUserService,
            M5IdempotencyService idempotencyService,
            AuditService auditService,
            JdbcTemplate jdbcTemplate,
            Clock clock) {
        this.currentUserService = currentUserService;
        this.idempotencyService = idempotencyService;
        this.auditService = auditService;
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    @Transactional
    AdminCancellationGuideFeedbackCollectionResponse list(
            Jwt jwt, UUID cursor, int limit) {
        currentUserService.resolve(jwt);
        List<Object> arguments = new ArrayList<>();
        String cursorPredicate = "";
        if (cursor != null) {
            FeedbackCursor value = requireCursor(cursor);
            cursorPredicate =
                    """
                     WHERE (
                         f.created_at < ?
                         OR (f.created_at = ? AND f.id < ?)
                     )
                    """;
            arguments.add(value.createdAt());
            arguments.add(value.createdAt());
            arguments.add(value.id());
        }
        arguments.add(limit + 1);
        List<AdminCancellationGuideFeedbackResponse> rows =
                jdbcTemplate.query(
                        """
                        SELECT f.id, f.guide_id, f.guide_version,
                               f.outcome, f.created_at,
                               COALESCE(r.disposition, 'PENDING') AS disposition,
                               COALESCE(r.optimistic_version, 0) AS review_version
                        FROM cancellation_guide_feedback f
                        LEFT JOIN guide_feedback_reviews r
                          ON r.feedback_id = f.id
                        """
                                + cursorPredicate
                                + """
                                ORDER BY f.created_at DESC, f.id DESC
                                LIMIT ?
                                """,
                        AdminCancellationGuideFeedbackService::mapFeedback,
                        arguments.toArray());
        boolean hasMore = rows.size() > limit;
        List<AdminCancellationGuideFeedbackResponse> items =
                hasMore ? List.copyOf(rows.subList(0, limit)) : List.copyOf(rows);
        UUID nextCursor =
                hasMore && !items.isEmpty()
                        ? items.getLast().id()
                        : null;
        return new AdminCancellationGuideFeedbackCollectionResponse(
                items, nextCursor);
    }

    @Transactional
    AdminCancellationGuideFeedbackResponse review(
            Jwt jwt,
            UUID feedbackId,
            long expectedVersion,
            String idempotencyKey,
            ReviewAdminCancellationGuideFeedbackRequest request) {
        CurrentUser admin = currentUserService.resolve(jwt);
        M5IdempotencyService.Claim claim =
                idempotencyService.begin(
                        admin.id(),
                        Operation.FEEDBACK_REVIEW,
                        idempotencyKey,
                        List.of(
                                feedbackId.toString(),
                                Long.toString(expectedVersion),
                                request.disposition().name()));
        if (claim.replay()) {
            return idempotencyService.replay(
                    claim, AdminCancellationGuideFeedbackResponse.class);
        }

        lockFeedback(feedbackId);
        List<Map<String, Object>> reviews =
                jdbcTemplate.queryForList(
                        """
                        SELECT optimistic_version
                        FROM guide_feedback_reviews
                        WHERE feedback_id = ?
                        FOR UPDATE
                        """,
                        feedbackId);
        Instant now = clock.instant();
        long newVersion;
        if (reviews.isEmpty()) {
            if (expectedVersion != 0) {
                throw new PreconditionFailedException();
            }
            newVersion = 1;
            jdbcTemplate.update(
                    """
                    INSERT INTO guide_feedback_reviews (
                        feedback_id, disposition, optimistic_version,
                        reviewed_by_user_id, reviewed_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    feedbackId,
                    request.disposition().name(),
                    newVersion,
                    admin.id(),
                    now,
                    now,
                    now);
        } else {
            long currentVersion =
                    ((Number) reviews.getFirst().get("optimistic_version"))
                            .longValue();
            if (currentVersion != expectedVersion) {
                throw new PreconditionFailedException();
            }
            newVersion = currentVersion + 1;
            int changed =
                    jdbcTemplate.update(
                            """
                            UPDATE guide_feedback_reviews
                            SET disposition = ?,
                                optimistic_version = ?,
                                reviewed_by_user_id = ?,
                                reviewed_at = ?,
                                updated_at = ?
                            WHERE feedback_id = ?
                              AND optimistic_version = ?
                            """,
                            request.disposition().name(),
                            newVersion,
                            admin.id(),
                            now,
                            now,
                            feedbackId,
                            expectedVersion);
            if (changed != 1) {
                throw new PreconditionFailedException();
            }
        }
        auditService.record(
                admin.id(),
                ActorRole.GUIDE_ADMIN,
                Action.GUIDE_FEEDBACK_REVIEWED,
                ResourceType.GUIDE_FEEDBACK,
                feedbackId);
        AdminCancellationGuideFeedbackResponse response =
                requireFeedback(feedbackId);
        idempotencyService.complete(
                admin.id(),
                Operation.FEEDBACK_REVIEW,
                claim,
                feedbackId,
                200,
                response,
                newVersion);
        return response;
    }

    private FeedbackCursor requireCursor(UUID cursor) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT id, created_at
                    FROM cancellation_guide_feedback
                    WHERE id = ?
                    """,
                    (row, rowNumber) ->
                            new FeedbackCursor(
                                    row.getObject("id", UUID.class),
                                    instant(row, "created_at")),
                    cursor);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private void lockFeedback(UUID feedbackId) {
        try {
            jdbcTemplate.queryForObject(
                    """
                    SELECT id
                    FROM cancellation_guide_feedback
                    WHERE id = ?
                    FOR UPDATE
                    """,
                    UUID.class,
                    feedbackId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private AdminCancellationGuideFeedbackResponse requireFeedback(
            UUID feedbackId) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT f.id, f.guide_id, f.guide_version,
                           f.outcome, f.created_at,
                           COALESCE(r.disposition, 'PENDING') AS disposition,
                           COALESCE(r.optimistic_version, 0) AS review_version
                    FROM cancellation_guide_feedback f
                    LEFT JOIN guide_feedback_reviews r
                      ON r.feedback_id = f.id
                    WHERE f.id = ?
                    """,
                    AdminCancellationGuideFeedbackService::mapFeedback,
                    feedbackId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private static AdminCancellationGuideFeedbackResponse mapFeedback(
            ResultSet row, int rowNumber) throws SQLException {
        return new AdminCancellationGuideFeedbackResponse(
                row.getObject("id", UUID.class),
                row.getObject("guide_id", UUID.class),
                row.getInt("guide_version"),
                GuideFeedbackOutcome.valueOf(row.getString("outcome")),
                instant(row, "created_at"),
                AdminGuideFeedbackDisposition.valueOf(
                        row.getString("disposition")),
                row.getLong("review_version"));
    }

    private static Instant instant(ResultSet row, String column)
            throws SQLException {
        return row.getObject(column, OffsetDateTime.class).toInstant();
    }

    private record FeedbackCursor(UUID id, Instant createdAt) {}
}
