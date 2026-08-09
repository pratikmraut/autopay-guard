package in.autopayguard.api.commitment;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;

@Schema(
        name = "OccurrenceList",
        requiredProperties = {"from", "to", "items"})
public record OccurrenceListResponse(
        LocalDate from, LocalDate to, List<OccurrenceResponse> items) {}
