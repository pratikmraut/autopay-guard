package in.autopayguard.api.cancellation;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface SavingsEventRepository extends JpaRepository<SavingsEventEntity, UUID> {}
