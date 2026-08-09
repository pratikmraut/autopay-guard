package in.autopayguard.api.audit;

import in.autopayguard.api.common.error.CorrelationIdFilter;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditService {

    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    AuditService(JdbcTemplate jdbcTemplate, Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID record(
            UUID actorUserId,
            ActorRole actorRole,
            Action action,
            ResourceType resourceType,
            UUID resourceId) {
        UUID id = UUID.randomUUID();
        Instant now = clock.instant();
        String correlationId = MDC.get(CorrelationIdFilter.MDC_KEY);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = UUID.randomUUID().toString();
        }
        Object[] values = {
            id,
            actorUserId,
            actorRole.name(),
            action.name(),
            resourceType.name(),
            resourceId,
            "SUCCEEDED",
            correlationId,
            now,
            now
        };
        jdbcTemplate.update(
                """
                INSERT INTO audit_events (
                    id, actor_user_id, actor_role, action, resource_type,
                    resource_id, outcome, correlation_id, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        jdbcTemplate.update(
                """
                INSERT INTO audit_event_locks (
                    id, actor_user_id, actor_role, action, resource_type,
                    resource_id, outcome, correlation_id, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        return id;
    }

    public enum ActorRole {
        USER,
        GUIDE_ADMIN,
        PRIVACY_ADMIN,
        AUDIT_READ,
        SUPPORT_READ
    }

    public enum Action {
        PRIVACY_NOTICE_ACKNOWLEDGED,
        HOUSEHOLD_INVITATION_CREATED,
        HOUSEHOLD_INVITATION_ACCEPTED,
        HOUSEHOLD_INVITATION_REVOKED,
        HOUSEHOLD_INVITATION_EXPIRED,
        HOUSEHOLD_MEMBER_REMOVED,
        COMMITMENT_SHARING_CHANGED,
        CONSENT_RECORDED,
        PRIVACY_REQUEST_CREATED,
        PRIVACY_REQUEST_CANCELLED,
        PRIVACY_REQUESTS_VIEWED,
        PRIVACY_EXPORT_GENERATED,
        PRIVACY_EXPORT_DOWNLOADED,
        PRIVACY_EXPORT_EXPIRED,
        PRIVACY_CORRECTION_EXECUTED,
        PRIVACY_DELETION_BLOCKED,
        PRIVACY_DELETION_EXECUTED,
        GUIDE_DRAFT_CREATED,
        GUIDE_DRAFT_SAVED,
        GUIDE_PUBLISHED,
        GUIDE_RETIRED,
        GUIDE_FEEDBACK_REVIEWED,
        SUPPORT_GRANT_CREATED,
        SUPPORT_GRANT_REVOKED,
        SUPPORT_GRANT_EXPIRED,
        SUPPORT_DIAGNOSTICS_VIEWED,
        AUDIT_EVENTS_VIEWED,
        IMPORT_PREVIEW_CREATED,
        IMPORT_CONFIRMED,
        IMPORT_DISCARDED,
        IMPORT_PREVIEW_EXPIRED
    }

    public enum ResourceType {
        NOTICE_ACKNOWLEDGEMENT,
        HOUSEHOLD_INVITATION,
        HOUSEHOLD_MEMBER,
        RECURRING_COMMITMENT,
        CONSENT_EVENT,
        PRIVACY_REQUEST,
        CANCELLATION_GUIDE,
        GUIDE_FEEDBACK,
        SUPPORT_GRANT,
        AUDIT_QUERY,
        IMPORT_JOB
    }
}
