package in.autopayguard.api.household;

import java.util.UUID;

public record OwnedHousehold(
        UUID id, UUID ownerUserId, String defaultCurrency, String timezone) {}
