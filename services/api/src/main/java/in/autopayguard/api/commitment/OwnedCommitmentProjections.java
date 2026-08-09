package in.autopayguard.api.commitment;

import in.autopayguard.api.household.OwnedHousehold;
import java.util.List;
import java.util.UUID;

public record OwnedCommitmentProjections(
        UUID ownerUserId,
        OwnedHousehold household,
        List<CommitmentProjection> commitments) {}
