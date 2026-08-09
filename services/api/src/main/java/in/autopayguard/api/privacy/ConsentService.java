package in.autopayguard.api.privacy;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
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
import org.springframework.transaction.annotation.Transactional;

@Service
public class ConsentService {

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final PrivacyNoticeService privacyNoticeService;
    private final M5IdempotencyService idempotencyService;
    private final AuditService auditService;
    private final Clock clock;

    ConsentService(
            JdbcTemplate jdbcTemplate,
            CurrentUserService currentUserService,
            PrivacyNoticeService privacyNoticeService,
            M5IdempotencyService idempotencyService,
            AuditService auditService,
            Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.privacyNoticeService = privacyNoticeService;
        this.idempotencyService = idempotencyService;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ConsentCollectionResponse list(Jwt jwt, UUID cursor, int limit) {
        CurrentUser user = currentUserService.resolve(jwt);
        return collection(user.id(), cursor, limit);
    }

    @Transactional
    public ConsentEventResponse record(
            Jwt jwt, String idempotencyKey, RecordConsentRequest request) {
        CurrentUser user = currentUserService.resolve(jwt);
        String version = request.purposeVersion().strip();
        if (!privacyNoticeService.currentVersion().equals(version)) {
            throw new RequestConflictException(
                    "The consent purpose must be pinned to the current privacy notice.");
        }
        Claim claim =
                idempotencyService.begin(
                        user.id(),
                        Operation.CONSENT_EVENT,
                        idempotencyKey,
                        List.of(
                                request.purpose().name(),
                                version,
                                request.action().name()));
        if (claim.replay()) {
            return idempotencyService.replay(claim, ConsentEventResponse.class);
        }

        ConsentEventResponse latest = latest(user.id());
        if (latest != null
                && version.equals(latest.purposeVersion())
                && latest.action() == request.action()) {
            throw new RequestConflictException(
                    "The household-sharing consent is already in that state.");
        }
        if (request.action() == ConsentAction.GRANTED
                && !privacyNoticeService.hasCurrentAcknowledgement(user.id())) {
            throw new RequestConflictException(
                    "Acknowledge the current privacy notice before granting household sharing.");
        }

        UUID eventId = UUID.randomUUID();
        Instant now = clock.instant();
        Object[] values = {
            eventId,
            user.id(),
            request.purpose().name(),
            version,
            request.action().name(),
            now,
            now
        };
        jdbcTemplate.update(
                """
                INSERT INTO consent_events (
                    id, user_id, purpose, purpose_version,
                    action, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        jdbcTemplate.update(
                """
                INSERT INTO consent_event_locks (
                    id, user_id, purpose, purpose_version,
                    action, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        ConsentEventResponse response =
                new ConsentEventResponse(
                        eventId,
                        request.purpose(),
                        version,
                        request.action(),
                        now);
        idempotencyService.complete(
                user.id(),
                Operation.CONSENT_EVENT,
                claim,
                eventId,
                201,
                response,
                null);
        auditService.record(
                user.id(),
                ActorRole.USER,
                Action.CONSENT_RECORDED,
                ResourceType.CONSENT_EVENT,
                eventId);
        return response;
    }

    @Transactional(readOnly = true)
    public boolean isSharingGranted(UUID userId) {
        ConsentEventResponse latest = latest(userId);
        return latest != null
                && latest.action() == ConsentAction.GRANTED
                && privacyNoticeService.currentVersion()
                        .equals(latest.purposeVersion())
                && privacyNoticeService.hasCurrentAcknowledgement(userId);
    }

    private ConsentCollectionResponse collection(
            UUID userId, UUID cursor, int limit) {
        requirePageLimit(limit);
        List<Object> arguments = new ArrayList<>();
        arguments.add(userId);
        String cursorPredicate = "";
        if (cursor != null) {
            ConsentCursor value = requireCursor(cursor, userId);
            cursorPredicate =
                    """
                     AND (
                         occurred_at < ?
                         OR (occurred_at = ? AND id < ?)
                     )
                    """;
            arguments.add(value.occurredAt());
            arguments.add(value.occurredAt());
            arguments.add(value.id());
        }
        arguments.add(limit + 1);
        List<ConsentEventResponse> rows =
                jdbcTemplate.query(
                        """
                        SELECT id, purpose, purpose_version, action, occurred_at
                        FROM consent_events
                        WHERE user_id = ? AND purpose = 'HOUSEHOLD_SHARING'
                        """
                                + cursorPredicate
                                + """
                                ORDER BY occurred_at DESC, id DESC
                                LIMIT ?
                                """,
                        ConsentService::mapEvent,
                        arguments.toArray());
        boolean hasMore = rows.size() > limit;
        List<ConsentEventResponse> events =
                hasMore
                        ? List.copyOf(rows.subList(0, limit))
                        : List.copyOf(rows);
        ConsentEventResponse latest = latest(userId);
        ConsentEventResponse current =
                latest != null
                                && privacyNoticeService.currentVersion()
                                        .equals(latest.purposeVersion())
                        ? latest
                        : null;
        return new ConsentCollectionResponse(
                ConsentPurpose.HOUSEHOLD_SHARING,
                current == null ? null : current.purposeVersion(),
                current == null ? null : current.action(),
                events,
                hasMore && !events.isEmpty()
                        ? events.getLast().id()
                        : null);
    }

    private ConsentCursor requireCursor(UUID cursor, UUID userId) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT id, occurred_at
                    FROM consent_events
                    WHERE id = ? AND user_id = ?
                      AND purpose = 'HOUSEHOLD_SHARING'
                    """,
                    (row, rowNumber) ->
                            new ConsentCursor(
                                    row.getObject("id", UUID.class),
                                    row.getObject(
                                                    "occurred_at",
                                                    java.time.OffsetDateTime
                                                            .class)
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

    private ConsentEventResponse latest(UUID userId) {
        List<ConsentEventResponse> events =
                jdbcTemplate.query(
                        """
                        SELECT id, purpose, purpose_version, action, occurred_at
                        FROM consent_events
                        WHERE user_id = ? AND purpose = 'HOUSEHOLD_SHARING'
                        ORDER BY occurred_at DESC, id DESC
                        LIMIT 1
                        """,
                        ConsentService::mapEvent,
                        userId);
        return events.isEmpty() ? null : events.getFirst();
    }

    private static ConsentEventResponse mapEvent(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new ConsentEventResponse(
                resultSet.getObject("id", UUID.class),
                ConsentPurpose.valueOf(resultSet.getString("purpose")),
                resultSet.getString("purpose_version"),
                ConsentAction.valueOf(resultSet.getString("action")),
                resultSet.getObject("occurred_at", java.time.OffsetDateTime.class)
                        .toInstant());
    }

    private record ConsentCursor(UUID id, Instant occurredAt) {}
}
