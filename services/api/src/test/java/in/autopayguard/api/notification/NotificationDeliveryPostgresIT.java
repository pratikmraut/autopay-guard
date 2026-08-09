package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;

import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.reminder.ReminderRuleInput;
import in.autopayguard.api.reminder.ReminderRuleMode;
import in.autopayguard.api.reminder.ReminderRuleService;
import in.autopayguard.api.reminder.UpdateReminderRuleSetRequest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@ActiveProfiles("test")
@Testcontainers(disabledWithoutDocker = true)
@Import(NotificationDeliveryPostgresIT.FixedClockConfiguration.class)
class NotificationDeliveryPostgresIT {

    private static final Instant TEST_NOW =
            Instant.parse("2026-07-26T10:00:00Z");

    @Container
    static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer("postgres:18.4-alpine")
                    .withDatabaseName("autopay_guard_notifications")
                    .withUsername("autopay_guard_test")
                    .withPassword("fake-test-password");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private NotificationRepository notifications;
    @Autowired private NotificationDeliveryRepository deliveries;
    @Autowired private OutboxEventRepository outbox;
    @Autowired private OutboxLeaseRepository leases;
    @Autowired private NotificationGenerator generator;
    @Autowired private NotificationCandidateRepository candidates;
    @Autowired private NotificationDeliveryContextRepository contexts;
    @Autowired private NotificationPreferenceService preferences;
    @Autowired private ReminderRuleService reminderRules;
    @Autowired private NotificationProperties notificationProperties;
    @Autowired private NotificationReconciliationService reconciliation;
    @Autowired private TransactionTemplate transactions;

    private final NotificationRetryPolicy retryPolicy =
            new NotificationRetryPolicy();

