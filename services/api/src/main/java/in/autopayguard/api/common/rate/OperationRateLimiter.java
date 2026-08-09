package in.autopayguard.api.common.rate;

import in.autopayguard.api.common.concurrency.UserMutationFenceService;
import in.autopayguard.api.common.error.RateLimitExceededException;
import in.autopayguard.api.common.security.OpaqueCodes;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OperationRateLimiter {

    private static final String ACTOR_KEY_DOMAIN =
            "autopay-guard/operation-rate/v1:";
    private static final Duration RETENTION = Duration.ofHours(2);
    private static final int CLEANUP_BATCH_SIZE = 1_000;
    private static final int LOCK_INITIALIZATION_ATTEMPTS = 2;

    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;
    private final UserMutationFenceService userMutationFenceService;

    OperationRateLimiter(
            JdbcTemplate jdbcTemplate,
            Clock clock,
            UserMutationFenceService userMutationFenceService) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
        this.userMutationFenceService = userMutationFenceService;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void check(Jwt jwt, Operation operation) {
        checkLockedActor(jwt, operation);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkImport(
            Jwt jwt, UUID ownerUserId, Operation operation) {
        if (operation != Operation.IMPORT_CREATE
                && operation != Operation.IMPORT_CONFIRM) {
            throw new IllegalArgumentException(
                    "Only import operations may use the user-fenced rate path.");
        }
        userMutationFenceService.lockLiveUser(ownerUserId);
        checkLockedActor(jwt, operation);
    }

    private void checkLockedActor(Jwt jwt, Operation operation) {
        String actorKey = actorKeyForSubject(jwt.getSubject());
        Instant now = clock.instant();
        lockOrReinitialize(actorKey, operation, now);
        checkLocked(actorKey, operation, now);
    }

    private void lockOrReinitialize(
            String actorKey, Operation operation, Instant now) {
        for (int attempt = 0;
                attempt < LOCK_INITIALIZATION_ATTEMPTS;
                attempt++) {
            ensureLockRow(actorKey, operation, now);
            int locked =
                    jdbcTemplate.update(
                            """
                            UPDATE operation_rate_locks
                            SET touched_at = ?
                            WHERE actor_key = ? AND operation = ?
                            """,
                            now,
                            actorKey,
                            operation.name());
            if (locked == 1) {
                // UPDATE takes and retains the row lock for this transaction.
                return;
            }
        }
        throw new IllegalStateException(
                "Unable to initialize the operation rate-limit lock.");
    }

    private void ensureLockRow(
            String actorKey, Operation operation, Instant now) {
        String databaseProduct =
                jdbcTemplate.execute(
                        (ConnectionCallback<String>)
                                connection ->
                                        connection
                                                .getMetaData()
                                                .getDatabaseProductName());
        if ("PostgreSQL".equals(databaseProduct)) {
            jdbcTemplate.update(
                    """
                    INSERT INTO operation_rate_locks (
                        actor_key, operation, touched_at
                    ) VALUES (?, ?, ?)
                    ON CONFLICT (actor_key, operation) DO NOTHING
                    """,
                    actorKey,
                    operation.name(),
                    now);
            return;
        }
        if ("H2".equals(databaseProduct)) {
            jdbcTemplate.update(
                    """
                    MERGE INTO operation_rate_locks (
                        actor_key, operation, touched_at
                    ) KEY (actor_key, operation) VALUES (?, ?, ?)
                    """,
                    actorKey,
                    operation.name(),
                    now);
            return;
        }
        throw new IllegalStateException(
                "Unsupported database for durable operation-rate locking.");
    }

    public static String actorKeyForSubject(String subject) {
        if (subject == null || subject.isBlank()) {
            throw new jakarta.validation.ValidationException(
                    "The authenticated identity is missing its subject.");
        }
        return OpaqueCodes.sha256(ACTOR_KEY_DOMAIN + subject);
    }

    private void checkLocked(
            String actorKey, Operation operation, Instant now) {
        Instant windowStart = now.minus(operation.window());
        Integer count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM operation_rate_events
                        WHERE actor_key = ? AND operation = ? AND occurred_at >= ?
                        """,
                        Integer.class,
                        actorKey,
                        operation.name(),
                        windowStart);
        if (count != null && count >= operation.limit()) {
            throw new RateLimitExceededException(operation.window().toSeconds());
        }
        jdbcTemplate.update(
                """
                INSERT INTO operation_rate_events (
                    id, actor_key, operation, occurred_at
                ) VALUES (?, ?, ?, ?)
                """,
                UUID.randomUUID(),
                actorKey,
                operation.name(),
                now);
    }

    @Scheduled(
            fixedDelayString = "${app.rate-limit.cleanup-delay-ms:3600000}",
            initialDelayString = "${app.rate-limit.cleanup-initial-delay-ms:3600000}")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void cleanupExpiredRows() {
        Instant cutoff = clock.instant().minus(RETENTION);
        List<UUID> eventIds =
                jdbcTemplate.query(
                        """
                        SELECT id
                        FROM operation_rate_events
                        WHERE occurred_at < ?
                        ORDER BY occurred_at ASC, id ASC
                        LIMIT ?
                        """,
                        (row, rowNumber) -> row.getObject("id", UUID.class),
                        cutoff,
                        CLEANUP_BATCH_SIZE);
        for (UUID id : eventIds) {
            jdbcTemplate.update(
                    "DELETE FROM operation_rate_events WHERE id = ? AND occurred_at < ?",
                    id,
                    cutoff);
        }
        List<LockKey> locks =
                jdbcTemplate.query(
                        """
                        SELECT actor_key, operation
                        FROM operation_rate_locks
                        WHERE touched_at < ?
                        ORDER BY touched_at ASC, actor_key ASC, operation ASC
                        LIMIT ?
                        """,
                        (row, rowNumber) ->
                                new LockKey(
                                        row.getString("actor_key"),
                                        row.getString("operation")),
                        cutoff,
                        CLEANUP_BATCH_SIZE);
        for (LockKey lock : locks) {
            jdbcTemplate.update(
                    """
                    DELETE FROM operation_rate_locks
                    WHERE actor_key = ? AND operation = ? AND touched_at < ?
                    """,
                    lock.actorKey(),
                    lock.operation(),
                    cutoff);
        }
    }

    public enum Operation {
        INVITATION_CREATE(10, Duration.ofHours(1)),
        INVITATION_ACCEPT(20, Duration.ofHours(1)),
        PRIVACY_REQUEST(5, Duration.ofHours(1)),
        GUIDE_PUBLISH(10, Duration.ofHours(1)),
        SUPPORT_GRANT(5, Duration.ofHours(1)),
        SUPPORT_DIAGNOSTIC(20, Duration.ofHours(1)),
        IMPORT_CREATE(10, Duration.ofHours(1)),
        IMPORT_CONFIRM(20, Duration.ofHours(1));

        private final int limit;
        private final Duration window;

        Operation(int limit, Duration window) {
            this.limit = limit;
            this.window = window;
        }

        int limit() {
            return limit;
        }

        Duration window() {
            return window;
        }
    }

    private record LockKey(String actorKey, String operation) {}
}
