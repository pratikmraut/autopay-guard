package in.autopayguard.api.notification;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.zone.ZoneOffsetTransition;
import java.time.zone.ZoneRules;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class ReminderTimePolicy {

    public Resolution resolve(
            LocalDate occurrenceDate,
            int offsetDays,
            LocalTime localSendTime,
            ZoneId householdZone,
            QuietHours quietHours) {
        if (offsetDays < 0 || offsetDays > 90) {
            throw new IllegalArgumentException("Reminder offset must be between 0 and 90 days.");
        }
        Instant planned =
                resolveLocal(
                        occurrenceDate.minusDays(offsetDays),
                        localSendTime,
                        householdZone);
        if (quietHours == null || !quietHours.enabled()) {
            return Resolution.deliverAt(planned, planned);
        }
        quietHours.validate();

        ZonedDateTime preferenceLocal = planned.atZone(quietHours.zone());
        if (!quietHours.contains(preferenceLocal.toLocalTime())) {
            return Resolution.deliverAt(planned, planned);
        }

        LocalDate quietEndDate =
                quietHours.endDate(
                        preferenceLocal.toLocalDate(),
                        preferenceLocal.toLocalTime());
        Instant deferred =
                resolveLocal(
                        quietEndDate,
                        quietHours.end(),
                        quietHours.zone());
        if (deferred.atZone(householdZone)
                .toLocalDate()
                .isAfter(occurrenceDate)) {
            return Resolution.suppressedAt(planned, deferred);
        }
        return Resolution.deliverAt(planned, deferred);
    }

    static Instant resolveLocal(LocalDate date, LocalTime time, ZoneId zone) {
        LocalDateTime localDateTime = LocalDateTime.of(date, time);
        ZoneRules rules = zone.getRules();
        List<ZoneOffset> offsets = rules.getValidOffsets(localDateTime);
        if (offsets.size() == 1) {
            return ZonedDateTime.ofStrict(localDateTime, offsets.getFirst(), zone).toInstant();
        }
        if (offsets.size() > 1) {
            return ZonedDateTime.ofLocal(localDateTime, zone, offsets.getFirst()).toInstant();
        }

        ZoneOffsetTransition transition = rules.getTransition(localDateTime);
        if (transition == null || !transition.isGap()) {
            throw new IllegalStateException("Could not resolve reminder local time.");
        }
        return transition.getInstant();
    }

    public record QuietHours(
            boolean enabled,
            LocalTime start,
            LocalTime end,
            ZoneId zone) {

        void validate() {
            if (!enabled) {
                return;
            }
            if (start == null || end == null || zone == null || start.equals(end)) {
                throw new IllegalArgumentException(
                        "Enabled quiet hours require distinct start and end times.");
            }
        }

        boolean contains(LocalTime candidate) {
            if (start.isBefore(end)) {
                return !candidate.isBefore(start) && candidate.isBefore(end);
            }
            return !candidate.isBefore(start) || candidate.isBefore(end);
        }

        LocalDate endDate(LocalDate candidateDate, LocalTime candidateTime) {
            if (start.isAfter(end) && !candidateTime.isBefore(start)) {
                return candidateDate.plusDays(1);
            }
            return candidateDate;
        }
    }

    public record Resolution(
            Instant plannedFor, Instant scheduledFor, boolean suppressed) {

        static Resolution deliverAt(Instant plannedFor, Instant scheduledFor) {
            return new Resolution(plannedFor, scheduledFor, false);
        }

        static Resolution suppressedAt(Instant plannedFor, Instant scheduledFor) {
            return new Resolution(plannedFor, scheduledFor, true);
        }
    }
}
