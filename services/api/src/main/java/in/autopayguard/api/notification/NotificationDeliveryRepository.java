package in.autopayguard.api.notification;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface NotificationDeliveryRepository
        extends JpaRepository<NotificationDeliveryEntity, UUID> {

    Optional<NotificationDeliveryEntity> findByNotificationId(UUID notificationId);
}
