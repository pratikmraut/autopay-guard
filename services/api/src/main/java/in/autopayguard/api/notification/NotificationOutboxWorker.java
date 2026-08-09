package in.autopayguard.api.notification;

import in.autopayguard.api.notification.NotificationDeliveryContextRepository.DeliveryContext;
import in.autopayguard.api.reminder.EffectiveReminderRules;
import in.autopayguard.api.reminder.ReminderRuleService;
import in.autopayguard.api.reminder.ReminderRuleSnapshot;
import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.Optional;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class NotificationOutboxWorker {

    static final String EMAIL_SUBJECT = "AutoPay Guard reminder";
    static final String EMAIL_BODY =
            "You have an upcoming recurring commitment to review. "
                    + "Sign in to AutoPay Guard to see the details. "
                    + "AutoPay Guard does not move money or change payment mandates.";

    private final OutboxLeaseRepository leaseRepository;
    private final NotificationDeliveryContextRepository contextRepository;
    private final NotificationPreferenceService preferenceService;
    private final ReminderRuleService reminderRuleService;
    private final ReminderTimePolicy timePolicy;
    private final NotificationEmailTransport emailTransport;
    private final NotificationRetryPolicy retryPolicy;
    private final NotificationProperties properties;
    private final Clock clock;

    NotificationOutboxWorker(
            OutboxLeaseRepository leaseRepository,
            NotificationDeliveryContextRepository contextRepository,
            NotificationPreferenceService preferenceService,
            ReminderRuleService reminderRuleService,
            ReminderTimePolicy timePolicy,
            NotificationEmailTransport emailTransport,
            NotificationRetryPolicy retryPolicy,
            NotificationProperties properties,
            Clock clock) {
        this.leaseRepository = leaseRepository;
        this.contextRepository = contextRepository;
        this.preferenceService = preferenceService;
        this.reminderRuleService = reminderRuleService;
        this.timePolicy = timePolicy;
        this.emailTransport = emailTransport;
        this.retryPolicy = retryPolicy;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(cron = "${app.notifications.worker-cron:-}", zone = "UTC")
    public int processDueBatch() {
        int processed = 0;
        while (processed < properties.batchSize()) {
            Instant claimTime = clock.instant();
            Optional<OutboxLeaseRepository.OutboxClaim> next =
                    leaseRepository
                            .claim(
                                    claimTime,
                                    1,
                                    properties.leaseDuration())
                            .stream()
                            .findFirst();
            if (next.isEmpty()) {
                break;
            }
            try {
                process(next.orElseThrow());
            } catch (RuntimeException exception) {
                // Leave the short lease intact. Reconciliation safely recovers it, and
                // one corrupt or ambiguous delivery cannot block later fresh claims.
            }
            processed++;
        }
        return processed;
    }

    private void process(OutboxLeaseRepository.OutboxClaim claim) {
        Instant now = clock.instant();
        DeliveryContext context =
                contextRepository
                        .find(claim.deliveryId())
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "Claimed notification delivery is missing."));
        if (context.status() != NotificationStatus.PROCESSING
                || !"ACTIVE".equals(context.commitmentStatus())
                || !context.occurrenceValid()) {
            leaseRepository.suppressed(
                    claim,
                    NotificationFailureCategory.DELIVERY_INVALIDATED,
                    now);
            return;
        }

        Optional<NotificationPreferenceSnapshot> preference =
                preferenceService.findForScheduling(context.recipientUserId());
        if (preference.isEmpty()
                || !preference.orElseThrow().channelEnabled(context.channel())) {
            leaseRepository.suppressed(
                    claim,
                    NotificationFailureCategory.DELIVERY_INVALIDATED,
                    now);
            return;
        }

        EffectiveReminderRules effective =
                reminderRuleService.resolveEffectiveForScheduling(
                        context.householdId(), context.commitmentId());
        Optional<ReminderRuleSnapshot> rule =
                effective.rules().stream()
                        .filter(ReminderRuleSnapshot::enabled)
                        .filter(candidate -> candidate.channel() == context.channel())
                        .filter(candidate -> candidate.offsetDays() == context.offsetDays())
                        .max(Comparator.comparing(ReminderRuleSnapshot::activatedAt));
        if (!effective.enabled() || rule.isEmpty()) {
            leaseRepository.suppressed(
                    claim,
                    NotificationFailureCategory.DELIVERY_INVALIDATED,
                    now);
            return;
        }

        NotificationPreferenceSnapshot savedPreference = preference.orElseThrow();
        ReminderRuleSnapshot savedRule = rule.orElseThrow();
        Instant activation =
                latest(
                        savedPreference.activatedAt(context.channel()),
                        effective.activatedAt(),
                        savedRule.activatedAt(),
                        context.commitmentUpdatedAt(),
                        context.occurrenceCreatedAt());
        ReminderTimePolicy.Resolution resolution =
                timePolicy.resolve(
                        context.scheduledDate(),
                        context.offsetDays(),
                        savedRule.localSendTime(),
                        context.householdTimezone(),
                        new ReminderTimePolicy.QuietHours(
                                savedPreference.quietHoursEnabled(),
                                savedPreference.quietStart(),
                                savedPreference.quietEnd(),
                                savedPreference.timezone()));
        if (activation == null || resolution.plannedFor().isBefore(activation)) {
            leaseRepository.suppressed(
                    claim,
                    NotificationFailureCategory.DELIVERY_INVALIDATED,
                    now);
            return;
        }
        if (resolution.suppressed()) {
            leaseRepository.suppressed(
                    claim,
                    NotificationFailureCategory.QUIET_HOURS_EXPIRED,
                    now);
            return;
        }
        Instant deliveryDecisionTime = clock.instant();
        boolean scheduledInFuture =
                resolution.scheduledFor().isAfter(deliveryDecisionTime);
        if (!scheduledInFuture
                && claim.attemptCount() == 1
                && resolution
                        .scheduledFor()
                        .isBefore(
                                deliveryDecisionTime.minus(
                                        properties.catchUpWindow()))) {
            leaseRepository.suppressed(
                    claim,
                    NotificationFailureCategory.DELIVERY_INVALIDATED,
                    deliveryDecisionTime);
            return;
        }

        boolean deliveryAuthorized =
                leaseRepository.reconcileTrace(
                        claim,
                        savedPreference.id(),
                        savedPreference.version(),
                        context.commitmentVersion(),
                        context.occurrenceId(),
                        savedRule.id(),
                        resolution.plannedFor(),
                        resolution.scheduledFor(),
                        deliveryDecisionTime);
        if (!deliveryAuthorized) {
            leaseRepository.deferred(
                    claim, deliveryDecisionTime, deliveryDecisionTime);
            return;
        }
        if (scheduledInFuture) {
            leaseRepository.deferred(
                    claim, resolution.scheduledFor(), deliveryDecisionTime);
            return;
        }
        Instant providerStart = clock.instant();
        if (!leaseRepository.renewBeforeProvider(
                claim, providerStart, properties.leaseDuration())) {
            return;
        }
        if (claim.attemptCount() == 1
                && resolution
                        .scheduledFor()
                        .isBefore(
                                providerStart.minus(
                                        properties.catchUpWindow()))) {
            leaseRepository.suppressed(
                    claim,
                    NotificationFailureCategory.DELIVERY_INVALIDATED,
                    providerStart);
            return;
        }
        String providerMessageId = null;
        if (context.channel() == NotificationChannel.EMAIL) {
            providerMessageId =
                    NotificationSemanticKey.messageId(context.semanticKey());
            try {
                emailTransport.send(
                        new NotificationEmailTransport.EmailEnvelope(
                                context.recipientEmail(),
                                providerMessageId,
                                EMAIL_SUBJECT,
                                EMAIL_BODY));
            } catch (NotificationDeliveryException exception) {
                leaseRepository.failed(
                        claim,
                        exception.category(),
                        exception.retryable(),
                        clock.instant(),
                        retryPolicy);
                return;
            } catch (RuntimeException exception) {
                leaseRepository.failed(
                        claim,
                        NotificationFailureCategory.INTERNAL_PAYLOAD,
                        false,
                        clock.instant(),
                        retryPolicy);
                return;
            }
        }
        // Completion is deliberately outside the provider catch. If SMTP accepted the
        // message and this database write fails, the lease expires and recovery preserves
        // the documented at-least-once ambiguity instead of falsely marking it permanent.
        leaseRepository.delivered(claim, providerMessageId, clock.instant());
    }

    private static Instant latest(Instant... values) {
        Instant latest = null;
        for (Instant value : values) {
            if (value != null && (latest == null || value.isAfter(latest))) {
                latest = value;
            }
        }
        return latest;
    }
}
