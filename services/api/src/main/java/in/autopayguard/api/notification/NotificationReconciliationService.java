package in.autopayguard.api.notification;

import java.time.Clock;
import java.time.Instant;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class NotificationReconciliationService {

    private final OutboxLeaseRepository leaseRepository;
    private final NotificationRetryPolicy retryPolicy;
    private final NotificationProperties properties;
    private final Clock clock;

    NotificationReconciliationService(
            OutboxLeaseRepository leaseRepository,
            NotificationRetryPolicy retryPolicy,
            NotificationProperties properties,
            Clock clock) {
        this.leaseRepository = leaseRepository;
        this.retryPolicy = retryPolicy;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(cron = "${app.notifications.reconciliation-cron:-}", zone = "UTC")
    public int recoverExpiredLeases() {
        Instant now = clock.instant();
        int recovered =
                leaseRepository.recoverExpired(
                        now, properties.batchSize(), retryPolicy);
        int invalidated =
                leaseRepository.suppressInvalidated(
                        now, properties.batchSize());
        return recovered + invalidated;
    }
}
