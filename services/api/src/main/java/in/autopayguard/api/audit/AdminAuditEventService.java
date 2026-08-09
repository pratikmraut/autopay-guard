package in.autopayguard.api.audit;

import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class AdminAuditEventService {

    private final CurrentUserService currentUserService;
    private final AuditService auditService;
    private final JdbcTemplate jdbcTemplate;

    AdminAuditEventService(
            CurrentUserService currentUserService,
            AuditService auditService,
            JdbcTemplate jdbcTemplate) {
        this.currentUserService = currentUserService;
        this.auditService = auditService;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    AdminAuditEventCollectionResponse list(Jwt jwt, UUID cursor, int limit) {
        CurrentUser reader = currentUserService.resolve(jwt);
        List<Object> arguments = new ArrayList<>();
        String cursorPredicate = "";
        if (cursor != null) {
            AuditCursor value = requireCursor(cursor);
            cursorPredicate =
                    """
                     WHERE (
                         occurred_at < ?
                         OR (occurred_at = ? AND id < ?)
                     )
                    """;
            arguments.add(value.occurredAt());
            arguments.add(value.occurredAt());
            arguments.add(value.id());
        }
        arguments.add(limit + 1);
        List<AdminAuditEventResponse> rows =
                jdbcTemplate.query(
                        """
                        SELECT id, occurred_at, actor_role, action,
                               resource_type, resource_id, outcome,
                               correlation_id
                        FROM audit_events
                        """
                                + cursorPredicate
                                + """
                                ORDER BY occurred_at DESC, id DESC
                                LIMIT ?
                                """,
                        AdminAuditEventService::mapEvent,
                        arguments.toArray());
        boolean hasMore = rows.size() > limit;
        List<AdminAuditEventResponse> items =
                hasMore ? List.copyOf(rows.subList(0, limit)) : List.copyOf(rows);
        UUID nextCursor =
                hasMore && !items.isEmpty()
                        ? items.getLast().id()
                        : null;

        auditService.record(
                reader.id(),
                AuditService.ActorRole.AUDIT_READ,
                AuditService.Action.AUDIT_EVENTS_VIEWED,
                AuditService.ResourceType.AUDIT_QUERY,
                UUID.randomUUID());
        return new AdminAuditEventCollectionResponse(items, nextCursor);
    }

    private AuditCursor requireCursor(UUID cursor) {
        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT id, occurred_at
                    FROM audit_events
                    WHERE id = ?
                    """,
                    (row, rowNumber) ->
                            new AuditCursor(
                                    row.getObject("id", UUID.class),
                                    instant(row, "occurred_at")),
                    cursor);
        } catch (EmptyResultDataAccessException exception) {
            throw new ResourceNotFoundException();
        }
    }

    private static AdminAuditEventResponse mapEvent(
            ResultSet row, int rowNumber) throws SQLException {
        return new AdminAuditEventResponse(
                row.getObject("id", UUID.class),
                instant(row, "occurred_at"),
                AuditService.ActorRole.valueOf(row.getString("actor_role")),
                AuditService.Action.valueOf(row.getString("action")),
                AuditService.ResourceType.valueOf(
                        row.getString("resource_type")),
                row.getObject("resource_id", UUID.class),
                row.getString("outcome"),
                row.getString("correlation_id"));
    }

    private static Instant instant(ResultSet row, String column)
            throws SQLException {
        return row.getObject(column, OffsetDateTime.class).toInstant();
    }

    private record AuditCursor(UUID id, Instant occurredAt) {}
}
