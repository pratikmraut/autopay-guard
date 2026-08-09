package in.autopayguard.api.commitment;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class HouseholdTimezoneTest {

    @Test
    void localTodayUsesHouseholdIanaZoneAtUtcBoundary() {
        Clock clock =
                Clock.fixed(Instant.parse("2026-07-25T20:00:00Z"), ZoneOffset.UTC);
        OccurrenceReconciliationService service =
                new OccurrenceReconciliationService(
                        null, null, null, null, clock);

        assertThat(service.localToday("Asia/Kolkata")).isEqualTo("2026-07-26");
        assertThat(service.localToday("America/New_York")).isEqualTo("2026-07-25");
    }
}
