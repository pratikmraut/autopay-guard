package in.autopayguard.api.dashboard;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "DashboardCalendar",
        requiredProperties = {"householdId", "from", "to", "days"})
public record DashboardCalendarResponse(
        UUID householdId,
        LocalDate from,
        LocalDate to,
        List<CalendarDayResponse> days) {}
