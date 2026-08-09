package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import in.autopayguard.api.reminder.EffectiveReminderRules;
import in.autopayguard.api.reminder.ReminderRuleService;
import in.autopayguard.api.reminder.ReminderRuleSnapshot;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class NotificationOutboxWorkerTest {

    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID HOUSEHOLD_ID = UUID.randomUUID();
    private static final UUID COMMITMENT_ID = UUID.randomUUID();
    private static final UUID OCCURRENCE_ID = UUID.randomUUID();
    private static final UUID DELIVERY_ID = UUID.randomUUID();
    private static final UUID EVENT_ID = UUID.randomUUID();
    private static final UUID LEASE_TOKEN = UUID.randomUUID();
    private static final UUID RULE_ID = UUID.randomUUID();
    private static final String SEMANTIC_KEY = "c".repeat(64);

    @Test
    void smtpAcceptanceFollowedByDatabaseFailureRemainsRecoverable()
            throws Exception {
        Instant now = Instant.parse("2026-07-26T10:05:00Z");
        Harness harness =
                harness(
                        now,
                        context(
                                LocalDate.of(2026, 7, 26),
                                LocalTime.of(10, 0),
                                true),
                        preference(false, null, null),
                        rule(LocalTime.of(10, 0)));
        doThrow(new IllegalStateException("database unavailable"))
                .when(harness.leases())
                .delivered(any(), any(), any());

        int processed = harness.worker().processDueBatch();

        assertThat(processed).isOne();
        verify(harness.transport()).send(
                new NotificationEmailTransport.EmailEnvelope(
                        "worker@example.test",
                        NotificationSemanticKey.messageId(SEMANTIC_KEY),
                        NotificationOutboxWorker.EMAIL_SUBJECT,
                        NotificationOutboxWorker.EMAIL_BODY));
        verify(harness.leases())
                .delivered(
                        eq(harness.claim()),
                        eq(NotificationSemanticKey.messageId(SEMANTIC_KEY)),
                        eq(now));
        verify(harness.leases(), never())
                .failed(any(), any(), org.mockito.ArgumentMatchers.anyBoolean(), any(), any());
        verify(harness.leases(), never()).suppressed(any(), any(), any());
    }

    @Test
    void invalidatedOccurrenceIsSuppressedBeforeAnyProviderCall() {
        Instant now = Instant.parse("2026-07-26T10:05:00Z");
        Harness harness =
                harness(
                        now,
                        context(
                                LocalDate.of(2026, 7, 26),
                                LocalTime.of(10, 0),
                                false),
                        preference(false, null, null),
                        rule(LocalTime.of(10, 0)));

        assertThat(harness.worker().processDueBatch()).isOne();

        verify(harness.leases())
                .suppressed(
                        harness.claim(),
                        NotificationFailureCategory.DELIVERY_INVALIDATED,
                        now);
        verify(harness.transport(), never()).send(any());
        verify(harness.leases(), never()).delivered(any(), any(), any());
    }

    @Test
    void globalOrChannelOptOutIsSuppressedBeforeAnyProviderCall() {
        Instant now = Instant.parse("2026-07-26T10:05:00Z");
        NotificationPreferenceSnapshot optedOut =
                new NotificationPreferenceSnapshot(
                        UUID.randomUUID(),
                        USER_ID,
                        true,
                        true,
                        false,
                        ZoneOffset.UTC,
                        false,
                        null,
                        null,
                        Instant.parse("2026-07-26T08:00:00Z"),
                        Instant.parse("2026-07-26T08:00:00Z"),
                        null,
                        1);
        Harness harness =
                harness(
                        now,
                        context(
                                LocalDate.of(2026, 7, 26),
                                LocalTime.of(10, 0),
                                true),
                        optedOut,
                        rule(LocalTime.of(10, 0)));

        assertThat(harness.worker().processDueBatch()).isOne();

        verify(harness.leases())
                .suppressed(
                        harness.claim(),
                        NotificationFailureCategory.DELIVERY_INVALIDATED,
                        now);
        verify(harness.transport(), never()).send(any());
    }

    @Test
    void pausedAndArchivedCommitmentsAreSuppressedBeforeAnyProviderCall() {
        Instant now = Instant.parse("2026-07-26T10:05:00Z");
        for (String status : List.of("PAUSED", "ARCHIVED")) {
            Harness harness =
                    harness(
                            now,
                            context(
                                    LocalDate.of(2026, 7, 26),
                                    LocalTime.of(10, 0),
                                    true,
                                    status),
                            preference(false, null, null),
                            rule(LocalTime.of(10, 0)));

            assertThat(harness.worker().processDueBatch()).isOne();
            verify(harness.leases())
                    .suppressed(
                            harness.claim(),
                            NotificationFailureCategory.DELIVERY_INVALIDATED,
                            now);
            verify(harness.transport(), never()).send(any());
        }
    }

    @Test
    void removedOrDisabledRuleIsSuppressedBeforeAnyProviderCall() {
        Instant now = Instant.parse("2026-07-26T10:05:00Z");
        Harness harness =
                harness(
                        now,
                        context(
                                LocalDate.of(2026, 7, 26),
                                LocalTime.of(10, 0),
                                true),
                        preference(false, null, null),
                        rule(LocalTime.of(10, 0)));
        when(harness.rules()
                        .resolveEffectiveForScheduling(
                                HOUSEHOLD_ID, COMMITMENT_ID))
                .thenReturn(EffectiveReminderRules.disabled());

        assertThat(harness.worker().processDueBatch()).isOne();

        verify(harness.leases())
                .suppressed(
                        harness.claim(),
                        NotificationFailureCategory.DELIVERY_INVALIDATED,
                        now);
        verify(harness.transport(), never()).send(any());
    }

    @Test
    void quietDeferralBeyondOccurrenceDayIsSuppressed() {
        Instant now = Instant.parse("2026-07-26T23:35:00Z");
        Harness harness =
                harness(
                        now,
                        context(
                                LocalDate.of(2026, 7, 26),
                                LocalTime.of(23, 30),
                                true),
                        preference(
                                true,
                                LocalTime.of(23, 0),
                                LocalTime.of(1, 0)),
                        rule(LocalTime.of(23, 30)));

        assertThat(harness.worker().processDueBatch()).isOne();

        verify(harness.leases())
                .suppressed(
                        harness.claim(),
                        NotificationFailureCategory.QUIET_HOURS_EXPIRED,
                        now);
        verify(harness.transport(), never()).send(any());
    }

    @Test
    void transientProviderFailureUsesTheFrozenRetryPolicy() {
        Instant now = Instant.parse("2026-07-26T10:05:00Z");
        Harness harness =
                harness(
                        now,
                        context(
                                LocalDate.of(2026, 7, 26),
                                LocalTime.of(10, 0),
                                true),
                        preference(false, null, null),
                        rule(LocalTime.of(10, 0)));
        doThrow(
                        new NotificationDeliveryException(
                                NotificationFailureCategory.PROVIDER_TIMEOUT,
                                true))
                .when(harness.transport())
                .send(any());

        assertThat(harness.worker().processDueBatch()).isOne();

        verify(harness.leases())
                .failed(
                        harness.claim(),
                        NotificationFailureCategory.PROVIDER_TIMEOUT,
                        true,
                        now,
                        harness.retryPolicy());
        verify(harness.leases(), never()).delivered(any(), any(), any());
    }

    @Test
    void lostLeaseDuringTraceReconciliationStopsBeforeAnyProviderCall() {
        Instant now = Instant.parse("2026-07-26T10:05:00Z");
        Harness harness =
                harness(
                        now,
                        context(
                                LocalDate.of(2026, 7, 26),
                                LocalTime.of(10, 0),
                                true),
                        preference(false, null, null),
                        rule(LocalTime.of(10, 0)));
        doThrow(new IllegalStateException("lease expired"))
                .when(harness.leases())
                .reconcileTrace(
                        any(),
                        any(),
                        anyLong(),
                        anyLong(),
                        any(),
                        any(),
                        any(),
                        any(),
                        any());

        assertThat(harness.worker().processDueBatch()).isOne();

        verify(harness.transport(), never()).send(any());
        verify(harness.leases(), never()).delivered(any(), any(), any());
        verify(harness.leases(), never())
                .failed(any(), any(), org.mockito.ArgumentMatchers.anyBoolean(), any(), any());
    }

    @Test
    void stalePreferenceReconciliationRequeuesWithoutConsumingAttemptOrCallingProvider() {
        Instant now = Instant.parse("2026-07-26T10:05:00Z");
        Harness harness =
                harness(
                        now,
                        context(
                                LocalDate.of(2026, 7, 26),
                                LocalTime.of(10, 0),
                                true),
                        preference(false, null, null),
                        rule(LocalTime.of(10, 0)));
        when(harness.leases()
                        .reconcileTrace(
                                any(),
                                any(),
                                anyLong(),
                                anyLong(),
                                any(),
                                any(),
                                any(),
                                any(),
                                any()))
                .thenReturn(false);

        assertThat(harness.worker().processDueBatch()).isOne();

        verify(harness.leases()).deferred(harness.claim(), now, now);
        verify(harness.transport(), never()).send(any());
        verify(harness.leases(), never()).delivered(any(), any(), any());
        verify(harness.leases(), never())
                .failed(any(), any(), org.mockito.ArgumentMatchers.anyBoolean(), any(), any());
        verify(harness.leases(), never()).suppressed(any(), any(), any());
    }

    @Test
    void leaseExpiringDuringAuthorizationStopsBeforeAnyProviderCall() {
        Instant start = Instant.parse("2026-07-26T10:05:00Z");
        Instant expired = start.plus(Duration.ofMinutes(3));
        Duration leaseDuration = Duration.ofMinutes(2);
        Clock clock = mock(Clock.class);
        when(clock.instant()).thenReturn(start, start, start, expired);
        OutboxLeaseRepository leases = mock(OutboxLeaseRepository.class);
        NotificationDeliveryContextRepository contexts =
                mock(NotificationDeliveryContextRepository.class);
        NotificationPreferenceService preferences =
                mock(NotificationPreferenceService.class);
        ReminderRuleService rules = mock(ReminderRuleService.class);
        NotificationEmailTransport transport =
                mock(NotificationEmailTransport.class);
        NotificationRetryPolicy retryPolicy = new NotificationRetryPolicy();
        OutboxLeaseRepository.OutboxClaim claim =
                new OutboxLeaseRepository.OutboxClaim(
                        EVENT_ID, DELIVERY_ID, LEASE_TOKEN, 1);
        NotificationProperties properties =
                new NotificationProperties(
                        "-",
                        "-",
                        "-",
                        1,
                        leaseDuration,
                        Duration.ofHours(2),
                        new NotificationProperties.Email(
                                NotificationEmailMode.DISABLED,
                                "no-reply@autopayguard.local",
                                List.of(
                                        "@autopayguard.local",
                                        ".example.test")));
        when(leases.claim(start, 1, leaseDuration))
                .thenReturn(List.of(claim), List.of());
        when(contexts.find(DELIVERY_ID))
                .thenReturn(
                        Optional.of(
                                context(
                                        LocalDate.of(2026, 7, 26),
                                        LocalTime.of(10, 0),
                                        true)));
        when(preferences.findForScheduling(USER_ID))
                .thenReturn(Optional.of(preference(false, null, null)));
        when(rules.resolveEffectiveForScheduling(
                        HOUSEHOLD_ID, COMMITMENT_ID))
                .thenReturn(
                        new EffectiveReminderRules(
                                true,
                                Instant.parse("2026-07-26T08:00:00Z"),
                                List.of(rule(LocalTime.of(10, 0)))));
        when(leases.reconcileTrace(
                        any(),
                        any(),
                        anyLong(),
                        anyLong(),
                        any(),
                        any(),
                        any(),
                        any(),
                        any()))
                .thenReturn(true);
        when(leases.renewBeforeProvider(claim, expired, leaseDuration))
                .thenReturn(false);
        NotificationOutboxWorker worker =
                new NotificationOutboxWorker(
                        leases,
                        contexts,
                        preferences,
                        rules,
                        new ReminderTimePolicy(),
                        transport,
                        retryPolicy,
                        properties,
                        clock);

        assertThat(worker.processDueBatch()).isOne();

        verify(leases).renewBeforeProvider(claim, expired, leaseDuration);
        verify(transport, never()).send(any());
        verify(leases, never()).delivered(any(), any(), any());
        verify(leases, never())
                .failed(any(), any(), org.mockito.ArgumentMatchers.anyBoolean(), any(), any());
    }

    @Test
    void authorizationCrossingCatchUpBoundarySuppressesBeforeProviderCall() {
        Instant start = Instant.parse("2026-07-26T10:05:00Z");
        Instant scheduledFor =
                start.minus(Duration.ofHours(2)).plusSeconds(1);
        Instant providerStart = start.plusSeconds(2);
        Duration leaseDuration = Duration.ofMinutes(2);
        Clock clock = mock(Clock.class);
        when(clock.instant()).thenReturn(start, start, start, providerStart);
        OutboxLeaseRepository leases = mock(OutboxLeaseRepository.class);
        NotificationDeliveryContextRepository contexts =
                mock(NotificationDeliveryContextRepository.class);
        NotificationPreferenceService preferences =
                mock(NotificationPreferenceService.class);
        ReminderRuleService rules = mock(ReminderRuleService.class);
        NotificationEmailTransport transport =
                mock(NotificationEmailTransport.class);
        NotificationRetryPolicy retryPolicy = new NotificationRetryPolicy();
        OutboxLeaseRepository.OutboxClaim claim =
                new OutboxLeaseRepository.OutboxClaim(
                        EVENT_ID, DELIVERY_ID, LEASE_TOKEN, 1);
        NotificationProperties properties =
                new NotificationProperties(
                        "-",
                        "-",
                        "-",
                        1,
                        leaseDuration,
                        Duration.ofHours(2),
                        new NotificationProperties.Email(
                                NotificationEmailMode.DISABLED,
                                "no-reply@autopayguard.local",
                                List.of(
                                        "@autopayguard.local",
                                        ".example.test")));
        LocalDate scheduledDate = LocalDate.of(2026, 7, 26);
        LocalTime scheduledTime =
                scheduledFor.atOffset(ZoneOffset.UTC).toLocalTime();
        when(leases.claim(start, 1, leaseDuration))
                .thenReturn(List.of(claim), List.of());
        when(contexts.find(DELIVERY_ID))
                .thenReturn(
                        Optional.of(
                                context(
                                        scheduledDate,
                                        scheduledTime,
                                        true)));
        when(preferences.findForScheduling(USER_ID))
                .thenReturn(Optional.of(preference(false, null, null)));
        when(rules.resolveEffectiveForScheduling(
                        HOUSEHOLD_ID, COMMITMENT_ID))
                .thenReturn(
                        new EffectiveReminderRules(
                                true,
                                Instant.parse("2026-07-26T07:00:00Z"),
                                List.of(rule(scheduledTime))));
        when(leases.reconcileTrace(
                        any(),
                        any(),
                        anyLong(),
                        anyLong(),
                        any(),
                        any(),
                        any(),
                        any(),
                        any()))
                .thenReturn(true);
        when(leases.renewBeforeProvider(
                        claim, providerStart, leaseDuration))
                .thenReturn(true);
        NotificationOutboxWorker worker =
                new NotificationOutboxWorker(
                        leases,
                        contexts,
                        preferences,
                        rules,
                        new ReminderTimePolicy(),
                        transport,
                        retryPolicy,
                        properties,
                        clock);

        assertThat(worker.processDueBatch()).isOne();

        verify(leases).renewBeforeProvider(claim, providerStart, leaseDuration);
        verify(leases)
                .suppressed(
                        claim,
                        NotificationFailureCategory.DELIVERY_INVALIDATED,
                        providerStart);
        verify(transport, never()).send(any());
        verify(leases, never()).delivered(any(), any(), any());
    }

    @Test
    void slowSequentialSendsLeaseLaterWorkFreshAndPreventMidBatchReclaim() {
        Instant start = Instant.parse("2026-07-26T10:05:00Z");
        Duration leaseDuration = Duration.ofMinutes(2);
        MutableClock clock = new MutableClock(start);
        OutboxLeaseRepository leases = mock(OutboxLeaseRepository.class);
        NotificationDeliveryContextRepository contexts =
                mock(NotificationDeliveryContextRepository.class);
        NotificationPreferenceService preferences =
                mock(NotificationPreferenceService.class);
        ReminderRuleService rules = mock(ReminderRuleService.class);
        NotificationEmailTransport transport =
                mock(NotificationEmailTransport.class);
        NotificationRetryPolicy retryPolicy = new NotificationRetryPolicy();
        NotificationProperties properties =
                new NotificationProperties(
                        "-",
                        "-",
                        "-",
                        3,
                        leaseDuration,
                        Duration.ofHours(2),
                        new NotificationProperties.Email(
                                NotificationEmailMode.DISABLED,
                                "no-reply@autopayguard.local",
                                List.of(
                                        "@autopayguard.local",
                                        ".example.test")));
        List<UUID> deliveryIds =
                List.of(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        UUID.randomUUID());
        Map<UUID, Instant> leasedUntil = new HashMap<>();
        Map<UUID, Integer> attempts = new HashMap<>();
        Set<UUID> delivered = new HashSet<>();
        List<Instant> successfulLeaseStarts = new ArrayList<>();

        when(leases.claim(any(), anyInt(), eq(leaseDuration)))
                .thenAnswer(
                        invocation -> {
                            Instant claimAt = invocation.getArgument(0);
                            int limit = invocation.getArgument(1);
                            List<OutboxLeaseRepository.OutboxClaim> claims =
                                    new ArrayList<>();
                            for (UUID deliveryId : deliveryIds) {
                                Instant currentLease = leasedUntil.get(deliveryId);
                                if (delivered.contains(deliveryId)
                                        || (currentLease != null
                                                && currentLease.isAfter(
                                                        claimAt))) {
                                    continue;
                                }
                                leasedUntil.put(
                                        deliveryId,
                                        claimAt.plus(leaseDuration));
                                successfulLeaseStarts.add(claimAt);
                                claims.add(
                                        new OutboxLeaseRepository.OutboxClaim(
                                                UUID.randomUUID(),
                                                deliveryId,
                                                UUID.randomUUID(),
                                                attempts.merge(
                                                        deliveryId,
                                                        1,
                                                        Integer::sum)));
                                if (claims.size() == limit) {
                                    break;
                                }
                            }
                            return claims;
                        });
        doAnswer(
                        invocation -> {
                            OutboxLeaseRepository.OutboxClaim claim =
                                    invocation.getArgument(0);
                            delivered.add(claim.deliveryId());
                            return null;
                        })
                .when(leases)
                .delivered(any(), any(), any());
        when(contexts.find(any()))
                .thenReturn(
                        Optional.of(
                                context(
                                        LocalDate.of(2026, 7, 26),
                                        LocalTime.of(10, 0),
                                        true)));
        when(preferences.findForScheduling(USER_ID))
                .thenReturn(
                        Optional.of(preference(false, null, null)));
        when(rules.resolveEffectiveForScheduling(
                        HOUSEHOLD_ID, COMMITMENT_ID))
                .thenReturn(
                        new EffectiveReminderRules(
                                true,
                                Instant.parse("2026-07-26T08:00:00Z"),
                                List.of(rule(LocalTime.of(10, 0)))));
        when(leases.reconcileTrace(
                        any(),
                        any(),
                        org.mockito.ArgumentMatchers.anyLong(),
                        org.mockito.ArgumentMatchers.anyLong(),
                        any(),
                        any(),
                        any(),
                        any(),
                        any()))
                .thenReturn(true);
        when(leases.renewBeforeProvider(
                        any(), any(), eq(leaseDuration)))
                .thenAnswer(
                        invocation -> {
                            OutboxLeaseRepository.OutboxClaim claim =
                                    invocation.getArgument(0);
                            Instant renewedAt = invocation.getArgument(1);
                            Instant currentLease =
                                    leasedUntil.get(claim.deliveryId());
                            if (currentLease == null
                                    || !currentLease.isAfter(renewedAt)) {
                                return false;
                            }
                            leasedUntil.put(
                                    claim.deliveryId(),
                                    renewedAt.plus(leaseDuration));
                            return true;
                        });

        AtomicInteger sends = new AtomicInteger();
        AtomicReference<List<OutboxLeaseRepository.OutboxClaim>>
                competingClaims = new AtomicReference<>();
        doAnswer(
                        ignored -> {
                            int send = sends.incrementAndGet();
                            if (send < 3) {
                                clock.advance(Duration.ofSeconds(50));
                            } else {
                                clock.advance(Duration.ofSeconds(30));
                                competingClaims.set(
                                        leases.claim(
                                                clock.instant(),
                                                1,
                                                leaseDuration));
                                clock.advance(Duration.ofSeconds(20));
                            }
                            return null;
                        })
                .when(transport)
                .send(any());

        NotificationOutboxWorker worker =
                new NotificationOutboxWorker(
                        leases,
                        contexts,
                        preferences,
                        rules,
                        new ReminderTimePolicy(),
                        transport,
                        retryPolicy,
                        properties,
                        clock);

        assertThat(worker.processDueBatch()).isEqualTo(3);
        assertThat(successfulLeaseStarts)
                .containsExactly(
                        start,
                        start.plusSeconds(50),
                        start.plusSeconds(100));
        assertThat(competingClaims.get()).isEmpty();
        assertThat(delivered).containsExactlyInAnyOrderElementsOf(deliveryIds);
        verify(transport, times(3)).send(any());
    }

    private static Harness harness(
            Instant now,
            NotificationDeliveryContextRepository.DeliveryContext context,
            NotificationPreferenceSnapshot preference,
            ReminderRuleSnapshot rule) {
        OutboxLeaseRepository leases = mock(OutboxLeaseRepository.class);
        NotificationDeliveryContextRepository contexts =
                mock(NotificationDeliveryContextRepository.class);
        NotificationPreferenceService preferences =
                mock(NotificationPreferenceService.class);
        ReminderRuleService rules = mock(ReminderRuleService.class);
        NotificationEmailTransport transport =
                mock(NotificationEmailTransport.class);
        NotificationRetryPolicy retryPolicy = new NotificationRetryPolicy();
        OutboxLeaseRepository.OutboxClaim claim =
                new OutboxLeaseRepository.OutboxClaim(
                        EVENT_ID, DELIVERY_ID, LEASE_TOKEN, 1);
        when(leases.claim(now, 1, Duration.ofMinutes(2)))
                .thenReturn(List.of(claim), List.of());
        when(contexts.find(DELIVERY_ID)).thenReturn(Optional.of(context));
        when(preferences.findForScheduling(USER_ID))
                .thenReturn(Optional.of(preference));
        when(rules.resolveEffectiveForScheduling(HOUSEHOLD_ID, COMMITMENT_ID))
                .thenReturn(
                        new EffectiveReminderRules(
                                true,
                                Instant.parse("2026-07-26T08:00:00Z"),
                                List.of(rule)));
        when(leases.reconcileTrace(
                        any(),
                        any(),
                        org.mockito.ArgumentMatchers.anyLong(),
                        org.mockito.ArgumentMatchers.anyLong(),
                        any(),
                        any(),
                        any(),
                        any(),
                        any()))
                .thenReturn(true);
        when(leases.renewBeforeProvider(
                        any(), any(), eq(Duration.ofMinutes(2))))
                .thenReturn(true);
        NotificationProperties properties =
                new NotificationProperties(
                        "-",
                        "-",
                        "-",
                        25,
                        Duration.ofMinutes(2),
                        Duration.ofHours(2),
                        new NotificationProperties.Email(
                                NotificationEmailMode.DISABLED,
                                "no-reply@autopayguard.local",
                                List.of(
                                        "@autopayguard.local",
                                        ".example.test")));
        Clock clock = Clock.fixed(now, ZoneOffset.UTC);
        NotificationOutboxWorker worker =
                new NotificationOutboxWorker(
                        leases,
                        contexts,
                        preferences,
                        rules,
                        new ReminderTimePolicy(),
                        transport,
                        retryPolicy,
                        properties,
                        clock);
        return new Harness(
                worker, leases, rules, transport, retryPolicy, claim);
    }

    private static NotificationDeliveryContextRepository.DeliveryContext context(
            LocalDate scheduledDate,
            LocalTime plannedTime,
            boolean occurrenceValid) {
        return context(
                scheduledDate,
                plannedTime,
                occurrenceValid,
                "ACTIVE");
    }

    private static NotificationDeliveryContextRepository.DeliveryContext context(
            LocalDate scheduledDate,
            LocalTime plannedTime,
            boolean occurrenceValid,
            String commitmentStatus) {
        return new NotificationDeliveryContextRepository.DeliveryContext(
                DELIVERY_ID,
                NotificationStatus.PROCESSING,
                UUID.randomUUID(),
                USER_ID,
                "worker@example.test",
                HOUSEHOLD_ID,
                ZoneOffset.UTC,
                COMMITMENT_ID,
                scheduledDate,
                NotificationChannel.EMAIL,
                0,
                SEMANTIC_KEY,
                plannedTime.atDate(scheduledDate).toInstant(ZoneOffset.UTC),
                0,
                Instant.parse("2026-07-26T08:00:00Z"),
                OCCURRENCE_ID,
                Instant.parse("2026-07-26T08:00:00Z"),
                commitmentStatus,
                occurrenceValid);
    }

    private static NotificationPreferenceSnapshot preference(
            boolean quietEnabled, LocalTime quietStart, LocalTime quietEnd) {
        return new NotificationPreferenceSnapshot(
                UUID.randomUUID(),
                USER_ID,
                true,
                true,
                true,
                ZoneOffset.UTC,
                quietEnabled,
                quietStart,
                quietEnd,
                Instant.parse("2026-07-26T08:00:00Z"),
                Instant.parse("2026-07-26T08:00:00Z"),
                Instant.parse("2026-07-26T08:00:00Z"),
                1);
    }

    private static ReminderRuleSnapshot rule(LocalTime sendTime) {
        return new ReminderRuleSnapshot(
                RULE_ID,
                NotificationChannel.EMAIL,
                0,
                sendTime,
                true,
                Instant.parse("2026-07-26T08:00:00Z"));
    }

    private record Harness(
            NotificationOutboxWorker worker,
            OutboxLeaseRepository leases,
            ReminderRuleService rules,
            NotificationEmailTransport transport,
            NotificationRetryPolicy retryPolicy,
            OutboxLeaseRepository.OutboxClaim claim) {}

    private static final class MutableClock extends Clock {

        private Instant current;

        private MutableClock(Instant current) {
            this.current = current;
        }

        private void advance(Duration duration) {
            current = current.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return Clock.fixed(current, zone);
        }

        @Override
        public Instant instant() {
            return current;
        }
    }
}
