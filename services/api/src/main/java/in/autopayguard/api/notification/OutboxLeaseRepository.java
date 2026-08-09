package in.autopayguard.api.notification;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
class OutboxLeaseRepository {

    private static final String CLAIM =
            """
            WITH candidates AS (
                SELECT o.id
                FROM outbox_events o
                JOIN notification_deliveries d ON d.id = o.delivery_id
                WHERE o.status = 'PENDING'
                  AND o.available_at <= ?
                  AND d.status IN ('PENDING', 'RETRY_SCHEDULED')
                ORDER BY o.available_at ASC, o.id ASC
                LIMIT ?
                FOR UPDATE OF o, d SKIP LOCKED
            )
            UPDATE outbox_events o
            SET status = 'PROCESSING',
                lease_token = ?,
                lease_until = ?,
                attempt_count = attempt_count + 1,
                updated_at = ?
            FROM candidates c
            WHERE o.id = c.id
            RETURNING o.id, o.delivery_id, o.attempt_count
            """;

    private final JdbcTemplate jdbc;

    OutboxLeaseRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    List<OutboxClaim> claim(
            Instant now, int limit, Duration leaseDuration) {
        UUID leaseToken = UUID.randomUUID();
        Instant leaseUntil = now.plus(leaseDuration);
        OffsetDateTime databaseNow = databaseTime(now);
        OffsetDateTime databaseLeaseUntil = databaseTime(leaseUntil);
        List<OutboxClaim> claims =
                jdbc.query(
                        CLAIM,
                        (row, ignored) ->
                                new OutboxClaim(
                                        row.getObject("id", UUID.class),
                                        row.getObject("delivery_id", UUID.class),
                                        leaseToken,
                                        row.getInt("attempt_count")),
                        databaseNow,
                        limit,
                        leaseToken,
                        databaseLeaseUntil,
                        databaseNow);
        for (OutboxClaim claim : claims) {
            int updated =
                    jdbc.update(
                            """
                            UPDATE notification_deliveries
                            SET status = 'PROCESSING',
                                lease_token = ?,
                                lease_until = ?,
                                attempt_count = attempt_count + 1,
                                updated_at = ?
                            WHERE id = ?
                              AND status IN ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED')
                            """,
                            leaseToken,
                            databaseLeaseUntil,
                            databaseNow,
                            claim.deliveryId());
            requireSingle(updated);
        }
        return List.copyOf(claims);
    }

    @Transactional
    void delivered(
            OutboxClaim claim,
            String providerMessageId,
            Instant now) {
        lockClaim(claim);
        OffsetDateTime databaseNow = databaseTime(now);
        requireSingle(
                jdbc.update(
                        """
                        UPDATE notification_deliveries
                        SET status = 'DELIVERED',
                            lease_token = NULL,
                            lease_until = NULL,
                            provider_message_id = ?,
                            failure_category = NULL,
                            delivered_at = ?,
                            suppressed_at = NULL,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        providerMessageId,
                        databaseNow,
                        databaseNow,
                        claim.deliveryId(),
                        claim.leaseToken()));
        requireSingle(
                jdbc.update(
                        """
                        UPDATE outbox_events
                        SET status = 'PROCESSED',
                            lease_token = NULL,
                            lease_until = NULL,
                            last_failure_category = NULL,
                            processed_at = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        databaseNow,
                        databaseNow,
                        claim.eventId(),
                        claim.leaseToken()));
    }

