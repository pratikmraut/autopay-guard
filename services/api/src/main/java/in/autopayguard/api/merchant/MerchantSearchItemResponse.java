package in.autopayguard.api.merchant;

import in.autopayguard.api.commitment.CommitmentCategory;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(
        name = "MerchantSearchItem",
        requiredProperties = {
            "id", "canonicalName", "category", "countryCode", "websiteHost"
        })
public record MerchantSearchItemResponse(
        UUID id,
        String canonicalName,
        CommitmentCategory category,
        String countryCode,
        String websiteHost) {}
