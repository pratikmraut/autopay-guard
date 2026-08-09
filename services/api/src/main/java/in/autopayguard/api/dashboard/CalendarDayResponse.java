package in.autopayguard.api.dashboard;

import in.autopayguard.api.commitment.UpcomingItemResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;

@Schema(
        name = "CalendarDay",
        requiredProperties = {"date", "items", "totals"})
public record CalendarDayResponse(
        LocalDate date,
        List<UpcomingItemResponse> items,
        List<CurrencyProjectionResponse> totals) {}
