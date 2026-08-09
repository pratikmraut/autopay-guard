package in.autopayguard.api.dashboard;

import in.autopayguard.api.commitment.OccurrenceReconciliationService;
import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/dashboard")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "dashboard")
@Validated
public class DashboardController {

    private final DashboardService dashboardService;

    DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping(value = "/summary", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getDashboardSummary",
            summary = "Get monthly and annualized commitment projections",
            description =
                    "Monthly totals cover the requested household-local calendar month. "
                            + "Annualized totals cover 12 local calendar months from that month start. "
                            + "Exact occurrences are summed per currency without FX, fractional "
                            + "proration or rounding; estimates and unknown amounts are explicit.",
            responses = {
                @ApiResponse(responseCode = "200", description = "Projection summary"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid month",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    DashboardSummaryResponse summary(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID householdId,
            @RequestParam @Pattern(regexp = "^\\d{4}-\\d{2}$") String month) {
        return dashboardService.summary(jwt, householdId, month);
    }

    @GetMapping(value = "/calendar", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getDashboardCalendar",
            summary = "Get household commitment calendar data",
            description =
                    "Returns every local date in the inclusive range, including dates without items. "
                            + "Ranges may contain at most 366 dates.",
            responses = {
                @ApiResponse(responseCode = "200", description = "Calendar data"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid date range",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    DashboardCalendarResponse calendar(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID householdId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        OccurrenceReconciliationService.validateRange(from, to);
        return dashboardService.calendar(jwt, householdId, from, to);
    }
}
