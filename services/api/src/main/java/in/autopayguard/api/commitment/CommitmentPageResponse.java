package in.autopayguard.api.commitment;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(
        name = "CommitmentPage",
        requiredProperties = {"items", "nextCursor"})
public record CommitmentPageResponse(
        List<CommitmentResponse> items, @Schema(nullable = true) String nextCursor) {}
