package in.autopayguard.api.dashboard;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        name = "CurrencyProjection",
        requiredProperties = {
            "currency",
            "fixedAmountMinor",
            "estimatedVariableAmountMinor",
            "knownTotalMinor",
            "fixedOccurrenceCount",
            "estimatedVariableOccurrenceCount",
            "unknownVariableOccurrenceCount",
            "containsEstimates"
        })
public record CurrencyProjectionResponse(
        String currency,
        long fixedAmountMinor,
        long estimatedVariableAmountMinor,
        long knownTotalMinor,
        long fixedOccurrenceCount,
        long estimatedVariableOccurrenceCount,
        long unknownVariableOccurrenceCount,
        boolean containsEstimates) {}
