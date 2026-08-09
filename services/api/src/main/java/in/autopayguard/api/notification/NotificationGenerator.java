package in.autopayguard.api.notification;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationGenerator {

    private final NotificationCandidateRepository candidateRepository;
    private final NotificationRepository notificationRepository;
    private final NotificationDeliveryRepository deliveryRepository;
    private final OutboxEventRepository outboxRepository;
    private final ReminderTimePolicy timePolicy;
    private final NotificationProperties properties;
    private final Clock clock;

    NotificationGenerator(
            NotificationCandidateRepository candidateRepository,
            NotificationRepository notificationRepository,
            NotificationDeliveryRepository deliveryRepository,
            OutboxEventRepository outboxRepository,
            ReminderTimePolicy timePolicy,
            NotificationProperties properties,
            Clock clock) {
        this.candidateRepository = candidateRepository;
        this.notificationRepository = notificationRepository;
        this.deliveryRepository = deliveryRepository;
        this.outboxRepository = outboxRepository;
        this.timePolicy = timePolicy;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(cron = "${app.notifications.generator-cron:-}", zone = "UTC")
    @Transactional
    public int generateDue() {
        Instant now = clock.instant();
        LocalDate utcDate = LocalDate.ofInstant(now, ZoneOffset.UTC);
        int generated = 0;
        NotificationCandidateRepository.CandidateCursor cursor = null;
        while (generated < properties.batchSize()) {
            var candidates =
                    candidateRepository.lockDueCandidates(
                            utcDate.minusDays(1),
                            utcDate.plusDays(1),
                            properties.batchSize(),
                            cursor);
            if (candidates.isEmpty()) {
                break;
            }
            for (NotificationCandidateRepository.NotificationCandidate candidate :
                    candidates) {
                cursor = candidate.cursor();
                ReminderTimePolicy.Resolution resolution =
                        timePolicy.resolve(
                                candidate.scheduledDate(),
                                candidate.offsetDays(),
                                candidate.localSendTime(),
                                candidate.householdTimezone(),
                                candidate.quietHours());
                Instant activatedAt = candidate.activatedAt();
                if (activatedAt == null
                        || resolution.plannedFor().isBefore(activatedAt)
                        || resolution.plannedFor().isAfter(now)
                        || resolution
                                .plannedFor()
                                .isBefore(
                                        now.minus(
                                                properties
                                                        .catchUpWindow()))) {
                    continue;
                }

                String semanticKey =
                        NotificationSemanticKey.create(
                                candidate.recipientUserId(),
                                candidate.householdId(),
                                candidate.commitmentId(),
                                candidate.scheduledDate(),
                                candidate.channel(),
                                candidate.offsetDays());
                NotificationEntity notification =
                        NotificationEntity.create(
                                candidate.recipientUserId(),
                                candidate.householdId(),
                                candidate.commitmentId(),
                                candidate.occurrenceId(),
                                candidate.reminderRuleId(),
                                candidate.scheduledDate(),
                                candidate.channel(),
                                candidate.offsetDays(),
                                resolution.scheduledFor(),
                                semanticKey,
                                now);
                notificationRepository.save(notification);

                NotificationDeliveryEntity delivery;
                OutboxEventEntity outbox;
                if (resolution.suppressed()) {
                    delivery =
                            NotificationDeliveryEntity.suppressed(
                                    notification.id(),
                                    resolution.scheduledFor(),
                                    NotificationFailureCategory
                                            .QUIET_HOURS_EXPIRED,
                                    now);
                    outbox =
                            OutboxEventEntity.processed(
                                    delivery.id(),
                                    semanticKey,
                                    resolution.scheduledFor(),
                                    NotificationFailureCategory
                                            .QUIET_HOURS_EXPIRED,
                                    now);
                } else {
                    delivery =
                            NotificationDeliveryEntity.pending(
                                    notification.id(),
                                    resolution.scheduledFor(),
                                    now);
                    outbox =
                            OutboxEventEntity.pending(
                                    delivery.id(),
                                    semanticKey,
                                    resolution.scheduledFor(),
                                    now);
                }
                deliveryRepository.save(delivery);
                outboxRepository.save(outbox);
                generated++;
                if (generated >= properties.batchSize()) {
                    break;
                }
            }
            if (candidates.size() < properties.batchSize()) {
                break;
            }
        }
        return generated;
    }
}
