package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(name = "SavingsCurrencySummary", requiredProperties = {"currency", "totals"})
public record SavingsCurrencySummaryResponse(
        @Schema(pattern = "^[A-Z]{3}$") String currency,
        List<SavingsStateTotalResponse> totals) {}
