package in.autopayguard.api.reminder;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

@Schema(
        name = "UpdateReminderRuleSetRequest",
        description = "Complete reminder rule-set representation.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"mode", "rules"})
public record UpdateReminderRuleSetRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ReminderRuleMode mode,
        @NotNull
                @Size(max = 182)
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                List<@Valid ReminderRuleInput> rules) {}
