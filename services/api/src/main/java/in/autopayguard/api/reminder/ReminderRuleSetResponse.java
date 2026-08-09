package in.autopayguard.api.reminder;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(
        name = "ReminderRuleSet",
        requiredProperties = {
            "id",
            "householdId",
            "commitmentId",
            "mode",
            "rules",
            "suggestedRules",
            "version",
            "updatedAt"
        })
public record ReminderRuleSetResponse(
        @Schema(nullable = true, format = "uuid") UUID id,
        UUID householdId,
        @Schema(nullable = true, format = "uuid") UUID commitmentId,
        ReminderRuleMode mode,
        List<ReminderRuleResponse> rules,
        List<ReminderRuleResponse> suggestedRules,
        long version,
        @Schema(nullable = true, format = "date-time") Instant updatedAt) {}
