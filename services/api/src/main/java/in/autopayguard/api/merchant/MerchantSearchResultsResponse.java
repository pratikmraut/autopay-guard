package in.autopayguard.api.merchant;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(name = "MerchantSearchResults", requiredProperties = {"items"})
public record MerchantSearchResultsResponse(List<MerchantSearchItemResponse> items) {}
