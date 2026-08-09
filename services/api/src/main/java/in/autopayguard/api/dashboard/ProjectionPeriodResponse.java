package in.autopayguard.api.dashboard;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;

@Schema(
        name = "ProjectionPeriod",
        description =
                "Exact scheduled occurrences inside an inclusive local-calendar window. "
                        + "No foreign exchange, fractional proration or rounding is performed.",
        requiredProperties = {
            "from", "to", "occurrenceCount", "unknownVariableOccurrenceCount", "totals"
        })
public record ProjectionPeriodResponse(
        LocalDate from,
        LocalDate to,
        long occurrenceCount,
        long unknownVariableOccurrenceCount,
        List<CurrencyProjectionResponse> totals) {}