    @Transactional
    void suppressed(
            OutboxClaim claim,
            NotificationFailureCategory category,
            Instant now) {
        lockClaim(claim);
        OffsetDateTime databaseNow = databaseTime(now);
        requireSingle(
                jdbc.update(
                        """
                        UPDATE notification_deliveries
                        SET status = 'SUPPRESSED',
                            lease_token = NULL,
                            lease_until = NULL,
                            failure_category = ?,
                            delivered_at = NULL,
                            suppressed_at = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        category.name(),
                        databaseNow,
                        databaseNow,
                        claim.deliveryId(),
                        claim.leaseToken()));
        processedOutbox(claim, category, now);
    }

    @Transactional
    void deferred(
            OutboxClaim claim,
            Instant availableAt,
            Instant now) {
        lockClaim(claim);
        OffsetDateTime databaseAvailableAt = databaseTime(availableAt);
        OffsetDateTime databaseNow = databaseTime(now);
        requireSingle(
                jdbc.update(
                        """
                        UPDATE notification_deliveries
                        SET status = 'PENDING',
                            lease_token = NULL,
                            lease_until = NULL,
                            attempt_count = attempt_count - 1,
                            available_at = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        databaseAvailableAt,
                        databaseNow,
                        claim.deliveryId(),
                        claim.leaseToken()));
        requireSingle(
                jdbc.update(
                        """
                        UPDATE outbox_events
                        SET status = 'PENDING',
                            lease_token = NULL,
                            lease_until = NULL,
                            attempt_count = attempt_count - 1,
                            available_at = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        databaseAvailableAt,
                        databaseNow,
                        claim.eventId(),
                        claim.leaseToken()));
    }

    @Transactional
    boolean reconcileTrace(
            OutboxClaim claim,
            UUID preferenceId,
            long preferenceVersion,
            long commitmentVersion,
            UUID occurrenceId,
            UUID reminderRuleId,
            Instant activationCutoff,
            Instant scheduledFor,
            Instant now) {
        lockClaimBeforeProvider(claim, now);
        List<UUID> authorizedPreferences =
                jdbc.query(
                        """
                        SELECT preference.id
                        FROM notification_preferences preference
                        JOIN notifications notification
                          ON notification.recipient_user_id = preference.user_id
                        JOIN notification_deliveries delivery
                          ON delivery.notification_id = notification.id
                        WHERE delivery.id = ?
                          AND preference.id = ?
                          AND preference.optimistic_version = ?
                          AND preference.enabled = TRUE
                          AND (
                            (
                              notification.channel = 'IN_APP'
                              AND preference.in_app_enabled = TRUE
                            )
                            OR
                            (
                              notification.channel = 'EMAIL'
                              AND preference.email_enabled = TRUE
                            )
                          )
                        FOR SHARE OF preference
                        """,
                        (row, ignored) -> row.getObject("id", UUID.class),
                        claim.deliveryId(),
                        preferenceId,
                        preferenceVersion);
        if (authorizedPreferences.size() != 1) {
            return false;
        }
        List<UUID> lockedSchedulingParents =
                jdbc.query(
                        """
                        SELECT commitment.id
                        FROM notification_deliveries delivery
                        JOIN notifications notification
                          ON notification.id = delivery.notification_id
                        JOIN households household
                          ON household.id = notification.household_id
                        JOIN recurring_commitments commitment
                          ON commitment.id = notification.commitment_id
                         AND commitment.household_id = household.id
                        WHERE delivery.id = ?
                          AND commitment.status = 'ACTIVE'
                          AND commitment.optimistic_version = ?
                        FOR SHARE OF household, commitment
                        """,
                        (row, ignored) -> row.getObject("id", UUID.class),
                        claim.deliveryId(),
                        commitmentVersion);
        if (lockedSchedulingParents.size() != 1) {
            return false;
        }
        List<UUID> authorizedSchedulingContext =
                jdbc.query(
                        """
                        SELECT occurrence.id
                        FROM notification_deliveries delivery
                        JOIN notifications notification
                          ON notification.id = delivery.notification_id
                        JOIN commitment_occurrences occurrence
                          ON occurrence.id = ?
                         AND occurrence.commitment_id = notification.commitment_id
                         AND occurrence.scheduled_date = notification.scheduled_date
                         AND occurrence.state = 'UPCOMING'
                        JOIN reminder_rules rule
                          ON rule.id = ?
                         AND rule.enabled = TRUE
                         AND rule.channel = notification.channel
                         AND rule.offset_days = notification.offset_days
                        JOIN reminder_rule_sets rule_set
                          ON rule_set.id = rule.rule_set_id
                         AND rule_set.household_id = notification.household_id
                         AND rule_set.mode = 'CUSTOM'
                         AND rule_set.activated_at <= ?
                         AND rule.activated_at <= ?
                        WHERE delivery.id = ?
                          AND (
                            (
                              rule_set.scope_type = 'COMMITMENT'
                              AND rule_set.commitment_id = notification.commitment_id
                            )
                            OR
                            (
                              rule_set.scope_type = 'HOUSEHOLD'
                              AND rule_set.commitment_id IS NULL
                              AND NOT EXISTS (
                                SELECT 1
                                FROM reminder_rule_sets override_set
                                WHERE override_set.household_id =
                                        notification.household_id
                                  AND override_set.scope_type = 'COMMITMENT'
                                  AND override_set.commitment_id =
                                        notification.commitment_id
                                  AND override_set.mode IN ('CUSTOM', 'DISABLED')
                              )
                              AND NOT EXISTS (
                                SELECT 1
                                FROM reminder_rule_sets inherit_set
                                WHERE inherit_set.household_id =
                                        notification.household_id
                                  AND inherit_set.scope_type = 'COMMITMENT'
                                  AND inherit_set.commitment_id =
                                        notification.commitment_id
                                  AND inherit_set.mode = 'INHERIT'
                                  AND inherit_set.activated_at > ?
                              )
                            )
                          )
                        FOR SHARE OF occurrence, rule, rule_set
                        """,
                        (row, ignored) -> row.getObject("id", UUID.class),
                        occurrenceId,
                        reminderRuleId,
                        databaseTime(activationCutoff),
                        databaseTime(activationCutoff),
                        claim.deliveryId(),
                        databaseTime(activationCutoff));
        if (authorizedSchedulingContext.size() != 1) {
            return false;
        }
        OffsetDateTime databaseScheduledFor = databaseTime(scheduledFor);
        OffsetDateTime databaseNow = databaseTime(now);
        int reconciled =
                jdbc.update(
                        """
                        WITH desired (
                            occurrence_id,
                            reminder_rule_id,
                            planned_for
                        ) AS (
                            VALUES (
                                CAST(? AS UUID),
                                CAST(? AS UUID),
                                CAST(? AS TIMESTAMP WITH TIME ZONE)
                            )
                        )
                        UPDATE notifications n
                        SET occurrence_id = desired.occurrence_id,
                            reminder_rule_id = desired.reminder_rule_id,
                            planned_for = desired.planned_for,
                            optimistic_version =
                                n.optimistic_version
                                + CASE
                                    WHEN ROW(
                                        n.occurrence_id,
                                        n.reminder_rule_id,
                                        n.planned_for
                                    ) IS DISTINCT FROM ROW(
                                        desired.occurrence_id,
                                        desired.reminder_rule_id,
                                        desired.planned_for
                                    )
                                    THEN 1
                                    ELSE 0
                                  END,
                            updated_at =
                                CASE
                                    WHEN ROW(
                                        n.occurrence_id,
                                        n.reminder_rule_id,
                                        n.planned_for
                                    ) IS DISTINCT FROM ROW(
                                        desired.occurrence_id,
                                        desired.reminder_rule_id,
                                        desired.planned_for
                                    )
                                    THEN ?
                                    ELSE n.updated_at
                                END
                        FROM notification_deliveries d, desired
                        WHERE d.id = ?
                          AND d.notification_id = n.id
                          AND EXISTS (
                            SELECT 1
                            FROM commitment_occurrences occurrence
                            WHERE occurrence.id = desired.occurrence_id
                              AND occurrence.commitment_id = n.commitment_id
                              AND occurrence.scheduled_date = n.scheduled_date
                              AND occurrence.state = 'UPCOMING'
                          )
                          AND EXISTS (
                            SELECT 1
                            FROM reminder_rules rule
                            JOIN reminder_rule_sets rule_set
                              ON rule_set.id = rule.rule_set_id
                            WHERE rule.id = desired.reminder_rule_id
                              AND rule.enabled = TRUE
                              AND rule.channel = n.channel
                              AND rule.offset_days = n.offset_days
                              AND rule_set.household_id = n.household_id
                              AND rule_set.mode = 'CUSTOM'
                              AND (
                                (
                                  rule_set.scope_type = 'COMMITMENT'
                                  AND rule_set.commitment_id = n.commitment_id
                                )
                                OR
                                (
                                  rule_set.scope_type = 'HOUSEHOLD'
                                  AND rule_set.commitment_id IS NULL
                                  AND NOT EXISTS (
                                    SELECT 1
                                    FROM reminder_rule_sets override_set
                                    WHERE override_set.household_id = n.household_id
                                      AND override_set.scope_type = 'COMMITMENT'
                                      AND override_set.commitment_id = n.commitment_id
                                      AND override_set.mode IN ('CUSTOM', 'DISABLED')
                                  )
                                )
                              )
                          )
                        """,
                        occurrenceId,
                        reminderRuleId,
                        databaseScheduledFor,
                        databaseNow,
                        claim.deliveryId());
        if (reconciled == 0) {
            return false;
        }
        requireSingle(reconciled);
        // This transaction is the provider-authorization linearization point.
        // Its preference and scheduling-context share locks commit before the caller
        // performs network I/O;
        // deliberately do not hold a database transaction across provider transport.
        return true;
    }

    @Transactional
    boolean renewBeforeProvider(
            OutboxClaim claim, Instant now, Duration leaseDuration) {
        if (!tryLockClaimBeforeProvider(claim, now)) {
            return false;
        }
        OffsetDateTime databaseNow = databaseTime(now);
        OffsetDateTime databaseLeaseUntil =
                databaseTime(now.plus(leaseDuration));
        requireSingle(
                jdbc.update(
                        """
                        UPDATE notification_deliveries
                        SET lease_until = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        databaseLeaseUntil,
                        databaseNow,
                        claim.deliveryId(),
                        claim.leaseToken()));
        requireSingle(
                jdbc.update(
                        """
                        UPDATE outbox_events
                        SET lease_until = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        databaseLeaseUntil,
                        databaseNow,
                        claim.eventId(),
                        claim.leaseToken()));
        return true;
    }

    @Transactional
    void failed(
            OutboxClaim claim,
            NotificationFailureCategory category,
            boolean retryable,
            Instant now,
            NotificationRetryPolicy retryPolicy) {
        lockClaim(claim);
        OffsetDateTime databaseNow = databaseTime(now);
        var retryDelay =
                retryable
                        ? retryPolicy.afterFailedAttempt(claim.attemptCount())
                        : java.util.Optional.<Duration>empty();
        if (retryDelay.isPresent()) {
            Instant availableAt = now.plus(retryDelay.orElseThrow());
            OffsetDateTime databaseAvailableAt =
                    databaseTime(availableAt);
            requireSingle(
                    jdbc.update(
                            """
                            UPDATE notification_deliveries
                            SET status = 'RETRY_SCHEDULED',
                                lease_token = NULL,
                                lease_until = NULL,
                                failure_category = ?,
                                available_at = ?,
                                updated_at = ?
                            WHERE id = ?
                              AND status = 'PROCESSING'
                              AND lease_token = ?
                            """,
                            category.name(),
                            databaseAvailableAt,
                            databaseNow,
                            claim.deliveryId(),
                            claim.leaseToken()));
            requireSingle(
                    jdbc.update(
                            """
                            UPDATE outbox_events
                            SET status = 'PENDING',
                                lease_token = NULL,
                                lease_until = NULL,
                                last_failure_category = ?,
                                available_at = ?,
                                updated_at = ?
                            WHERE id = ?
                              AND status = 'PROCESSING'
                              AND lease_token = ?
                            """,
                            category.name(),
                            databaseAvailableAt,
                            databaseNow,
                            claim.eventId(),
                            claim.leaseToken()));
            return;
        }

        requireSingle(
                jdbc.update(
                        """
                        UPDATE notification_deliveries
                        SET status = 'DEAD',
                            lease_token = NULL,
                            lease_until = NULL,
                            failure_category = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        category.name(),
                        databaseNow,
                        claim.deliveryId(),
                        claim.leaseToken()));
        requireSingle(
                jdbc.update(
                        """
                        UPDATE outbox_events
                        SET status = 'DEAD',
                            lease_token = NULL,
                            lease_until = NULL,
                            last_failure_category = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        category.name(),
                        databaseNow,
                        claim.eventId(),
                        claim.leaseToken()));
    }

    @Transactional
    int recoverExpired(
            Instant now,
            int limit,
            NotificationRetryPolicy retryPolicy) {
        OffsetDateTime databaseNow = databaseTime(now);
        List<ExpiredLease> expired =
                jdbc.query(
                        """
                        SELECT
                            o.id AS event_id,
                            d.id AS delivery_id,
                            o.attempt_count
                        FROM outbox_events o
                        JOIN notification_deliveries d ON d.id = o.delivery_id
                        WHERE o.status = 'PROCESSING'
                          AND o.lease_until <= ?
                          AND d.status = 'PROCESSING'
                        ORDER BY o.lease_until ASC, o.id ASC
                        LIMIT ?
                        FOR UPDATE OF o, d SKIP LOCKED
                        """,
                        (row, ignored) ->
                                new ExpiredLease(
                                        row.getObject("event_id", UUID.class),
                                        row.getObject("delivery_id", UUID.class),
                                        row.getInt("attempt_count")),
                        databaseNow,
                        limit);
        if (expired.isEmpty()) {
            return 0;
        }
        List<UUID> recovered = new ArrayList<>(expired.size());
        for (ExpiredLease lease : expired) {
            var retryDelay =
                    retryPolicy.afterFailedAttempt(lease.attemptCount());
            if (retryDelay.isPresent()) {
                Instant availableAt = now.plus(retryDelay.orElseThrow());
                OffsetDateTime databaseAvailableAt =
                        databaseTime(availableAt);
                requireSingle(
                        jdbc.update(
                                """
                                UPDATE notification_deliveries
                                SET status = 'RETRY_SCHEDULED',
                                    lease_token = NULL,
                                    lease_until = NULL,
                                    available_at = ?,
                                    failure_category = 'PROVIDER_TRANSIENT',
                                    updated_at = ?
                                WHERE id = ?
                                  AND status = 'PROCESSING'
                                """,
                                databaseAvailableAt,
                                databaseNow,
                                lease.deliveryId()));
                requireSingle(
                        jdbc.update(
                                """
                                UPDATE outbox_events
                                SET status = 'PENDING',
                                    lease_token = NULL,
                                    lease_until = NULL,
                                    available_at = ?,
                                    last_failure_category = 'PROVIDER_TRANSIENT',
                                    updated_at = ?
                                WHERE id = ?
                                  AND status = 'PROCESSING'
                                """,
                                databaseAvailableAt,
                                databaseNow,
                                lease.eventId()));
            } else {
                requireSingle(
                        jdbc.update(
                                """
                                UPDATE notification_deliveries
                                SET status = 'DEAD',
                                    lease_token = NULL,
                                    lease_until = NULL,
                                    failure_category = 'PROVIDER_TRANSIENT',
                                    updated_at = ?
                                WHERE id = ?
                                  AND status = 'PROCESSING'
                                """,
                                databaseNow,
                                lease.deliveryId()));
                requireSingle(
                        jdbc.update(
                                """
                                UPDATE outbox_events
                                SET status = 'DEAD',
                                    lease_token = NULL,
                                    lease_until = NULL,
                                    last_failure_category = 'PROVIDER_TRANSIENT',
                                    updated_at = ?
                                WHERE id = ?
                                  AND status = 'PROCESSING'
                                """,
                                databaseNow,
                                lease.eventId()));
            }
            recovered.add(lease.eventId());
        }
        return recovered.size();
    }

    @Transactional
    int suppressInvalidated(Instant now, int limit) {
        OffsetDateTime databaseNow = databaseTime(now);
        List<ExpiredLease> invalidated =
                jdbc.query(
                        """
                        SELECT
                            o.id AS event_id,
                            d.id AS delivery_id,
                            o.attempt_count
                        FROM outbox_events o
                        JOIN notification_deliveries d
                          ON d.id = o.delivery_id
                        JOIN notifications n
                          ON n.id = d.notification_id
                        JOIN recurring_commitments c
                          ON c.id = n.commitment_id
                        WHERE o.status = 'PENDING'
                          AND d.status IN ('PENDING', 'RETRY_SCHEDULED')
                          AND NOT (
                            c.status = 'ACTIVE'
                            AND EXISTS (
                                SELECT 1
                                FROM commitment_occurrences occurrence
                                WHERE occurrence.commitment_id = n.commitment_id
                                  AND occurrence.scheduled_date = n.scheduled_date
                                  AND occurrence.state = 'UPCOMING'
                            )
                            AND EXISTS (
                                SELECT 1
                                FROM notification_preferences preference
                                WHERE preference.user_id = n.recipient_user_id
                                  AND preference.enabled = TRUE
                                  AND (
                                    (n.channel = 'IN_APP'
                                        AND preference.in_app_enabled = TRUE)
                                    OR
                                    (n.channel = 'EMAIL'
                                        AND preference.email_enabled = TRUE)
                                  )
                            )
                            AND (
                                EXISTS (
                                    SELECT 1
                                    FROM reminder_rule_sets commitment_set
                                    JOIN reminder_rules commitment_rule
                                      ON commitment_rule.rule_set_id = commitment_set.id
                                    WHERE commitment_set.household_id = n.household_id
                                      AND commitment_set.scope_type = 'COMMITMENT'
                                      AND commitment_set.commitment_id = n.commitment_id
                                      AND commitment_set.mode = 'CUSTOM'
                                      AND commitment_rule.enabled = TRUE
                                      AND commitment_rule.channel = n.channel
                                      AND commitment_rule.offset_days = n.offset_days
                                )
                                OR
                                (
                                    (
                                        NOT EXISTS (
                                            SELECT 1
                                            FROM reminder_rule_sets commitment_set
                                            WHERE commitment_set.household_id = n.household_id
                                              AND commitment_set.scope_type = 'COMMITMENT'
                                              AND commitment_set.commitment_id = n.commitment_id
                                        )
                                        OR EXISTS (
                                            SELECT 1
                                            FROM reminder_rule_sets commitment_set
                                            WHERE commitment_set.household_id = n.household_id
                                              AND commitment_set.scope_type = 'COMMITMENT'
                                              AND commitment_set.commitment_id = n.commitment_id
                                              AND commitment_set.mode = 'INHERIT'
                                        )
                                    )
                                    AND EXISTS (
                                        SELECT 1
                                        FROM reminder_rule_sets household_set
                                        JOIN reminder_rules household_rule
                                          ON household_rule.rule_set_id = household_set.id
                                        WHERE household_set.household_id = n.household_id
                                          AND household_set.scope_type = 'HOUSEHOLD'
                                          AND household_set.mode = 'CUSTOM'
                                          AND household_rule.enabled = TRUE
                                          AND household_rule.channel = n.channel
                                          AND household_rule.offset_days = n.offset_days
                                    )
                                )
                            )
                          )
                        ORDER BY o.available_at ASC, o.id ASC
                        LIMIT ?
                        FOR UPDATE OF o, d SKIP LOCKED
                        """,
                        (row, ignored) ->
                                new ExpiredLease(
                                        row.getObject("event_id", UUID.class),
                                        row.getObject("delivery_id", UUID.class),
                                        row.getInt("attempt_count")),
                        limit);
        for (ExpiredLease invalid : invalidated) {
            requireSingle(
                    jdbc.update(
                            """
                            UPDATE notification_deliveries
                            SET status = 'SUPPRESSED',
                                lease_token = NULL,
                                lease_until = NULL,
                                failure_category = 'DELIVERY_INVALIDATED',
                                delivered_at = NULL,
                                suppressed_at = ?,
                                updated_at = ?
                            WHERE id = ?
                              AND status IN ('PENDING', 'RETRY_SCHEDULED')
                            """,
                            databaseNow,
                            databaseNow,
                            invalid.deliveryId()));
            requireSingle(
                    jdbc.update(
                            """
                            UPDATE outbox_events
                            SET status = 'PROCESSED',
                                lease_token = NULL,
                                lease_until = NULL,
                                last_failure_category = 'DELIVERY_INVALIDATED',
                                processed_at = ?,
                                updated_at = ?
                            WHERE id = ?
                              AND status = 'PENDING'
                            """,
                            databaseNow,
                            databaseNow,
                            invalid.eventId()));
        }
        return invalidated.size();
    }

    private void processedOutbox(
            OutboxClaim claim,
            NotificationFailureCategory category,
            Instant now) {
        OffsetDateTime databaseNow = databaseTime(now);
        requireSingle(
                jdbc.update(
                        """
                        UPDATE outbox_events
                        SET status = 'PROCESSED',
                            lease_token = NULL,
                            lease_until = NULL,
                            last_failure_category = ?,
                            processed_at = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'PROCESSING'
                          AND lease_token = ?
                        """,
                        category.name(),
                        databaseNow,
                        databaseNow,
                        claim.eventId(),
                        claim.leaseToken()));
    }

    private static void requireSingle(int updated) {
        if (updated != 1) {
            throw new IllegalStateException("Notification delivery lease is no longer owned.");
        }
    }

    private static OffsetDateTime databaseTime(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private void lockClaim(OutboxClaim claim) {
        List<UUID> locked =
                jdbc.query(
                        """
                        SELECT o.id
                        FROM outbox_events o
                        JOIN notification_deliveries d ON d.id = o.delivery_id
                        WHERE o.id = ?
                          AND d.id = ?
                          AND o.status = 'PROCESSING'
                          AND d.status = 'PROCESSING'
                          AND o.lease_token = ?
                          AND d.lease_token = ?
                        FOR UPDATE OF o, d
                        """,
                        (row, ignored) -> row.getObject("id", UUID.class),
                        claim.eventId(),
                        claim.deliveryId(),
                        claim.leaseToken(),
                        claim.leaseToken());
        if (locked.size() != 1) {
            throw new IllegalStateException("Notification delivery lease is no longer owned.");
        }
    }

    private void lockClaimBeforeProvider(OutboxClaim claim, Instant now) {
        if (!tryLockClaimBeforeProvider(claim, now)) {
            throw new IllegalStateException("Notification delivery lease is no longer owned.");
        }
    }

    private boolean tryLockClaimBeforeProvider(OutboxClaim claim, Instant now) {
        List<UUID> locked =
                jdbc.query(
                        """
                        SELECT o.id
                        FROM outbox_events o
                        JOIN notification_deliveries d ON d.id = o.delivery_id
                        WHERE o.id = ?
                          AND d.id = ?
                          AND o.status = 'PROCESSING'
                          AND d.status = 'PROCESSING'
                          AND o.lease_token = ?
                          AND d.lease_token = ?
                          AND o.lease_until > ?
                          AND d.lease_until > ?
                        FOR UPDATE OF o, d
                        """,
                        (row, ignored) -> row.getObject("id", UUID.class),
                        claim.eventId(),
                        claim.deliveryId(),
                        claim.leaseToken(),
                        claim.leaseToken(),
                        databaseTime(now),
                        databaseTime(now));
        return locked.size() == 1;
    }

    record OutboxClaim(
            UUID eventId,
            UUID deliveryId,
            UUID leaseToken,
            int attemptCount) {}

    private record ExpiredLease(
            UUID eventId, UUID deliveryId, int attemptCount) {}
}
