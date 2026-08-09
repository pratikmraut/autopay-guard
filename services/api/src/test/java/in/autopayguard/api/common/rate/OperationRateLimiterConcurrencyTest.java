package in.autopayguard.api.common.rate;

import static org.assertj.core.api.Assertions.assertThat;

import in.autopayguard.api.common.error.RateLimitExceededException;
import in.autopayguard.api.common.rate.OperationRateLimiter.Operation;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class OperationRateLimiterConcurrencyTest {

    @Autowired private OperationRateLimiter rateLimiter;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void databaseLockSerializesConcurrentChecksAcrossServiceCallers()
            throws Exception {
        String subject = "m6-rate-concurrent-" + java.util.UUID.randomUUID();
        String actorKey = OperationRateLimiter.actorKeyForSubject(subject);
        Jwt jwt =
                Jwt.withTokenValue("test")
                        .header("alg", "none")
                        .subject(subject)
                        .issuedAt(Instant.now())
                        .expiresAt(Instant.now().plusSeconds(300))
                        .build();
        int callers = 12;
        CountDownLatch ready = new CountDownLatch(callers);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Boolean>> results = new ArrayList<>();
        try (var executor = Executors.newFixedThreadPool(callers)) {
            for (int index = 0; index < callers; index++) {
                results.add(
                        executor.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    try {
                                        rateLimiter.check(
                                                jwt, Operation.IMPORT_CREATE);
                                        return true;
                                    } catch (RateLimitExceededException exception) {
                                        return false;
                                    }
                                }));
            }
            ready.await();
            start.countDown();
            long successes = 0;
            for (Future<Boolean> result : results) {
                if (result.get()) {
                    successes++;
                }
            }
            assertThat(successes).isEqualTo(10);
        }

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM operation_rate_events
                                WHERE actor_key = ? AND operation = 'IMPORT_CREATE'
                                """,
                                Integer.class,
                                actorKey))
                .isEqualTo(10);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM operation_rate_locks
                                WHERE actor_key = ? AND operation = 'IMPORT_CREATE'
                                """,
                                Integer.class,
                                actorKey))
                .isEqualTo(1);
    }

    @Test
    void cleanupRemovesOnlyBoundedRowsOlderThanMaximumWindow() {
        String actorKey = "a".repeat(64);
        Instant old = Instant.now().minusSeconds(10_800);
        jdbcTemplate.update(
                """
                INSERT INTO operation_rate_locks (
                    actor_key, operation, touched_at
                ) VALUES (?, 'IMPORT_CONFIRM', ?)
                """,
                actorKey,
                old);
        jdbcTemplate.update(
                """
                INSERT INTO operation_rate_events (
                    id, actor_key, operation, occurred_at
                ) VALUES (?, ?, 'IMPORT_CONFIRM', ?)
                """,
                java.util.UUID.randomUUID(),
                actorKey,
                old);

        rateLimiter.cleanupExpiredRows();

        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM operation_rate_events WHERE actor_key = ?",
                                Integer.class,
                                actorKey))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM operation_rate_locks WHERE actor_key = ?",
                                Integer.class,
                                actorKey))
                .isZero();
    }

    @Test
    void checkReinitializesAnAbsentDurableLockRow() {
        String subject = "m6-rate-missing-lock-" + java.util.UUID.randomUUID();
        String actorKey = OperationRateLimiter.actorKeyForSubject(subject);
        Jwt jwt =
                Jwt.withTokenValue("test")
                        .header("alg", "none")
                        .subject(subject)
                        .issuedAt(Instant.now())
                        .expiresAt(Instant.now().plusSeconds(300))
                        .build();
        jdbcTemplate.update(
                "DELETE FROM operation_rate_locks WHERE actor_key = ?",
                actorKey);

        rateLimiter.check(jwt, Operation.IMPORT_CONFIRM);

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM operation_rate_locks
                                WHERE actor_key = ? AND operation = 'IMPORT_CONFIRM'
                                """,
                                Integer.class,
                                actorKey))
                .isEqualTo(1);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM operation_rate_events
                                WHERE actor_key = ? AND operation = 'IMPORT_CONFIRM'
                                """,
                                Integer.class,
                                actorKey))
                .isEqualTo(1);
    }
}
