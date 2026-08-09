package in.autopayguard.api.cancellation;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface CancellationGuideRepository extends JpaRepository<CancellationGuideEntity, UUID> {

    Optional<CancellationGuideEntity> findByMerchantId(UUID merchantId);
}
