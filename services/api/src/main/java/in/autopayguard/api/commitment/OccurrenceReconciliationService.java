package in.autopayguard.api.commitment;

import in.autopayguard.api.household.HouseholdAccessService;
import in.autopayguard.api.household.OwnedHousehold;
import jakarta.validation.ValidationException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OccurrenceReconciliationService {

    static final int MINIMUM_HORIZON_DAYS = 90;
    static final int MAXIMUM_QUERY_DAYS = 366;
    private static final LocalDate MINIMUM_QUERY_DATE = LocalDate.of(1900, 1, 1);
    private static final LocalDate MAXIMUM_QUERY_DATE = LocalDate.of(2201, 12, 31);

    private final CommitmentRepository commitmentRepository;
    private final CommitmentOccurrenceRepository occurrenceRepository;
    private final HouseholdAccessService householdAccessService;
    private final RecurrenceCalculator recurrenceCalculator;
    private final Clock clock;

    OccurrenceReconciliationService(
            CommitmentRepository commitmentRepository,
            CommitmentOccurrenceRepository occurrenceRepository,
            HouseholdAccessService householdAccessService,
            RecurrenceCalculator recurrenceCalculator,
            Clock clock) {
        this.commitmentRepository = commitmentRepository;
        this.occurrenceRepository = occurrenceRepository;
        this.householdAccessService = householdAccessService;
        this.recurrenceCalculator = recurrenceCalculator;
        this.clock = clock;
    }

    @Scheduled(
            cron = "${app.occurrences.reconcile-cron:0 17 2 * * *}",
            zone = "UTC")
    @Transactional
    public void reconcileAll() {
        for (CommitmentEntity commitment :
                commitmentRepository.findActiveForReconciliation()) {
            OwnedHousehold household =
                    householdAccessService.requireExistingForReconciliation(
                            commitment.householdId());
            LocalDate today = localToday(household.timezone());
            commitment.nextDueDate(
                    recurrenceCalculator.nextOnOrAfter(
                            CommitmentRules.recurrenceRule(commitment), today));
            reconcileRange(commitment, today, today.plusDays(MINIMUM_HORIZON_DAYS));
        }
    }

    void replaceFutureAndReconcile(
            CommitmentEntity commitment, String timezone, boolean replaceFuture) {
        LocalDate today = localToday(timezone);
        if (commitment.status() != CommitmentStatus.ACTIVE) {
            commitment.nextDueDate(null);
            if (replaceFuture) {
                occurrenceRepository.deleteFutureUpcoming(commitment.id(), today);
            }
            return;
        }
        commitment.nextDueDate(
                recurrenceCalculator.nextOnOrAfter(
                        CommitmentRules.recurrenceRule(commitment), today));
        if (replaceFuture) {
            occurrenceRepository.deleteFutureUpcoming(commitment.id(), today);
        }
        reconcileRange(commitment, today, today.plusDays(MINIMUM_HORIZON_DAYS));
    }

    void ensureRange(
            CommitmentEntity commitment,
            String timezone,
            LocalDate from,
            LocalDate to) {
        validateRange(from, to);
        if (commitment.status() != CommitmentStatus.ACTIVE) {
            return;
        }
        LocalDate today = localToday(timezone);
        commitment.nextDueDate(
                recurrenceCalculator.nextOnOrAfter(
                        CommitmentRules.recurrenceRule(commitment), today));
        LocalDate materializeFrom = from.isBefore(today) ? today : from;
        if (!materializeFrom.isAfter(to)) {
            reconcileRange(commitment, materializeFrom, to);
        }
    }

    LocalDate localToday(String timezone) {
        return LocalDate.now(clock.withZone(ZoneId.of(timezone)));
    }

    public static void validateRange(LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from)) {
            throw new ValidationException("from must be on or before to.");
        }
        if (from.isBefore(MINIMUM_QUERY_DATE) || to.isAfter(MAXIMUM_QUERY_DATE)) {
            throw new ValidationException(
                    "Date ranges must be between 1900-01-01 and 2201-12-31.");
        }
        long inclusiveDays = ChronoUnit.DAYS.between(from, to) + 1;
        if (inclusiveDays > MAXIMUM_QUERY_DAYS) {
            throw new ValidationException(
                    "Date ranges may contain at most " + MAXIMUM_QUERY_DAYS + " days.");
        }
    }

    static void validateDate(LocalDate date) {
        if (date == null
                || date.isBefore(MINIMUM_QUERY_DATE)
                || date.isAfter(MAXIMUM_QUERY_DATE)) {
            throw new ValidationException(
                    "Dates must be between 1900-01-01 and 2201-12-31.");
        }
    }

    private void reconcileRange(
            CommitmentEntity commitment, LocalDate from, LocalDate to) {
        List<LocalDate> expectedDates =
                recurrenceCalculator.datesBetween(
                        CommitmentRules.recurrenceRule(commitment), from, to);
        Set<LocalDate> present =
                new HashSet<>(
                        occurrenceRepository.findScheduledDates(
                                commitment.id(), from, to));
        List<CommitmentOccurrenceEntity> missing =
                expectedDates.stream()
                        .filter(date -> !present.contains(date))
                        .map(
                                date ->
                                        CommitmentOccurrenceEntity.upcoming(
                                                commitment, date, clock.instant()))
                        .toList();
        if (!missing.isEmpty()) {
            occurrenceRepository.saveAll(missing);
        }
    }
}
