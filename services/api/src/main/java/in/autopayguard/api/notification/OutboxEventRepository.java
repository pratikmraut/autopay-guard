package in.autopayguard.api.notification;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface OutboxEventRepository extends JpaRepository<OutboxEventEntity, UUID> {

    Optional<OutboxEventEntity> findByDeliveryId(UUID deliveryId);
}
