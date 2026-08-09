package in.autopayguard.api.reminder;

import java.time.Instant;
import java.util.List;

public record EffectiveReminderRules(
        boolean enabled, Instant activatedAt, List<ReminderRuleSnapshot> rules) {

    public static EffectiveReminderRules disabled() {
        return new EffectiveReminderRules(false, null, List.of());
    }
}
