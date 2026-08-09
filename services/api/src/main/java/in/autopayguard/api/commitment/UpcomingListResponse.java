package in.autopayguard.api.commitment;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "UpcomingList",
        requiredProperties = {"householdId", "from", "to", "items"})
public record UpcomingListResponse(
        UUID householdId, LocalDate from, LocalDate to, List<UpcomingItemResponse> items) {}
