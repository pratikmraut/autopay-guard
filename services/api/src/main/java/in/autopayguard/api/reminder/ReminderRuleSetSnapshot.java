package in.autopayguard.api.reminder;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ReminderRuleSetSnapshot(
        UUID id,
        UUID householdId,
        UUID commitmentId,
        ReminderRuleMode mode,
        Instant activatedAt,
        List<ReminderRuleSnapshot> rules,
        long version) {}
