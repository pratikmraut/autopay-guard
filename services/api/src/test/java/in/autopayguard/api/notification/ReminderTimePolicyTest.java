package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

class ReminderTimePolicyTest {

    private final ReminderTimePolicy policy = new ReminderTimePolicy();

    @Test
    void resolvesGapToFirstValidInstantAndOverlapToEarlierOffset() {
        ZoneId newYork = ZoneId.of("America/New_York");

        assertThat(
                        ReminderTimePolicy.resolveLocal(
                                LocalDate.of(2026, 3, 8),
                                LocalTime.of(2, 30),
                                newYork))
                .isEqualTo(Instant.parse("2026-03-08T07:00:00Z"));
        assertThat(
                        ReminderTimePolicy.resolveLocal(
                                LocalDate.of(2026, 11, 1),
                                LocalTime.of(1, 30),
                                newYork))
                .isEqualTo(Instant.parse("2026-11-01T05:30:00Z"));
    }

    @Test
    void overnightQuietHoursDeferWithoutChangingTheLogicalReminder() {
        ZoneId kolkata = ZoneId.of("Asia/Kolkata");
        ReminderTimePolicy.QuietHours quietHours =
                new ReminderTimePolicy.QuietHours(
                        true,
                        LocalTime.of(22, 0),
                        LocalTime.of(7, 0),
                        kolkata);

        ReminderTimePolicy.Resolution resolution =
                policy.resolve(
                        LocalDate.of(2026, 7, 10),
                        1,
                        LocalTime.of(23, 0),
                        kolkata,
                        quietHours);

        assertThat(resolution.suppressed()).isFalse();
        assertThat(resolution.scheduledFor())
                .isEqualTo(Instant.parse("2026-07-10T01:30:00Z"));
    }

    @Test
    void suppressesWhenQuietDeferralCrossesTheOccurrenceCalendarDay() {
        ZoneId kolkata = ZoneId.of("Asia/Kolkata");
        ReminderTimePolicy.QuietHours quietHours =
                new ReminderTimePolicy.QuietHours(
                        true,
                        LocalTime.of(22, 0),
                        LocalTime.of(7, 0),
                        kolkata);

        ReminderTimePolicy.Resolution resolution =
                policy.resolve(
                        LocalDate.of(2026, 7, 10),
                        0,
                        LocalTime.of(23, 0),
                        kolkata,
                        quietHours);

        assertThat(resolution.suppressed()).isTrue();
        assertThat(resolution.scheduledFor())
                .isEqualTo(Instant.parse("2026-07-11T01:30:00Z"));
    }

    @Test
    void quietStartIsInclusiveAndEndIsExclusive() {
        ZoneId utc = ZoneId.of("UTC");
        ReminderTimePolicy.QuietHours quietHours =
                new ReminderTimePolicy.QuietHours(
                        true,
                        LocalTime.of(22, 0),
                        LocalTime.of(7, 0),
                        utc);

        assertThat(
                        policy.resolve(
                                        LocalDate.of(2026, 7, 10),
                                        1,
                                        LocalTime.of(22, 0),
                                        utc,
                                        quietHours)
                                .scheduledFor())
                .isEqualTo(Instant.parse("2026-07-10T07:00:00Z"));
        assertThat(
                        policy.resolve(
                                        LocalDate.of(2026, 7, 10),
                                        0,
                                        LocalTime.of(7, 0),
                                        utc,
                                        quietHours)
                                .scheduledFor())
                .isEqualTo(Instant.parse("2026-07-10T07:00:00Z"));
    }

    @Test
    void rejectsEqualQuietBoundariesAndOutOfRangeOffsets() {
        ZoneId utc = ZoneId.of("UTC");
        ReminderTimePolicy.QuietHours invalid =
                new ReminderTimePolicy.QuietHours(
                        true,
                        LocalTime.NOON,
                        LocalTime.NOON,
                        utc);

        assertThatThrownBy(
                        () ->
                                policy.resolve(
                                        LocalDate.of(2026, 7, 10),
                                        1,
                                        LocalTime.NOON,
                                        utc,
                                        invalid))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () ->
                                policy.resolve(
                                        LocalDate.of(2026, 7, 10),
                                        91,
                                        LocalTime.NOON,
                                        utc,
                                        null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
