package in.autopayguard.api.household;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface HouseholdRepository extends JpaRepository<HouseholdEntity, UUID> {

    List<HouseholdEntity> findAllByOwnerUserIdOrderByCreatedAtAscIdAsc(UUID ownerUserId);

    java.util.Optional<HouseholdEntity> findByIdAndOwnerUserId(UUID id, UUID ownerUserId);
}
