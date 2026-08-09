package in.autopayguard.api.merchant;

import in.autopayguard.api.commitment.CommitmentCategory;
import java.util.UUID;

public record MerchantReference(
        UUID id, String canonicalName, CommitmentCategory category) {}
