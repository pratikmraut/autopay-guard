package in.autopayguard.api.dashboard;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(
        name = "DashboardSummary",
        requiredProperties = {
            "householdId",
            "month",
            "activeCommitmentCount",
            "variableCommitmentCount",
            "unknownVariableCommitmentCount",
            "monthlyProjection",
            "annualizedProjection"
        })
public record DashboardSummaryResponse(
        UUID householdId,
        @Schema(pattern = "^\\d{4}-\\d{2}$", example = "2026-07") String month,
        long activeCommitmentCount,
        long variableCommitmentCount,
        long unknownVariableCommitmentCount,
        ProjectionPeriodResponse monthlyProjection,
        ProjectionPeriodResponse annualizedProjection) {}