    @DynamicPropertySource
    static void registerPostgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add(
                "spring.datasource.driver-class-name",
                () -> "org.postgresql.Driver");
    }

    @BeforeEach
    void clearDomainRows() {
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM notification_deliveries");
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM reminder_rules");
        jdbc.update("DELETE FROM reminder_rule_sets");
        jdbc.update("DELETE FROM notification_preferences");
        jdbc.update("DELETE FROM commitment_occurrences");
        jdbc.update("DELETE FROM recurring_commitments");
        jdbc.update("DELETE FROM households");
        jdbc.update("DELETE FROM users");
    }

    @Test
    void localTimesRemainLiteralAcrossJpaAndJdbcWithNonUtcJvmTimezone() {
        TimeZone originalTimezone = TimeZone.getDefault();
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Kolkata"));
        try {
            Fixture fixture = insertFixture(LocalDate.of(2026, 7, 30));
            Jwt jwt = identity(fixture);

            NotificationPreferencesResponse savedPreferences =
                    preferences.update(
                            jwt,
                            0,
                            new UpdateNotificationPreferencesRequest(
                                    true,
                                    true,
                                    true,
                                    "Asia/Kolkata",
                                    true,
                                    "22:00",
                                    "07:00"));
            var savedRules =
                    reminderRules.updateHousehold(
                            jwt,
                            fixture.householdId(),
                            0,
                            new UpdateReminderRuleSetRequest(
                                    ReminderRuleMode.CUSTOM,
                                    List.of(
                                            new ReminderRuleInput(
                                                    NotificationChannel.IN_APP,
                                                    0,
                                                    "09:00",
                                                    true))));

            assertThat(savedPreferences.quietStart()).isEqualTo("22:00");
            assertThat(savedPreferences.quietEnd()).isEqualTo("07:00");
            assertThat(savedRules.rules())
                    .singleElement()
                    .extracting(rule -> rule.localSendTime())
                    .isEqualTo("09:00");

            List<LocalTime> rawQuietHours =
                    jdbc.queryForObject(
                            """
                            SELECT quiet_start, quiet_end
                            FROM notification_preferences
                            WHERE user_id = ?
                            """,
                            (row, ignored) ->
                                    List.of(
                                            row.getObject("quiet_start", LocalTime.class),
                                            row.getObject("quiet_end", LocalTime.class)),
                            fixture.userId());
            LocalTime rawSendTime =
                    jdbc.queryForObject(
                            """
                            SELECT local_send_time
                            FROM reminder_rules
                            WHERE rule_set_id = ?
                            """,
                            LocalTime.class,
                            savedRules.id());

            assertThat(rawQuietHours)
                    .containsExactly(LocalTime.of(22, 0), LocalTime.of(7, 0));
            assertThat(rawSendTime).isEqualTo(LocalTime.of(9, 0));

            List<NotificationCandidateRepository.NotificationCandidate>
                    schedulingCandidates =
                            transactions.execute(
                                    ignored ->
                                            candidates.lockDueCandidates(
                                                    fixture.scheduledDate(),
                                                    fixture.scheduledDate(),
                                                    10,
                                                    null));
            assertThat(schedulingCandidates)
                    .singleElement()
                    .satisfies(
                            candidate -> {
                                assertThat(candidate.localSendTime())
                                        .isEqualTo(LocalTime.of(9, 0));
                                assertThat(candidate.quietStart())
                                        .isEqualTo(LocalTime.of(22, 0));
                                assertThat(candidate.quietEnd())
                                        .isEqualTo(LocalTime.of(7, 0));
                            });
        } finally {
            TimeZone.setDefault(originalTimezone);
        }
    }

    @Test
    void semanticTupleDeduplicatesSequentialOccurrenceReplacementAndConcurrentInsert()
            throws Exception {
        LocalDate firstDate = LocalDate.of(2026, 8, 10);
        Fixture fixture = insertFixture(firstDate);
        String firstKey =
                NotificationSemanticKey.create(
                        fixture.userId(),
                        fixture.householdId(),
                        fixture.commitmentId(),
                        firstDate,
                        NotificationChannel.EMAIL,
                        3);
        insertNotificationOnly(
                fixture,
                fixture.occurrenceId(),
                firstDate,
                NotificationChannel.EMAIL,
                3,
                firstKey);

        jdbc.update(
                "DELETE FROM commitment_occurrences WHERE id = ?",
                fixture.occurrenceId());
        UUID replacementOccurrence = UUID.randomUUID();
        insertOccurrence(
                replacementOccurrence, fixture.commitmentId(), firstDate);
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT occurrence_id
                                FROM notifications
                                WHERE semantic_key = ?
                                """,
                                UUID.class,
                                firstKey))
                .isNull();
        assertThatThrownBy(
                        () ->
                                insertNotificationOnly(
                                        fixture,
                                        replacementOccurrence,
                                        firstDate,
                                        NotificationChannel.EMAIL,
                                        3,
                                        randomKey()))
                .isInstanceOf(DataAccessException.class);
        assertThat(notificationCount(fixture.commitmentId(), firstDate, 3))
                .isOne();

        LocalDate concurrentDate = firstDate.plusDays(1);
        UUID concurrentOccurrence = UUID.randomUUID();
        insertOccurrence(
                concurrentOccurrence,
                fixture.commitmentId(),
                concurrentDate);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<Boolean> first =
                    executor.submit(
                            () ->
                                    insertCompetingNotification(
                                            start,
                                            fixture,
                                            concurrentOccurrence,
                                            concurrentDate,
                                            randomKey()));
            Future<Boolean> second =
                    executor.submit(
                            () ->
                                    insertCompetingNotification(
                                            start,
                                            fixture,
                                            concurrentOccurrence,
                                            concurrentDate,
                                            randomKey()));
            start.countDown();

            assertThat(List.of(first.get(), second.get()))
                    .containsExactlyInAnyOrder(true, false);
        }
        assertThat(notificationCount(fixture.commitmentId(), concurrentDate, 5))
                .isOne();
    }

    @Test
    void generatorDeduplicatesSequentialReplacementAndConcurrentRuns()
            throws Exception {
        Instant now = TEST_NOW;
        Instant planned = now.minus(Duration.ofMinutes(5));
        LocalDate reminderDate =
                LocalDate.ofInstant(planned, ZoneOffset.UTC);
        LocalTime sendTime =
                LocalTime.ofInstant(planned, ZoneOffset.UTC)
                        .withSecond(0)
                        .withNano(0);
        LocalDate occurrenceDate = reminderDate.plusDays(3);
        Fixture sequential = insertFixture(occurrenceDate);
        insertSchedulingConfiguration(
                sequential, sendTime, now.minus(Duration.ofHours(1)));

        assertThat(generator.generateDue()).isOne();
        assertThat(generator.generateDue()).isZero();
        assertThat(
                        notificationCount(
                                sequential.commitmentId(),
                                occurrenceDate,
                                3))
                .isOne();
        String originalSemanticKey =
                jdbc.queryForObject(
                        """
                        SELECT semantic_key
                        FROM notifications
                        WHERE commitment_id = ?
                          AND scheduled_date = ?
                          AND channel = 'EMAIL'
                          AND offset_days = 3
                        """,
                        String.class,
                        sequential.commitmentId(),
                        occurrenceDate);

        jdbc.update(
                "DELETE FROM commitment_occurrences WHERE id = ?",
                sequential.occurrenceId());
        UUID replacementOccurrence = UUID.randomUUID();
        insertOccurrence(
                replacementOccurrence,
                sequential.commitmentId(),
                occurrenceDate);
        assertThat(generator.generateDue()).isZero();
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT semantic_key
                                FROM notifications
                                WHERE commitment_id = ?
                                  AND scheduled_date = ?
                                  AND channel = 'EMAIL'
                                  AND offset_days = 3
                                """,
                                String.class,
                                sequential.commitmentId(),
                                occurrenceDate))
                .isEqualTo(originalSemanticKey);

        Fixture concurrent = insertFixture(occurrenceDate);
        insertSchedulingConfiguration(
                concurrent, sendTime, now.minus(Duration.ofHours(1)));
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<Integer> first =
                    executor.submit(
                            () -> {
                                await(start);
                                return generator.generateDue();
                            });
            Future<Integer> second =
                    executor.submit(
                            () -> {
                                await(start);
                                return generator.generateDue();
                            });
            start.countDown();
            assertThat(first.get() + second.get()).isOne();
        }
        assertThat(
                        notificationCount(
                                concurrent.commitmentId(),
                                concurrent.scheduledDate(),
                                3))
                .isOne();
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM notification_deliveries d
                                JOIN notifications n ON n.id = d.notification_id
                                WHERE n.commitment_id = ?
                                """,
                                Integer.class,
                                concurrent.commitmentId()))
                .isOne();
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM outbox_events o
                                JOIN notification_deliveries d ON d.id = o.delivery_id
                                JOIN notifications n ON n.id = d.notification_id
                                WHERE n.commitment_id = ?
                                """,
                                Integer.class,
                                concurrent.commitmentId()))
                .isOne();
    }

    @Test
    void generatorKeysetScanningReachesDueCandidateAfterMoreThanBatchPreActivationCandidates() {
        LocalDate reminderDate =
                LocalDate.ofInstant(TEST_NOW, ZoneOffset.UTC);
        LocalDate occurrenceDate = reminderDate.plusDays(3);
        for (int index = 0;
                index < notificationProperties.batchSize() + 1;
                index++) {
            Fixture stale = insertFixture(occurrenceDate);
            insertSchedulingConfiguration(
                    stale,
                    LocalTime.of(8, 0).plusMinutes(index),
                    TEST_NOW.minus(Duration.ofMinutes(1)));
        }
        Fixture due = insertFixture(occurrenceDate);
        insertSchedulingConfiguration(
                due,
                LocalTime.of(9, 55),
                TEST_NOW.minus(Duration.ofHours(1)));

        assertThat(generator.generateDue()).isOne();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications",
                                Integer.class))
                .isOne();
        assertThat(
                        notificationCount(
                                due.commitmentId(),
                                due.scheduledDate(),
                                3))
                .isOne();
    }

    @Test
    void generatorKeysetScanningReachesDueCandidateAfterMoreThanBatchCrossTimezoneFutureCandidates() {
        LocalDate reminderDate =
                LocalDate.ofInstant(TEST_NOW, ZoneOffset.UTC);
        LocalDate occurrenceDate = reminderDate.plusDays(3);
        for (int index = 0;
                index < notificationProperties.batchSize() + 1;
                index++) {
            Fixture future = insertFixture(occurrenceDate);
            jdbc.update(
                    "UPDATE households SET timezone = 'America/Los_Angeles' WHERE id = ?",
                    future.householdId());
            insertSchedulingConfiguration(
                    future,
                    LocalTime.of(4, 0),
                    TEST_NOW.minus(Duration.ofHours(1)));
        }
        Fixture due = insertFixture(occurrenceDate);
        jdbc.update(
                "UPDATE households SET timezone = 'Asia/Kolkata' WHERE id = ?",
                due.householdId());
        insertSchedulingConfiguration(
                due,
                LocalTime.of(15, 0),
                TEST_NOW.minus(Duration.ofHours(1)));

        assertThat(generator.generateDue()).isOne();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications",
                                Integer.class))
                .isOne();
        assertThat(
                        notificationCount(
                                due.commitmentId(),
                                due.scheduledDate(),
                                3))
                .isOne();
    }

    @Test
    void generatorIncludesExactTwoHourCatchUpBoundaryAndExcludesAnythingOlder() {
        LocalDate reminderDate =
                LocalDate.ofInstant(TEST_NOW, ZoneOffset.UTC);
        LocalDate occurrenceDate = reminderDate.plusDays(3);
        Instant activatedAt = TEST_NOW.minus(Duration.ofHours(4));

        Fixture exactBoundary = insertFixture(occurrenceDate);
        moveCommitmentAndOccurrenceActivation(exactBoundary, activatedAt);
        insertSchedulingConfiguration(
                exactBoundary,
                LocalTime.of(8, 0),
                activatedAt);

        Fixture justBeyondBoundary = insertFixture(occurrenceDate);
        moveCommitmentAndOccurrenceActivation(
                justBeyondBoundary, activatedAt);
        insertSchedulingConfiguration(
                justBeyondBoundary,
                LocalTime.of(7, 59),
                activatedAt);

        assertThat(generator.generateDue()).isOne();
        assertThat(
                        notificationCount(
                                exactBoundary.commitmentId(),
                                exactBoundary.scheduledDate(),
                                3))
                .isOne();
        assertThat(
                        notificationCount(
                                justBeyondBoundary.commitmentId(),
                                justBeyondBoundary.scheduledDate(),
                                3))
                .isZero();
    }

    @Test
    void generatorNeverBackfillsCommitmentOrScheduleActivatedAfterPlannedTime() {
        Instant planned = TEST_NOW.minus(Duration.ofMinutes(5));
        Instant activatedBeforePlanned = planned.minus(Duration.ofHours(1));
        Instant activatedAfterPlanned = planned.plus(Duration.ofMinutes(1));
        LocalDate reminderDate =
                LocalDate.ofInstant(planned, ZoneOffset.UTC);
        LocalTime sendTime =
                LocalTime.ofInstant(planned, ZoneOffset.UTC)
                        .withSecond(0)
                        .withNano(0);
        LocalDate occurrenceDate = reminderDate.plusDays(3);

        Fixture createdAfterPlanned = insertFixture(occurrenceDate);
        insertSchedulingConfiguration(
                createdAfterPlanned,
                sendTime,
                activatedBeforePlanned);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET created_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(activatedAfterPlanned),
                databaseTime(activatedAfterPlanned),
                createdAfterPlanned.commitmentId());
        jdbc.update(
                """
                UPDATE commitment_occurrences
                SET created_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(activatedAfterPlanned),
                databaseTime(activatedAfterPlanned),
                createdAfterPlanned.occurrenceId());

        Fixture editedAfterPlanned = insertFixture(occurrenceDate);
        insertSchedulingConfiguration(
                editedAfterPlanned,
                sendTime,
                activatedBeforePlanned);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET display_name = 'Edited notification commitment',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(activatedAfterPlanned),
                editedAfterPlanned.commitmentId());

        Fixture resumedAfterPlanned = insertFixture(occurrenceDate);
        insertSchedulingConfiguration(
                resumedAfterPlanned,
                sendTime,
                activatedBeforePlanned);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET status = 'PAUSED',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(activatedBeforePlanned),
                resumedAfterPlanned.commitmentId());
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET status = 'ACTIVE',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(activatedAfterPlanned),
                resumedAfterPlanned.commitmentId());

        Fixture replacedAfterPlanned = insertFixture(occurrenceDate);
        insertSchedulingConfiguration(
                replacedAfterPlanned,
                sendTime,
                activatedBeforePlanned);
        jdbc.update(
                "DELETE FROM commitment_occurrences WHERE id = ?",
                replacedAfterPlanned.occurrenceId());
        insertOccurrence(
                UUID.randomUUID(),
                replacedAfterPlanned.commitmentId(),
                occurrenceDate,
                activatedAfterPlanned);

        assertThat(generator.generateDue()).isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications",
                                Integer.class))
                .isZero();
    }

    @Test
    void quietHourDeferralDoesNotExtendTheOriginalCommitmentActivationCutoff() {
        LocalDate occurrenceDate =
                LocalDate.ofInstant(TEST_NOW, ZoneOffset.UTC);
        Fixture fixture = insertFixture(occurrenceDate);
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        jdbc.update(
                """
                UPDATE notification_preferences
                SET quiet_hours_enabled = TRUE,
                    quiet_start = '09:00',
                    quiet_end = '11:00',
                    updated_at = ?
                WHERE user_id = ?
                """,
                databaseTime(TEST_NOW.minus(Duration.ofHours(1))),
                fixture.userId());

        assertThat(generator.generateDue()).isOne();
        DeliveryIds deferred = deliveryForCommitment(fixture.commitmentId());
        Instant deferredUntil =
                jdbc.queryForObject(
                        """
                        SELECT planned_for
                        FROM notifications
                        WHERE commitment_id = ?
                        """,
                        (row, ignored) ->
                                row.getObject(
                                                "planned_for",
                                                OffsetDateTime.class)
                                        .toInstant(),
                        fixture.commitmentId());
        assertThat(deferredUntil)
                .isEqualTo(TEST_NOW.plus(Duration.ofHours(1)));

        jdbc.update(
                """
                UPDATE recurring_commitments
                SET display_name = 'Edited during quiet-hour deferral',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(TEST_NOW.plus(Duration.ofMinutes(30))),
                fixture.commitmentId());
        NotificationEmailTransport transport =
                mock(NotificationEmailTransport.class);
        NotificationOutboxWorker worker =
                new NotificationOutboxWorker(
                        leases,
                        contexts,
                        preferences,
                        reminderRules,
                        new ReminderTimePolicy(),
                        transport,
                        retryPolicy,
                        notificationProperties,
                        Clock.fixed(
                                TEST_NOW.plus(Duration.ofHours(1)),
                                ZoneOffset.UTC));

        assertThat(worker.processDueBatch()).isOne();
        verify(transport, times(0)).send(any());
        assertThat(status("notification_deliveries", deferred.deliveryId()))
                .isEqualTo("SUPPRESSED");
        assertThat(status("outbox_events", deferred.eventId()))
                .isEqualTo("PROCESSED");
    }

    @Test
    void intentDeliveryAndOutboxRollbackAsOneAtomicUnit() {
        Fixture fixture = insertFixture(LocalDate.of(2026, 8, 12));
        Instant now = Instant.parse("2026-07-26T10:00:00Z");
        String semanticKey =
                NotificationSemanticKey.create(
                        fixture.userId(),
                        fixture.householdId(),
                        fixture.commitmentId(),
                        fixture.scheduledDate(),
                        NotificationChannel.EMAIL,
                        3);

        assertThatThrownBy(
                        () ->
                                transactions.executeWithoutResult(
                                        ignored -> {
                                            NotificationEntity notification =
                                                    NotificationEntity.create(
                                                            fixture.userId(),
                                                            fixture.householdId(),
                                                            fixture.commitmentId(),
                                                            fixture.occurrenceId(),
                                                            null,
                                                            fixture.scheduledDate(),
                                                            NotificationChannel.EMAIL,
                                                            3,
                                                            now,
                                                            semanticKey,
                                                            now);
                                            notifications.saveAndFlush(
                                                    notification);
                                            NotificationDeliveryEntity delivery =
                                                    NotificationDeliveryEntity
                                                            .pending(
                                                                    notification
                                                                            .id(),
                                                                    now,
                                                                    now);
                                            deliveries.saveAndFlush(delivery);
                                            outbox.saveAndFlush(
                                                    OutboxEventEntity.pending(
                                                            delivery.id(),
                                                            "invalid",
                                                            now,
                                                            now));
                                        }))
                .isInstanceOf(DataAccessException.class);

        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications WHERE semantic_key = ?",
                                Integer.class,
                                semanticKey))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notification_deliveries",
                                Integer.class))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM outbox_events",
                                Integer.class))
                .isZero();
    }

    @Test
    void workerClaimsAreBoundedDisjointAndSkipLocked() throws Exception {
        Fixture fixture = insertFixture(LocalDate.of(2026, 8, 14));
        Instant now = Instant.parse("2026-07-26T10:00:00Z");
        for (int offset = 0; offset < 3; offset++) {
            insertPendingDelivery(fixture, offset, now);
        }

        CountDownLatch start = new CountDownLatch(1);
        List<OutboxLeaseRepository.OutboxClaim> firstClaims;
        List<OutboxLeaseRepository.OutboxClaim> secondClaims;
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<List<OutboxLeaseRepository.OutboxClaim>> first =
                    executor.submit(
                            () -> {
                                await(start);
                                return leases.claim(
                                        now, 2, Duration.ofMinutes(2));
                            });
            Future<List<OutboxLeaseRepository.OutboxClaim>> second =
                    executor.submit(
                            () -> {
                                await(start);
                                return leases.claim(
                                        now, 2, Duration.ofMinutes(2));
                            });
            start.countDown();
            firstClaims = first.get();
            secondClaims = second.get();
        }

        assertThat(firstClaims).hasSizeLessThanOrEqualTo(2);
        assertThat(secondClaims).hasSizeLessThanOrEqualTo(2);
        HashSet<UUID> claimedEvents = new HashSet<>();
        firstClaims.forEach(claim -> claimedEvents.add(claim.eventId()));
        int firstDistinctCount = claimedEvents.size();
        secondClaims.forEach(claim -> claimedEvents.add(claim.eventId()));
        assertThat(firstDistinctCount).isEqualTo(firstClaims.size());
        assertThat(claimedEvents)
                .hasSize(firstClaims.size() + secondClaims.size())
                .hasSize(3);
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM notification_deliveries
                                WHERE status = 'PROCESSING'
                                  AND attempt_count = 1
                                """,
                                Integer.class))
                .isEqualTo(3);
    }

    @Test
    void traceReconciliationWaitsForUncommittedOptOutThenRejectsStalePreference()
            throws Exception {
        Fixture fixture = insertFixture(LocalDate.of(2026, 7, 26));
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        DeliveryIds delivery = insertPendingDelivery(fixture, 0, TEST_NOW);
        OutboxLeaseRepository.OutboxClaim claim =
                leases.claim(TEST_NOW, 1, Duration.ofMinutes(2)).getFirst();
        SavedPreference savedPreference =
                jdbc.queryForObject(
                        """
                        SELECT id, optimistic_version
                        FROM notification_preferences
                        WHERE user_id = ?
                        """,
                        (row, ignored) ->
                                new SavedPreference(
                                        row.getObject("id", UUID.class),
                                        row.getLong("optimistic_version")),
                        fixture.userId());
        UUID ruleId =
                jdbc.queryForObject(
                        """
                        SELECT rule.id
                        FROM reminder_rules rule
                        JOIN reminder_rule_sets rule_set
                          ON rule_set.id = rule.rule_set_id
                        WHERE rule_set.household_id = ?
                          AND rule.channel = 'EMAIL'
                          AND rule.offset_days = 0
                        """,
                        UUID.class,
                        fixture.householdId());
        UUID notificationId =
                jdbc.queryForObject(
                        """
                        SELECT notification_id
                        FROM notification_deliveries
                        WHERE id = ?
                        """,
                        UUID.class,
                        delivery.deliveryId());
        NotificationTrace traceBefore = trace(notificationId);
        CountDownLatch optOutUpdated = new CountDownLatch(1);
        CountDownLatch allowOptOutCommit = new CountDownLatch(1);

        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<?> optOut =
                    executor.submit(
                            () ->
                                    transactions.executeWithoutResult(
                                            ignored -> {
                                                jdbc.update(
                                                        """
                                                        UPDATE notification_preferences
                                                        SET email_enabled = FALSE,
                                                            optimistic_version =
                                                                optimistic_version + 1,
                                                            updated_at = ?
                                                        WHERE id = ?
                                                        """,
                                                        databaseTime(TEST_NOW.plusSeconds(1)),
                                                        savedPreference.id());
                                                optOutUpdated.countDown();
                                                await(allowOptOutCommit);
                                            }));
            await(optOutUpdated);
            Future<Boolean> reconciliation =
                    executor.submit(
                            () ->
                                    leases.reconcileTrace(
                                            claim,
                                            savedPreference.id(),
                                            savedPreference.version(),
                                            0,
                                            fixture.occurrenceId(),
                                            ruleId,
                                            TEST_NOW.plusSeconds(30),
                                            TEST_NOW.plusSeconds(30),
                                            TEST_NOW));
            try {
                assertThatThrownBy(
                                () ->
                                        reconciliation.get(
                                                250,
                                                TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
            } finally {
                allowOptOutCommit.countDown();
            }

            optOut.get(5, TimeUnit.SECONDS);
            assertThat(reconciliation.get(5, TimeUnit.SECONDS)).isFalse();
        } finally {
            allowOptOutCommit.countDown();
        }

        assertThat(trace(notificationId)).isEqualTo(traceBefore);
        assertThat(status("notification_deliveries", delivery.deliveryId()))
                .isEqualTo("PROCESSING");
        assertThat(attemptCount("notification_deliveries", delivery.deliveryId()))
                .isOne();
    }

    @Test
    void traceReconciliationWaitsForArchiveThenRejectsRetainedPastOccurrence()
            throws Exception {
        LocalDate pastDate = LocalDate.of(2026, 7, 25);
        Instant plannedFor = Instant.parse("2026-07-25T10:00:00Z");
        Fixture fixture = insertFixture(pastDate);
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(10, 0),
                plannedFor.minus(Duration.ofHours(1)),
                0);
        DeliveryIds delivery =
                insertPendingDelivery(
                        fixture,
                        0,
                        TEST_NOW,
                        plannedFor,
                        plannedFor.minus(Duration.ofHours(1)));
        OutboxLeaseRepository.OutboxClaim claim =
                leases.claim(TEST_NOW, 1, Duration.ofMinutes(2)).getFirst();
        SavedAuthorization saved = savedAuthorization(fixture, delivery);
        NotificationTrace traceBefore = trace(saved.notificationId());
        CountDownLatch archiveUpdated = new CountDownLatch(1);
        CountDownLatch allowArchiveCommit = new CountDownLatch(1);

        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<?> archive =
                    executor.submit(
                            () ->
                                    transactions.executeWithoutResult(
                                            ignored -> {
                                                jdbc.update(
                                                        """
                                                        UPDATE recurring_commitments
                                                        SET status = 'ARCHIVED',
                                                            optimistic_version =
                                                                optimistic_version + 1,
                                                            updated_at = ?
                                                        WHERE id = ?
                                                        """,
                                                        databaseTime(TEST_NOW.plusSeconds(1)),
                                                        fixture.commitmentId());
                                                archiveUpdated.countDown();
                                                await(allowArchiveCommit);
                                            }));
            await(archiveUpdated);
            Future<Boolean> authorization =
                    executor.submit(
                            () ->
                                    leases.reconcileTrace(
                                            claim,
                                            saved.preferenceId(),
                                            saved.preferenceVersion(),
                                            saved.commitmentVersion(),
                                            fixture.occurrenceId(),
                                            saved.ruleId(),
                                            plannedFor,
                                            plannedFor,
                                            TEST_NOW));
            try {
                assertThatThrownBy(
                                () ->
                                        authorization.get(
                                                250,
                                                TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
            } finally {
                allowArchiveCommit.countDown();
            }

            archive.get(5, TimeUnit.SECONDS);
            assertThat(authorization.get(5, TimeUnit.SECONDS)).isFalse();
        } finally {
            allowArchiveCommit.countDown();
        }

        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM commitment_occurrences WHERE id = ?",
                                Integer.class,
                                fixture.occurrenceId()))
                .isOne();
        assertThat(trace(saved.notificationId())).isEqualTo(traceBefore);
        assertThat(status("notification_deliveries", delivery.deliveryId()))
                .isEqualTo("PROCESSING");
    }

    @Test
    void traceReconciliationWaitsForHouseholdRuleReplacementThenRejectsStaleRule()
            throws Exception {
        Fixture fixture = insertFixture(LocalDate.of(2026, 7, 26));
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        DeliveryIds delivery = insertPendingDelivery(fixture, 0, TEST_NOW);
        OutboxLeaseRepository.OutboxClaim claim =
                leases.claim(TEST_NOW, 1, Duration.ofMinutes(2)).getFirst();
        SavedAuthorization saved = savedAuthorization(fixture, delivery);
        NotificationTrace traceBefore = trace(saved.notificationId());
        CountDownLatch ruleDisabled = new CountDownLatch(1);
        CountDownLatch allowRuleCommit = new CountDownLatch(1);

        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<?> ruleReplacement =
                    executor.submit(
                            () ->
                                    transactions.executeWithoutResult(
                                            ignored -> {
                                                jdbc.queryForObject(
                                                        """
                                                        SELECT id
                                                        FROM households
                                                        WHERE id = ?
                                                        FOR UPDATE
                                                        """,
                                                        UUID.class,
                                                        fixture.householdId());
                                                jdbc.update(
                                                        """
                                                        UPDATE reminder_rules
                                                        SET enabled = FALSE,
                                                            updated_at = ?
                                                        WHERE id = ?
                                                        """,
                                                        databaseTime(TEST_NOW.plusSeconds(1)),
                                                        saved.ruleId());
                                                ruleDisabled.countDown();
                                                await(allowRuleCommit);
                                            }));
            await(ruleDisabled);
            Future<Boolean> authorization =
                    executor.submit(
                            () ->
                                    leases.reconcileTrace(
                                            claim,
                                            saved.preferenceId(),
                                            saved.preferenceVersion(),
                                            saved.commitmentVersion(),
                                            fixture.occurrenceId(),
                                            saved.ruleId(),
                                            TEST_NOW,
                                            TEST_NOW,
                                            TEST_NOW));
            try {
                assertThatThrownBy(
                                () ->
                                        authorization.get(
                                                250,
                                                TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
            } finally {
                allowRuleCommit.countDown();
            }

            ruleReplacement.get(5, TimeUnit.SECONDS);
            assertThat(authorization.get(5, TimeUnit.SECONDS)).isFalse();
        } finally {
            allowRuleCommit.countDown();
        }

        assertThat(trace(saved.notificationId())).isEqualTo(traceBefore);
        assertThat(status("notification_deliveries", delivery.deliveryId()))
                .isEqualTo("PROCESSING");
    }

    @Test
    void traceReconciliationRejectsNewInheritedOverrideActivatedAfterPlannedTime()
            throws Exception {
        Fixture fixture = insertFixture(LocalDate.of(2026, 7, 26));
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        DeliveryIds delivery = insertPendingDelivery(fixture, 0, TEST_NOW);
        OutboxLeaseRepository.OutboxClaim claim =
                leases.claim(TEST_NOW, 1, Duration.ofMinutes(2)).getFirst();
        SavedAuthorization saved = savedAuthorization(fixture, delivery);
        NotificationTrace traceBefore = trace(saved.notificationId());
        CountDownLatch overrideInserted = new CountDownLatch(1);
        CountDownLatch allowOverrideCommit = new CountDownLatch(1);

        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<?> override =
                    executor.submit(
                            () ->
                                    transactions.executeWithoutResult(
                                            ignored -> {
                                                jdbc.queryForObject(
                                                        """
                                                        SELECT id
                                                        FROM recurring_commitments
                                                        WHERE id = ?
                                                        FOR UPDATE
                                                        """,
                                                        UUID.class,
                                                        fixture.commitmentId());
                                                UUID ruleSetId = UUID.randomUUID();
                                                OffsetDateTime activatedAt =
                                                        databaseTime(TEST_NOW.plusSeconds(1));
                                                jdbc.update(
                                                        """
                                                        INSERT INTO reminder_rule_sets (
                                                            id, household_id, commitment_id,
                                                            scope_type, scope_reference_id, mode,
                                                            activated_at, optimistic_version,
                                                            created_at, updated_at
                                                        ) VALUES (
                                                            ?, ?, ?, 'COMMITMENT', ?, 'INHERIT',
                                                            ?, 1, ?, ?
                                                        )
                                                        """,
                                                        ruleSetId,
                                                        fixture.householdId(),
                                                        fixture.commitmentId(),
                                                        fixture.commitmentId(),
                                                        activatedAt,
                                                        activatedAt,
                                                        activatedAt);
                                                overrideInserted.countDown();
                                                await(allowOverrideCommit);
                                            }));
            await(overrideInserted);
            Future<Boolean> authorization =
                    executor.submit(
                            () ->
                                    leases.reconcileTrace(
                                            claim,
                                            saved.preferenceId(),
                                            saved.preferenceVersion(),
                                            saved.commitmentVersion(),
                                            fixture.occurrenceId(),
                                            saved.ruleId(),
                                            TEST_NOW,
                                            TEST_NOW.plus(Duration.ofHours(1)),
                                            TEST_NOW));
            try {
                assertThatThrownBy(
                                () ->
                                        authorization.get(
                                                250,
                                                TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
            } finally {
                allowOverrideCommit.countDown();
            }

            override.get(5, TimeUnit.SECONDS);
            assertThat(authorization.get(5, TimeUnit.SECONDS)).isFalse();
        } finally {
            allowOverrideCommit.countDown();
        }

        assertThat(trace(saved.notificationId())).isEqualTo(traceBefore);
        assertThat(status("notification_deliveries", delivery.deliveryId()))
                .isEqualTo("PROCESSING");
    }

    @Test
    void commitmentRuleUpdateWaitingOnArchiveCannotWriteRulesForArchivedCommitment()
            throws Exception {
        Fixture fixture = insertFixture(LocalDate.of(2026, 7, 26));
        Jwt jwt = identity(fixture);
        CountDownLatch archiveUpdated = new CountDownLatch(1);
        CountDownLatch allowArchiveCommit = new CountDownLatch(1);

        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<?> archive =
                    executor.submit(
                            () ->
                                    transactions.executeWithoutResult(
                                            ignored -> {
                                                jdbc.update(
                                                        """
                                                        UPDATE recurring_commitments
                                                        SET status = 'ARCHIVED',
                                                            optimistic_version =
                                                                optimistic_version + 1,
                                                            updated_at = ?
                                                        WHERE id = ?
                                                        """,
                                                        databaseTime(TEST_NOW.plusSeconds(1)),
                                                        fixture.commitmentId());
                                                archiveUpdated.countDown();
                                                await(allowArchiveCommit);
                                            }));
            await(archiveUpdated);
            Future<?> ruleUpdate =
                    executor.submit(
                            () ->
                                    reminderRules.updateCommitment(
                                            jwt,
                                            fixture.commitmentId(),
                                            0,
                                            new UpdateReminderRuleSetRequest(
                                                    ReminderRuleMode.INHERIT,
                                                    List.of())));
            try {
                assertThatThrownBy(
                                () ->
                                        ruleUpdate.get(
                                                250,
                                                TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
            } finally {
                allowArchiveCommit.countDown();
            }

            archive.get(5, TimeUnit.SECONDS);
            assertThatThrownBy(() -> ruleUpdate.get(5, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(ResourceNotFoundException.class);
        } finally {
            allowArchiveCommit.countDown();
        }

        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM reminder_rule_sets
                                WHERE commitment_id = ?
                                """,
                                Integer.class,
                                fixture.commitmentId()))
                .isZero();
    }

    @Test
    void expiredLeaseCannotBeRenewedAfterFinalAuthorization() {
        Fixture fixture = insertFixture(LocalDate.of(2026, 7, 26));
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        DeliveryIds delivery = insertPendingDelivery(fixture, 0, TEST_NOW);
        OutboxLeaseRepository.OutboxClaim claim =
                leases.claim(TEST_NOW, 1, Duration.ofMinutes(2)).getFirst();
        SavedAuthorization saved = savedAuthorization(fixture, delivery);

        assertThat(
                        leases.reconcileTrace(
                                claim,
                                saved.preferenceId(),
                                saved.preferenceVersion(),
                                saved.commitmentVersion(),
                                fixture.occurrenceId(),
                                saved.ruleId(),
                                TEST_NOW,
                                TEST_NOW,
                                TEST_NOW))
                .isTrue();
        assertThat(
                        leases.renewBeforeProvider(
                                claim,
                                TEST_NOW.plus(Duration.ofMinutes(3)),
                                Duration.ofMinutes(2)))
                .isFalse();

        assertThat(status("notification_deliveries", delivery.deliveryId()))
                .isEqualTo("PROCESSING");
        assertThat(attemptCount("notification_deliveries", delivery.deliveryId()))
                .isOne();
        assertThat(availableAt("notification_deliveries", delivery.deliveryId()))
                .isEqualTo(TEST_NOW);
    }

    @Test
    void retriesUseFrozenBackoffThenDeadAndExpiredLeasesRecoverInBoundedBatches() {
        Fixture fixture = insertFixture(LocalDate.of(2026, 8, 16));
        Instant cursor = Instant.parse("2026-07-26T10:00:00Z");
        DeliveryIds retrying = insertPendingDelivery(fixture, 3, cursor);
        List<Duration> backoffs =
                List.of(
                        Duration.ofMinutes(1),
                        Duration.ofMinutes(5),
                        Duration.ofMinutes(15),
                        Duration.ofMinutes(60),
                        Duration.ofMinutes(360));

        for (int attempt = 1; attempt <= 6; attempt++) {
            List<OutboxLeaseRepository.OutboxClaim> claims =
                    leases.claim(cursor, 10, Duration.ofMinutes(2));
            assertThat(claims).singleElement();
            OutboxLeaseRepository.OutboxClaim claim = claims.getFirst();
            assertThat(claim.eventId()).isEqualTo(retrying.eventId());
            assertThat(claim.attemptCount()).isEqualTo(attempt);
            leases.failed(
                    claim,
                    NotificationFailureCategory.PROVIDER_TIMEOUT,
                    true,
                    cursor,
                    retryPolicy);

            if (attempt <= backoffs.size()) {
                cursor = cursor.plus(backoffs.get(attempt - 1));
                assertThat(status("notification_deliveries", retrying.deliveryId()))
                        .isEqualTo("RETRY_SCHEDULED");
                assertThat(status("outbox_events", retrying.eventId()))
                        .isEqualTo("PENDING");
                assertThat(availableAt("outbox_events", retrying.eventId()))
                        .isEqualTo(cursor);
            } else {
                assertThat(status("notification_deliveries", retrying.deliveryId()))
                        .isEqualTo("DEAD");
                assertThat(status("outbox_events", retrying.eventId()))
                        .isEqualTo("DEAD");
            }
        }
        assertThat(attemptCount("notification_deliveries", retrying.deliveryId()))
                .isEqualTo(6);
        assertThat(attemptCount("outbox_events", retrying.eventId()))
                .isEqualTo(6);

        clearDomainRows();
        Fixture recoveryFixture =
                insertFixture(LocalDate.of(2026, 8, 18));
        Instant recoveryStart = Instant.parse("2026-07-26T12:00:00Z");
        insertPendingDelivery(recoveryFixture, 1, recoveryStart);
        insertPendingDelivery(recoveryFixture, 2, recoveryStart);
        List<OutboxLeaseRepository.OutboxClaim> abandoned =
                leases.claim(recoveryStart, 10, Duration.ofMinutes(2));
        assertThat(abandoned).hasSize(2);
        assertThat(
                        leases.recoverExpired(
                                recoveryStart.plus(Duration.ofMinutes(1)),
                                1,
                                retryPolicy))
                .isZero();
        assertThat(
                        leases.recoverExpired(
                                recoveryStart.plus(Duration.ofMinutes(2)),
                                1,
                                retryPolicy))
                .isOne();
        assertThat(
                        leases.recoverExpired(
                                recoveryStart.plus(Duration.ofMinutes(2)),
                                1,
                                retryPolicy))
                .isOne();
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM notification_deliveries
                                WHERE status = 'RETRY_SCHEDULED'
                                  AND failure_category = 'PROVIDER_TRANSIENT'
                                """,
                                Integer.class))
                .isEqualTo(2);
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM outbox_events
                                WHERE status = 'PENDING'
                                  AND last_failure_category = 'PROVIDER_TRANSIENT'
                                """,
                                Integer.class))
                .isEqualTo(2);
        assertThatThrownBy(
                        () ->
                                leases.delivered(
                                        abandoned.getFirst(),
                                        "<stale@autopayguard.local>",
                                        recoveryStart.plus(
                                                Duration.ofMinutes(2))))
                .isInstanceOf(DataAccessException.class)
                .hasRootCauseInstanceOf(IllegalStateException.class);
    }

    @Test
    void actualWorkerRetriesPastCatchUpWindowThroughFinalDeadAttempt() {
        Instant cursor = Instant.parse("2026-07-26T10:00:00Z");
        Fixture fixture = insertFixture(LocalDate.of(2026, 7, 26));
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(10, 0),
                cursor.minus(Duration.ofHours(1)),
                0);
        DeliveryIds delivery = insertPendingDelivery(fixture, 0, cursor);
        NotificationEmailTransport transport =
                mock(NotificationEmailTransport.class);
        doThrow(
                        new NotificationDeliveryException(
                                NotificationFailureCategory.PROVIDER_TIMEOUT,
                                true))
                .when(transport)
                .send(any());
        List<Duration> backoffs =
                List.of(
                        Duration.ofMinutes(1),
                        Duration.ofMinutes(5),
                        Duration.ofMinutes(15),
                        Duration.ofMinutes(60),
                        Duration.ofMinutes(360));

        for (int attempt = 1; attempt <= 6; attempt++) {
            NotificationOutboxWorker worker =
                    new NotificationOutboxWorker(
                            leases,
                            contexts,
                            preferences,
                            reminderRules,
                            new ReminderTimePolicy(),
                            transport,
                            retryPolicy,
                            notificationProperties,
                            Clock.fixed(cursor, ZoneOffset.UTC));

            assertThat(worker.processDueBatch()).isOne();
            if (attempt <= backoffs.size()) {
                cursor = cursor.plus(backoffs.get(attempt - 1));
                assertThat(status("notification_deliveries", delivery.deliveryId()))
                        .isEqualTo("RETRY_SCHEDULED");
                assertThat(availableAt("outbox_events", delivery.eventId()))
                        .isEqualTo(cursor);
            } else {
                assertThat(status("notification_deliveries", delivery.deliveryId()))
                        .isEqualTo("DEAD");
                assertThat(status("outbox_events", delivery.eventId()))
                        .isEqualTo("DEAD");
            }
        }
        verify(transport, times(6)).send(any());
    }

    @Test
    void actualReconciliationBacksOffAbandonedLeasesAndEventuallyMarksDead() {
        Instant claimAt = Instant.parse("2026-07-26T10:00:00Z");
        Fixture fixture = insertFixture(LocalDate.of(2026, 7, 26));
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(10, 0),
                claimAt.minus(Duration.ofHours(1)),
                0);
        DeliveryIds delivery = insertPendingDelivery(fixture, 0, claimAt);
        List<Duration> backoffs =
                List.of(
                        Duration.ofMinutes(1),
                        Duration.ofMinutes(5),
                        Duration.ofMinutes(15),
                        Duration.ofMinutes(60),
                        Duration.ofMinutes(360));

        for (int attempt = 1; attempt <= 6; attempt++) {
            List<OutboxLeaseRepository.OutboxClaim> claimed =
                    leases.claim(
                            claimAt, 1, notificationProperties.leaseDuration());
            assertThat(claimed).singleElement();
            Instant reconcileAt =
                    claimAt.plus(notificationProperties.leaseDuration());
            NotificationReconciliationService reconciliation =
                    new NotificationReconciliationService(
                            leases,
                            retryPolicy,
                            notificationProperties,
                            Clock.fixed(reconcileAt, ZoneOffset.UTC));

            assertThat(reconciliation.recoverExpiredLeases()).isOne();
            if (attempt <= backoffs.size()) {
                claimAt = reconcileAt.plus(backoffs.get(attempt - 1));
                assertThat(status("notification_deliveries", delivery.deliveryId()))
                        .isEqualTo("RETRY_SCHEDULED");
                assertThat(availableAt("outbox_events", delivery.eventId()))
                        .isEqualTo(claimAt);
            } else {
                assertThat(status("notification_deliveries", delivery.deliveryId()))
                        .isEqualTo("DEAD");
                assertThat(status("outbox_events", delivery.eventId()))
                        .isEqualTo("DEAD");
            }
        }
        assertThat(attemptCount("notification_deliveries", delivery.deliveryId()))
                .isEqualTo(6);
        assertThat(attemptCount("outbox_events", delivery.eventId()))
                .isEqualTo(6);
    }

    @Test
    void workerSuppressesPendingRowsAfterCommitmentEditResumeOrOccurrenceReplacement() {
        LocalDate date = LocalDate.of(2026, 7, 26);
        Instant activatedBeforePlanned = TEST_NOW.minus(Duration.ofHours(1));
        Instant activatedAfterPlanned = TEST_NOW.plusSeconds(1);

        Fixture edited = insertFixture(date);
        insertSchedulingConfiguration(
                edited,
                LocalTime.of(10, 0),
                activatedBeforePlanned,
                0);
        DeliveryIds editedDelivery =
                insertPendingDelivery(edited, 0, TEST_NOW);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET display_name = 'Edited pending commitment',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(activatedAfterPlanned),
                edited.commitmentId());

        Fixture resumed = insertFixture(date);
        insertSchedulingConfiguration(
                resumed,
                LocalTime.of(10, 0),
                activatedBeforePlanned,
                0);
        DeliveryIds resumedDelivery =
                insertPendingDelivery(resumed, 0, TEST_NOW);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET status = 'PAUSED',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(activatedBeforePlanned),
                resumed.commitmentId());
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET status = 'ACTIVE',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(activatedAfterPlanned),
                resumed.commitmentId());

        Fixture replaced = insertFixture(date);
        insertSchedulingConfiguration(
                replaced,
                LocalTime.of(10, 0),
                activatedBeforePlanned,
                0);
        DeliveryIds replacedDelivery =
                insertPendingDelivery(replaced, 0, TEST_NOW);
        jdbc.update(
                "DELETE FROM commitment_occurrences WHERE id = ?",
                replaced.occurrenceId());
        insertOccurrence(
                UUID.randomUUID(),
                replaced.commitmentId(),
                date,
                activatedAfterPlanned);

        NotificationEmailTransport transport =
                mock(NotificationEmailTransport.class);
        NotificationOutboxWorker worker =
                new NotificationOutboxWorker(
                        leases,
                        contexts,
                        preferences,
                        reminderRules,
                        new ReminderTimePolicy(),
                        transport,
                        retryPolicy,
                        notificationProperties,
                        Clock.fixed(TEST_NOW, ZoneOffset.UTC));

        assertThat(worker.processDueBatch()).isEqualTo(3);
        verify(transport, times(0)).send(any());
        for (DeliveryIds delivery :
                List.of(
                        editedDelivery,
                        resumedDelivery,
                        replacedDelivery)) {
            assertThat(status("notification_deliveries", delivery.deliveryId()))
                    .isEqualTo("SUPPRESSED");
            assertThat(status("outbox_events", delivery.eventId()))
                    .isEqualTo("PROCESSED");
        }
    }

    @Test
    void workerReconcilesSameSemanticRuleTimeOccurrenceAndQuietDeferredTraceBeforeDelivery() {
        LocalDate date = LocalDate.of(2026, 7, 26);
        Instant initialActivation =
                Instant.parse("2026-07-26T07:00:00Z");
        Instant initialPlanned =
                Instant.parse("2026-07-26T09:00:00Z");
        Instant replacementActivation =
                Instant.parse("2026-07-26T09:15:00Z");
        Instant workerNow =
                Instant.parse("2026-07-26T11:05:00Z");
        Instant currentEffectiveDelivery =
                Instant.parse("2026-07-26T11:00:00Z");
        Fixture fixture = insertFixture(date);
        insertSchedulingConfiguration(
                fixture,
                LocalTime.of(9, 0),
                initialActivation,
                0);
        UUID ruleSetId =
                jdbc.queryForObject(
                        """
                        SELECT id
                        FROM reminder_rule_sets
                        WHERE household_id = ?
                          AND scope_type = 'HOUSEHOLD'
                        """,
                        UUID.class,
                        fixture.householdId());
        UUID initialRuleId =
                jdbc.queryForObject(
                        """
                        SELECT id
                        FROM reminder_rules
                        WHERE rule_set_id = ?
                          AND channel = 'EMAIL'
                          AND offset_days = 0
                        """,
                        UUID.class,
                        ruleSetId);
        DeliveryIds queued =
                insertPendingDelivery(
                        fixture,
                        0,
                        workerNow,
                        initialPlanned,
                        initialPlanned);
        UUID notificationId =
                jdbc.queryForObject(
                        """
                        SELECT notification_id
                        FROM notification_deliveries
                        WHERE id = ?
                        """,
                        UUID.class,
                        queued.deliveryId());
        jdbc.update(
                """
                UPDATE notifications
                SET reminder_rule_id = ?
                WHERE id = ?
                """,
                initialRuleId,
                notificationId);

        jdbc.update(
                "DELETE FROM commitment_occurrences WHERE id = ?",
                fixture.occurrenceId());
        UUID replacementOccurrenceId = UUID.randomUUID();
        insertOccurrence(
                replacementOccurrenceId,
                fixture.commitmentId(),
                date,
                replacementActivation);
        jdbc.update(
                "DELETE FROM reminder_rules WHERE id = ?",
                initialRuleId);
        UUID replacementRuleId = UUID.randomUUID();
        OffsetDateTime databaseReplacementActivation =
                databaseTime(replacementActivation);
        jdbc.update(
                """
                UPDATE reminder_rule_sets
                SET activated_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                databaseReplacementActivation,
                databaseReplacementActivation,
                ruleSetId);
        jdbc.update(
                """
                INSERT INTO reminder_rules (
                    id, rule_set_id, channel, offset_days, local_send_time,
                    enabled, activated_at, created_at, updated_at
                ) VALUES (?, ?, 'EMAIL', 0, '09:30', TRUE, ?, ?, ?)
                """,
                replacementRuleId,
                ruleSetId,
                databaseReplacementActivation,
                databaseReplacementActivation,
                databaseReplacementActivation);
        jdbc.update(
                """
                UPDATE notification_preferences
                SET quiet_hours_enabled = TRUE,
                    quiet_start = '09:00',
                    quiet_end = '11:00',
                    updated_at = ?
                WHERE user_id = ?
                """,
                databaseReplacementActivation,
                fixture.userId());

        NotificationEmailTransport transport =
                mock(NotificationEmailTransport.class);
        NotificationOutboxWorker worker =
                new NotificationOutboxWorker(
                        leases,
                        contexts,
                        preferences,
                        reminderRules,
                        new ReminderTimePolicy(),
                        transport,
                        retryPolicy,
                        notificationProperties,
                        Clock.fixed(workerNow, ZoneOffset.UTC));

        assertThat(worker.processDueBatch()).isOne();

        verify(transport)
                .send(
                        new NotificationEmailTransport.EmailEnvelope(
                                "delivery@example.test",
                                NotificationSemanticKey.messageId(
                                        semanticKey(notificationId)),
                                NotificationOutboxWorker.EMAIL_SUBJECT,
                                NotificationOutboxWorker.EMAIL_BODY));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT occurrence_id FROM notifications WHERE id = ?",
                                UUID.class,
                                notificationId))
                .isEqualTo(replacementOccurrenceId)
                .isNotEqualTo(fixture.occurrenceId());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT reminder_rule_id FROM notifications WHERE id = ?",
                                UUID.class,
                                notificationId))
                .isEqualTo(replacementRuleId)
                .isNotEqualTo(initialRuleId);
        Instant reconciledPlannedFor =
                jdbc.queryForObject(
                        "SELECT planned_for FROM notifications WHERE id = ?",
                        (row, ignored) ->
                                row.getObject(
                                                "planned_for",
                                                OffsetDateTime.class)
                                        .toInstant(),
                        notificationId);
        assertThat(reconciledPlannedFor)
                .isEqualTo(currentEffectiveDelivery)
                .isNotEqualTo(initialPlanned);
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT optimistic_version
                                FROM notifications
                                WHERE id = ?
                                """,
                                Long.class,
                                notificationId))
                .isOne();
        assertThat(status("notification_deliveries", queued.deliveryId()))
                .isEqualTo("DELIVERED");
        assertThat(status("outbox_events", queued.eventId()))
                .isEqualTo("PROCESSED");
        assertThat(attemptCount("notification_deliveries", queued.deliveryId()))
                .isOne();
        assertThat(attemptCount("outbox_events", queued.eventId())).isOne();
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM notifications n
                                JOIN notification_deliveries d
                                  ON d.notification_id = n.id
                                JOIN outbox_events o
                                  ON o.delivery_id = d.id
                                WHERE n.semantic_key = o.idempotency_key
                                  AND n.id = ?
                                  AND d.lease_token IS NULL
                                  AND d.lease_until IS NULL
                                  AND o.lease_token IS NULL
                                  AND o.lease_until IS NULL
                                """,
                                Integer.class,
                                notificationId))
                .isOne();
    }

    @Test
    void reconciliationSuppressesInvalidQueuedRowsAndPreservesValidQueue() {
        LocalDate date = LocalDate.of(2026, 7, 26);

        Fixture optedOut = insertFixture(date);
        insertSchedulingConfiguration(
                optedOut,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        insertPendingDelivery(optedOut, 0, TEST_NOW);
        jdbc.update(
                """
                UPDATE notification_preferences
                SET enabled = FALSE,
                    updated_at = ?
                WHERE user_id = ?
                """,
                databaseTime(TEST_NOW),
                optedOut.userId());

        Fixture paused = insertFixture(date);
        insertSchedulingConfiguration(
                paused,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        insertPendingDelivery(paused, 0, TEST_NOW);
        jdbc.update(
                "UPDATE recurring_commitments SET status = 'PAUSED' WHERE id = ?",
                paused.commitmentId());

        Fixture archived = insertFixture(date);
        insertSchedulingConfiguration(
                archived,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        insertPendingDelivery(archived, 0, TEST_NOW);
        jdbc.update(
                "UPDATE recurring_commitments SET status = 'ARCHIVED' WHERE id = ?",
                archived.commitmentId());

        Fixture ruleRemoved = insertFixture(date);
        insertSchedulingConfiguration(
                ruleRemoved,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        insertPendingDelivery(ruleRemoved, 0, TEST_NOW);
        jdbc.update(
                """
                UPDATE reminder_rules rule
                SET enabled = FALSE,
                    updated_at = ?
                FROM reminder_rule_sets rule_set
                WHERE rule.rule_set_id = rule_set.id
                  AND rule_set.household_id = ?
                """,
                databaseTime(TEST_NOW),
                ruleRemoved.householdId());

        Fixture occurrenceRemoved = insertFixture(date);
        insertSchedulingConfiguration(
                occurrenceRemoved,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        insertPendingDelivery(occurrenceRemoved, 0, TEST_NOW);
        jdbc.update(
                "DELETE FROM commitment_occurrences WHERE id = ?",
                occurrenceRemoved.occurrenceId());

        Fixture missingPreference = insertFixture(date);
        insertPendingDelivery(missingPreference, 0, TEST_NOW);

        Fixture editedAfterPlanned = insertFixture(date);
        insertSchedulingConfiguration(
                editedAfterPlanned,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        DeliveryIds editedAfterPlannedDelivery =
                insertPendingDelivery(
                        editedAfterPlanned, 0, TEST_NOW);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET display_name = 'Edited queued commitment',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(TEST_NOW.plusSeconds(1)),
                editedAfterPlanned.commitmentId());

        Fixture resumedAfterPlanned = insertFixture(date);
        insertSchedulingConfiguration(
                resumedAfterPlanned,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        DeliveryIds resumedAfterPlannedDelivery =
                insertPendingDelivery(
                        resumedAfterPlanned, 0, TEST_NOW);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET status = 'PAUSED',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(TEST_NOW.minus(Duration.ofHours(1))),
                resumedAfterPlanned.commitmentId());
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET status = 'ACTIVE',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(TEST_NOW.plusSeconds(1)),
                resumedAfterPlanned.commitmentId());

        Fixture occurrenceReplacedAfterPlanned = insertFixture(date);
        insertSchedulingConfiguration(
                occurrenceReplacedAfterPlanned,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        DeliveryIds occurrenceReplacedAfterPlannedDelivery =
                insertPendingDelivery(
                        occurrenceReplacedAfterPlanned, 0, TEST_NOW);
        jdbc.update(
                "DELETE FROM commitment_occurrences WHERE id = ?",
                occurrenceReplacedAfterPlanned.occurrenceId());
        insertOccurrence(
                UUID.randomUUID(),
                occurrenceReplacedAfterPlanned.commitmentId(),
                date,
                TEST_NOW.plusSeconds(1));

        Fixture editedDuringQuietDeferral = insertFixture(date);
        insertSchedulingConfiguration(
                editedDuringQuietDeferral,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        jdbc.update(
                """
                UPDATE notification_preferences
                SET quiet_hours_enabled = TRUE,
                    quiet_start = '09:00',
                    quiet_end = '11:00',
                    updated_at = ?
                WHERE user_id = ?
                """,
                databaseTime(TEST_NOW.minus(Duration.ofHours(1))),
                editedDuringQuietDeferral.userId());
        DeliveryIds editedDuringQuietDeferralDelivery =
                insertPendingDelivery(
                        editedDuringQuietDeferral,
                        0,
                        TEST_NOW.plus(Duration.ofHours(1)),
                        TEST_NOW.plus(Duration.ofHours(1)),
                        TEST_NOW);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET display_name = 'Edited queued quiet-hour commitment',
                    updated_at = ?
                WHERE id = ?
                """,
                databaseTime(TEST_NOW.plus(Duration.ofMinutes(30))),
                editedDuringQuietDeferral.commitmentId());

        Fixture valid = insertFixture(date);
        insertSchedulingConfiguration(
                valid,
                LocalTime.of(10, 0),
                TEST_NOW.minus(Duration.ofHours(1)),
                0);
        DeliveryIds validDelivery =
                insertPendingDelivery(valid, 0, TEST_NOW);

        assertThat(reconciliation.recoverExpiredLeases()).isEqualTo(6);
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM notification_deliveries
                                WHERE status = 'SUPPRESSED'
                                  AND failure_category = 'DELIVERY_INVALIDATED'
                                  AND suppressed_at IS NOT NULL
                                """,
                                Integer.class))
                .isEqualTo(6);
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*)
                                FROM outbox_events
                                WHERE status = 'PROCESSED'
                                  AND last_failure_category = 'DELIVERY_INVALIDATED'
                                  AND processed_at IS NOT NULL
                                """,
                                Integer.class))
                .isEqualTo(6);
        for (DeliveryIds revalidatedAtDelivery :
                List.of(
                        editedAfterPlannedDelivery,
                        resumedAfterPlannedDelivery,
                        occurrenceReplacedAfterPlannedDelivery,
                        editedDuringQuietDeferralDelivery)) {
            assertThat(
                            status(
                                    "notification_deliveries",
                                    revalidatedAtDelivery.deliveryId()))
                    .isEqualTo("PENDING");
            assertThat(
                            status(
                                    "outbox_events",
                                    revalidatedAtDelivery.eventId()))
                    .isEqualTo("PENDING");
        }
        assertThat(status("notification_deliveries", validDelivery.deliveryId()))
                .isEqualTo("PENDING");
        assertThat(status("outbox_events", validDelivery.eventId()))
                .isEqualTo("PENDING");
    }

    private Fixture insertFixture(LocalDate scheduledDate) {
        UUID userId = UUID.randomUUID();
        UUID householdId = UUID.randomUUID();
        UUID commitmentId = UUID.randomUUID();
        UUID occurrenceId = UUID.randomUUID();
        OffsetDateTime createdAt =
                OffsetDateTime.of(
                        2026, 7, 26, 9, 0, 0, 0, ZoneOffset.UTC);
        jdbc.update(
                """
                INSERT INTO users (
                    id, oidc_subject, email, display_name, timezone, locale,
                    age_confirmed_at, privacy_notice_accepted_at,
                    privacy_notice_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'UTC', 'en-IN', ?, ?, 'foundation-v1', ?, ?)
                """,
                userId,
                "notification-it-" + userId,
                "delivery@example.test",
                "Notification Test",
                createdAt,
                createdAt,
                createdAt,
                createdAt);
        jdbc.update(
                """
                INSERT INTO households (
                    id, name, owner_user_id, default_currency, timezone,
                    created_at, updated_at
                ) VALUES (?, 'Notification household', ?, 'INR', 'UTC', ?, ?)
                """,
                householdId,
                userId,
                createdAt,
                createdAt);
        jdbc.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'OWNER', 'ACTIVE', 0, ?, NULL, ?, ?)
                """,
                householdId,
                householdId,
                userId,
                createdAt,
                createdAt,
                createdAt);
        jdbc.update(
                """
                INSERT INTO recurring_commitments (
                    id, household_id, data_owner_user_id, merchant_id,
                    display_name, category,
                    payment_rail, amount_minor, estimated_amount_minor, currency,
                    frequency, interval_count, custom_interval_unit, anchor_date,
                    month_day_policy, next_due_date, variable_amount,
                    masked_payment_label, source, source_confidence, visibility,
                    status, optimistic_version, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, NULL, 'Notification commitment', 'SUBSCRIPTION',
                    'CARD_RECURRING', 49900, NULL, 'INR',
                    'MONTHLY', 1, NULL, ?, 'ANCHOR_DAY', ?,
                    FALSE, NULL, 'MANUAL', NULL, 'PRIVATE',
                    'ACTIVE', 0, ?, ?
                )
                """,
                commitmentId,
                householdId,
                userId,
                scheduledDate,
                scheduledDate,
                createdAt,
                createdAt);
        insertOccurrence(occurrenceId, commitmentId, scheduledDate);
        return new Fixture(
                userId,
                householdId,
                commitmentId,
                occurrenceId,
                scheduledDate);
    }

    private void insertOccurrence(
            UUID occurrenceId, UUID commitmentId, LocalDate date) {
        insertOccurrence(
                occurrenceId,
                commitmentId,
                date,
                Instant.parse("2026-07-26T09:00:00Z"));
    }

    private void insertOccurrence(
            UUID occurrenceId,
            UUID commitmentId,
            LocalDate date,
            Instant createdAt) {
        OffsetDateTime databaseCreatedAt = databaseTime(createdAt);
        jdbc.update(
                """
                INSERT INTO commitment_occurrences (
                    id, commitment_id, scheduled_date, expected_amount_minor,
                    currency, amount_kind, state, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 49900, 'INR', 'FIXED', 'UPCOMING',
                    ?, ?
                )
                """,
                occurrenceId,
                commitmentId,
                date,
                databaseCreatedAt,
                databaseCreatedAt);
    }

    private void moveCommitmentAndOccurrenceActivation(
            Fixture fixture, Instant activatedAt) {
        OffsetDateTime databaseActivation = databaseTime(activatedAt);
        jdbc.update(
                """
                UPDATE recurring_commitments
                SET created_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                databaseActivation,
                databaseActivation,
                fixture.commitmentId());
        jdbc.update(
                """
                UPDATE commitment_occurrences
                SET created_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                databaseActivation,
                databaseActivation,
                fixture.occurrenceId());
    }

    private void insertSchedulingConfiguration(
            Fixture fixture, LocalTime sendTime, Instant activatedAt) {
        insertSchedulingConfiguration(fixture, sendTime, activatedAt, 3);
    }

    private void insertSchedulingConfiguration(
            Fixture fixture,
            LocalTime sendTime,
            Instant activatedAt,
            int offsetDays) {
        UUID ruleSetId = UUID.randomUUID();
        UUID ruleId = UUID.randomUUID();
        OffsetDateTime databaseActivation =
                databaseTime(activatedAt);
        jdbc.update(
                """
                INSERT INTO notification_preferences (
                    id, user_id, enabled, in_app_enabled, email_enabled,
                    timezone, quiet_hours_enabled, quiet_start, quiet_end,
                    enabled_at, in_app_enabled_at, email_enabled_at,
                    optimistic_version, created_at, updated_at
                ) VALUES (
                    ?, ?, TRUE, FALSE, TRUE,
                    'UTC', FALSE, NULL, NULL,
                    ?, NULL, ?, 1, ?, ?
                )
                """,
                UUID.randomUUID(),
                fixture.userId(),
                databaseActivation,
                databaseActivation,
                databaseActivation,
                databaseActivation);
        jdbc.update(
                """
                INSERT INTO reminder_rule_sets (
                    id, household_id, commitment_id, scope_type,
                    scope_reference_id, mode, activated_at,
                    optimistic_version, created_at, updated_at
                ) VALUES (?, ?, NULL, 'HOUSEHOLD', ?, 'CUSTOM', ?, 1, ?, ?)
                """,
                ruleSetId,
                fixture.householdId(),
                fixture.householdId(),
                databaseActivation,
                databaseActivation,
                databaseActivation);
        jdbc.update(
                """
                INSERT INTO reminder_rules (
                    id, rule_set_id, channel, offset_days, local_send_time,
                    enabled, activated_at, created_at, updated_at
                ) VALUES (?, ?, 'EMAIL', ?, ?, TRUE, ?, ?, ?)
                """,
                ruleId,
                ruleSetId,
                offsetDays,
                sendTime,
                databaseActivation,
                databaseActivation,
                databaseActivation);
    }

    private UUID insertNotificationOnly(
            Fixture fixture,
            UUID occurrenceId,
            LocalDate date,
            NotificationChannel channel,
            int offsetDays,
            String semanticKey) {
        return insertNotificationOnly(
                fixture,
                occurrenceId,
                date,
                channel,
                offsetDays,
                semanticKey,
                TEST_NOW,
                TEST_NOW);
    }

    private UUID insertNotificationOnly(
            Fixture fixture,
            UUID occurrenceId,
            LocalDate date,
            NotificationChannel channel,
            int offsetDays,
            String semanticKey,
            Instant plannedFor,
            Instant createdAt) {
        UUID id = UUID.randomUUID();
        OffsetDateTime databasePlannedFor = databaseTime(plannedFor);
        OffsetDateTime databaseCreatedAt = databaseTime(createdAt);
        jdbc.update(
                """
                INSERT INTO notifications (
                    id, recipient_user_id, household_id, commitment_id,
                    occurrence_id, reminder_rule_id, scheduled_date, channel,
                    offset_days, planned_for, semantic_key, read_at,
                    optimistic_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
                """,
                id,
                fixture.userId(),
                fixture.householdId(),
                fixture.commitmentId(),
                occurrenceId,
                date,
                channel.name(),
                offsetDays,
                databasePlannedFor,
                semanticKey,
                databaseCreatedAt,
                databaseCreatedAt);
        return id;
    }

    private boolean insertCompetingNotification(
            CountDownLatch start,
            Fixture fixture,
            UUID occurrenceId,
            LocalDate date,
            String semanticKey) {
        await(start);
        try {
            insertNotificationOnly(
                    fixture,
                    occurrenceId,
                    date,
                    NotificationChannel.EMAIL,
                    5,
                    semanticKey);
            return true;
        } catch (DataAccessException expectedDuplicate) {
            return false;
        }
    }

    private DeliveryIds insertPendingDelivery(
            Fixture fixture, int offsetDays, Instant availableAt) {
        return insertPendingDelivery(
                fixture,
                offsetDays,
                availableAt,
                TEST_NOW,
                TEST_NOW);
    }

    private DeliveryIds insertPendingDelivery(
            Fixture fixture,
            int offsetDays,
            Instant availableAt,
            Instant plannedFor,
            Instant notificationCreatedAt) {
        String semanticKey =
                NotificationSemanticKey.create(
                        fixture.userId(),
                        fixture.householdId(),
                        fixture.commitmentId(),
                        fixture.scheduledDate(),
                        NotificationChannel.EMAIL,
                        offsetDays);
        UUID notificationId =
                insertNotificationOnly(
                        fixture,
                        fixture.occurrenceId(),
                        fixture.scheduledDate(),
                        NotificationChannel.EMAIL,
                        offsetDays,
                        semanticKey,
                        plannedFor,
                        notificationCreatedAt);
        NotificationDeliveryEntity delivery =
                deliveries.saveAndFlush(
                        NotificationDeliveryEntity.pending(
                                notificationId, availableAt, availableAt));
        OutboxEventEntity event =
                outbox.saveAndFlush(
                        OutboxEventEntity.pending(
                                delivery.id(),
                                semanticKey,
                                availableAt,
                                availableAt));
        return new DeliveryIds(delivery.id(), event.id());
    }

    private DeliveryIds deliveryForCommitment(UUID commitmentId) {
        return jdbc.queryForObject(
                """
                SELECT d.id AS delivery_id, o.id AS event_id
                FROM notifications n
                JOIN notification_deliveries d ON d.notification_id = n.id
                JOIN outbox_events o ON o.delivery_id = d.id
                WHERE n.commitment_id = ?
                """,
                (row, ignored) ->
                        new DeliveryIds(
                                row.getObject("delivery_id", UUID.class),
                                row.getObject("event_id", UUID.class)),
                commitmentId);
    }

    private SavedAuthorization savedAuthorization(
            Fixture fixture, DeliveryIds delivery) {
        SavedPreference preference =
                jdbc.queryForObject(
                        """
                        SELECT id, optimistic_version
                        FROM notification_preferences
                        WHERE user_id = ?
                        """,
                        (row, ignored) ->
                                new SavedPreference(
                                        row.getObject("id", UUID.class),
                                        row.getLong("optimistic_version")),
                        fixture.userId());
        UUID ruleId =
                jdbc.queryForObject(
                        """
                        SELECT rule.id
                        FROM reminder_rules rule
                        JOIN reminder_rule_sets rule_set
                          ON rule_set.id = rule.rule_set_id
                        WHERE rule_set.household_id = ?
                          AND rule.channel = 'EMAIL'
                          AND rule.offset_days = 0
                        """,
                        UUID.class,
                        fixture.householdId());
        long commitmentVersion =
                jdbc.queryForObject(
                        """
                        SELECT optimistic_version
                        FROM recurring_commitments
                        WHERE id = ?
                        """,
                        Long.class,
                        fixture.commitmentId());
        UUID notificationId =
                jdbc.queryForObject(
                        """
                        SELECT notification_id
                        FROM notification_deliveries
                        WHERE id = ?
                        """,
                        UUID.class,
                        delivery.deliveryId());
        return new SavedAuthorization(
                preference.id(),
                preference.version(),
                commitmentVersion,
                ruleId,
                notificationId);
    }

    private int notificationCount(
            UUID commitmentId, LocalDate date, int offsetDays) {
        return jdbc.queryForObject(
                """
                SELECT count(*)
                FROM notifications
                WHERE commitment_id = ?
                  AND scheduled_date = ?
                  AND channel = 'EMAIL'
                  AND offset_days = ?
                """,
                Integer.class,
                commitmentId,
                date,
                offsetDays);
    }

    private String semanticKey(UUID notificationId) {
        return jdbc.queryForObject(
                "SELECT semantic_key FROM notifications WHERE id = ?",
                String.class,
                notificationId);
    }

    private String status(String table, UUID id) {
        return jdbc.queryForObject(
                "SELECT status FROM " + table + " WHERE id = ?",
                String.class,
                id);
    }

    private int attemptCount(String table, UUID id) {
        return jdbc.queryForObject(
                "SELECT attempt_count FROM " + table + " WHERE id = ?",
                Integer.class,
                id);
    }

    private Instant availableAt(String table, UUID id) {
        return jdbc.queryForObject(
                "SELECT available_at FROM " + table + " WHERE id = ?",
                (row, ignored) ->
                        row.getObject(
                                        "available_at",
                                        OffsetDateTime.class)
                                .toInstant(),
                id);
    }

    private NotificationTrace trace(UUID notificationId) {
        return jdbc.queryForObject(
                """
                SELECT occurrence_id, reminder_rule_id, planned_for,
                       optimistic_version
                FROM notifications
                WHERE id = ?
                """,
                (row, ignored) ->
                        new NotificationTrace(
                                row.getObject("occurrence_id", UUID.class),
                                row.getObject("reminder_rule_id", UUID.class),
                                row.getObject(
                                                "planned_for",
                                                OffsetDateTime.class)
                                        .toInstant(),
                                row.getLong("optimistic_version")),
                notificationId);
    }

    private static String randomKey() {
        return UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", "");
    }

    private static OffsetDateTime databaseTime(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static Jwt identity(Fixture fixture) {
        String subject = "notification-it-" + fixture.userId();
        return Jwt.withTokenValue("fake")
                .header("alg", "none")
                .subject(subject)
                .claim("email", "delivery@example.test")
                .claim("name", "Notification Test")
                .build();
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    private record Fixture(
            UUID userId,
            UUID householdId,
            UUID commitmentId,
            UUID occurrenceId,
            LocalDate scheduledDate) {}

    private record DeliveryIds(UUID deliveryId, UUID eventId) {}

    private record SavedPreference(UUID id, long version) {}

    private record SavedAuthorization(
            UUID preferenceId,
            long preferenceVersion,
            long commitmentVersion,
            UUID ruleId,
            UUID notificationId) {}

    private record NotificationTrace(
            UUID occurrenceId,
            UUID reminderRuleId,
            Instant plannedFor,
            long version) {}

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedClockConfiguration {

        @Bean
        @Primary
        Clock notificationDeliveryTestClock() {
            return Clock.fixed(TEST_NOW, ZoneOffset.UTC);
        }
    }
}
