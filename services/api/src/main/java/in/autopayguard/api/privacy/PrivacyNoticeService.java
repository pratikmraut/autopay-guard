package in.autopayguard.api.privacy;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
import in.autopayguard.api.common.config.PrivacyProperties;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.common.idempotency.M5IdempotencyService;
import in.autopayguard.api.common.idempotency.M5IdempotencyService.Claim;
import in.autopayguard.api.common.idempotency.M5IdempotencyService.Operation;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PrivacyNoticeService {

    static final String FOUNDATION_CONTENT_SHA256 =
            "f44a66e435a10f110c1b2eff19abcf60f4978053205c9068c08c6a8bae74b244";

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final M5IdempotencyService idempotencyService;
    private final AuditService auditService;
    private final PrivacyProperties privacyProperties;
    private final Clock clock;

    PrivacyNoticeService(
            JdbcTemplate jdbcTemplate,
            CurrentUserService currentUserService,
            M5IdempotencyService idempotencyService,
            AuditService auditService,
            PrivacyProperties privacyProperties,
            Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.idempotencyService = idempotencyService;
        this.auditService = auditService;
        this.privacyProperties = privacyProperties;
        this.clock = clock;
    }

    public PrivacyNoticeResponse current() {
        return new PrivacyNoticeResponse(
                privacyProperties.noticeVersion(),
                FOUNDATION_CONTENT_SHA256,
                "ACKNOWLEDGED");
    }

    String currentVersion() {
        return privacyProperties.noticeVersion();
    }

    @Transactional(readOnly = true)
    public PrivacyNoticeAcknowledgementCollectionResponse list(
            Jwt jwt, UUID cursor, int limit) {
        requirePageLimit(limit);
        CurrentUser user = currentUserService.resolve(jwt);
        List<Object> arguments = new ArrayList<>();
        arguments.add(user.id());
        String cursorPredicate = "";
        if (cursor != null) {
            NoticeCursor value = requireCursor(cursor, user.id());
            cursorPredicate =
                    """
                     AND (
                         acknowledged_at < ?
                         OR (acknowledged_at = ? AND id < ?)
                     )
                    """;
            arguments.add(value.acknowledgedAt());
            arguments.add(value.acknowledgedAt());
            arguments.add(value.id());
        }
        arguments.add(limit + 1);
        List<PrivacyNoticeAcknowledgementResponse> rows =
                jdbcTemplate.query(
                        """
                        SELECT id, notice_version, content_digest,
                               event_type, acknowledged_at
                        FROM privacy_notice_acknowledgements
                        WHERE user_id = ?
                        """
                                + cursorPredicate
                                + """
                                ORDER BY acknowledged_at DESC, id DESC
                                LIMIT ?
                                """,
                        PrivacyNoticeService::mapAcknowledgement,
                        arguments.toArray());
        boolean hasMore = rows.size() > limit;
        List<PrivacyNoticeAcknowledgementResponse> items =
                hasMore
                        ? List.copyOf(rows.subList(0, limit))
                        : List.copyOf(rows);
        return new PrivacyNoticeAcknowledgementCollectionResponse(
                items,
                hasMore && !items.isEmpty()
                        ? items.getLast().id()
                        : null);
    }

    @Transactional
    public PrivacyNoticeAcknowledgementResponse acknowledge(
            Jwt jwt,
            String idempotencyKey,
            AcknowledgePrivacyNoticeRequest request) {
        CurrentUser user = currentUserService.resolve(jwt);
        String version = request.noticeVersion().strip();
        requireCurrentVersion(version);
        Claim claim =
                idempotencyService.begin(
                        user.id(),
                        Operation.NOTICE_ACKNOWLEDGEMENT,
                        idempotencyKey,
                        List.of(version, FOUNDATION_CONTENT_SHA256));
        if (claim.replay()) {
            return idempotencyService.replay(
                    claim, PrivacyNoticeAcknowledgementResponse.class);
        }
        PrivacyNoticeAcknowledgementResponse response =
                recordIfAbsent(user.id(), version, clock.instant());
        idempotencyService.complete(
                user.id(),
                Operation.NOTICE_ACKNOWLEDGEMENT,
                claim,
                response.id(),
                201,
                response,
                null);
        return response;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public PrivacyNoticeAcknowledgementResponse recordForOnboarding(
            UUID userId, String noticeVersion, Instant acknowledgedAt) {
        requireCurrentVersion(noticeVersion);
        return recordIfAbsent(userId, noticeVersion, acknowledgedAt);
    }

    @Transactional(readOnly = true)
    public boolean hasCurrentAcknowledgement(UUID userId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM privacy_notice_acknowledgements
                        WHERE user_id = ? AND notice_version = ?
                          AND content_digest = ? AND event_type = 'ACKNOWLEDGED'
                        """,
                        Integer.class,
                        userId,
                        privacyProperties.noticeVersion(),
                        FOUNDATION_CONTENT_SHA256);
        return count != null && count > 0;
    }

    private PrivacyNoticeAcknowledgementResponse recordIfAbsent(
            UUID userId, String noticeVersion, Instant acknowledgedAt) {
        List<PrivacyNoticeAcknowledgementResponse> existing =
                jdbcTemplate.query(
                        """
                        SELECT id, notice_version, content_digest,
                               event_type, acknowledged_at
                        FROM privacy_notice_acknowledgements
                        WHERE user_id = ? AND notice_version = ?
                        """,
                        PrivacyNoticeService::mapAcknowledgement,
                        userId,
                        noticeVersion);
        if (!existing.isEmpty()) {
            return existing.getFirst();
        }
        UUID id = UUID.randomUUID();
        Object[] values = {
            id,
            userId,
            noticeVersion,
            FOUNDATION_CONTENT_SHA256,
            "ACKNOWLEDGED",
            acknowledgedAt,
            acknowledgedAt
        };
        jdbcTemplate.update(
                """
                INSERT INTO privacy_notice_acknowledgements (
                    id, user_id, notice_version, content_digest,
                    event_type, acknowledged_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        jdbcTemplate.update(
                """
                INSERT INTO privacy_notice_acknowledgement_locks (
                    id, user_id, notice_version, content_digest,
                    event_type, acknowledged_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        auditService.record(
                userId,
                ActorRole.USER,
                Action.PRIVACY_NOTICE_ACKNOWLEDGED,
                ResourceType.NOTICE_ACKNOWLEDGEMENT,
                id);
        return new PrivacyNoticeAcknowledgementResponse(
                id,
                noticeVersion,
                FOUNDATION_CONTENT_SHA256,
                "ACKNOWLEDGED",
                acknowledgedAt);
    }

    private NoticeCursor requireCursor(UUID cursor, UUID userId) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT id, acknowledged_at
                    FROM privacy_notice_acknowledgements
                    WHERE id = ? AND user_id = ?
                    """,
                    (row, rowNumber) ->
                            new NoticeCursor(
                                    row.getObject("id", UUID.class),
                                    row.getTimestamp("acknowledged_at")
                                            .toInstant()),
                    cursor,
                    userId);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private static void requirePageLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ValidationException("limit must be between 1 and 100.");
        }
    }

    private void requireCurrentVersion(String noticeVersion) {
        if (!privacyProperties.noticeVersion().equals(noticeVersion)) {
            throw new RequestConflictException(
                    "The privacy notice version is no longer current.");
        }
    }

    private static PrivacyNoticeAcknowledgementResponse mapAcknowledgement(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new PrivacyNoticeAcknowledgementResponse(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("notice_version"),
                resultSet.getString("content_digest"),
                resultSet.getString("event_type"),
                resultSet.getTimestamp("acknowledged_at").toInstant());
    }

    private record NoticeCursor(UUID id, Instant acknowledgedAt) {}
}
