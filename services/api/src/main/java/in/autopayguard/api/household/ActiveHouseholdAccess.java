package in.autopayguard.api.household;

import java.util.UUID;

public record ActiveHouseholdAccess(
        UUID householdId,
        UUID memberId,
        UUID userId,
        UUID ownerUserId,
        HouseholdMemberRole role,
        String defaultCurrency,
        String timezone) {

    public boolean owner() {
        return role == HouseholdMemberRole.OWNER;
    }
}
