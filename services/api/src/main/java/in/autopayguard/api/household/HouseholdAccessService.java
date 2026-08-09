package in.autopayguard.api.household;

import in.autopayguard.api.common.error.ResourceNotFoundException;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HouseholdAccessService {

    private final HouseholdRepository householdRepository;

    HouseholdAccessService(HouseholdRepository householdRepository) {
        this.householdRepository = householdRepository;
    }

    @Transactional(readOnly = true)
    public OwnedHousehold requireOwned(UUID householdId, UUID ownerUserId) {
        return householdRepository
                .findByIdAndOwnerUserId(householdId, ownerUserId)
                .map(HouseholdEntity::toOwnedHousehold)
                .orElseThrow(ResourceNotFoundException::new);
    }

    @Transactional(readOnly = true)
    public OwnedHousehold requireExistingForReconciliation(UUID householdId) {
        return householdRepository
                .findById(householdId)
                .map(HouseholdEntity::toOwnedHousehold)
                .orElseThrow(ResourceNotFoundException::new);
    }
}
