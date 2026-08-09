package in.autopayguard.api.cancellation;

import in.autopayguard.api.household.HouseholdMembershipService;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class SavingsService {

    private static final String CURSOR_PREFIX = "s1";
    private static final int MAXIMUM_PAGE_INDEX = 10_000;

    private final CancellationAttemptRepository attemptRepository;
    private final HouseholdMembershipService householdMembershipService;
    private final CurrentUserService currentUserService;
    private final Clock clock;

    SavingsService(
            CancellationAttemptRepository attemptRepository,
            HouseholdMembershipService householdMembershipService,
            CurrentUserService currentUserService,
            Clock clock) {
        this.attemptRepository = attemptRepository;
        this.householdMembershipService = householdMembershipService;
        this.currentUserService = currentUserService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    SavingsPageResponse get(
            Jwt jwt,
            UUID householdId,
            SavingsState state,
            int limit,
            String cursor) {
        validateLimit(limit);
        CurrentUser caller = currentUserService.resolve(jwt);
        householdMembershipService.requireConsentedReadAccess(
                householdId, caller.id());
        List<CancellationAttemptEntity> all =
                attemptRepository.findVisibleByCallerAndHousehold(
                        caller.id(), householdId);
        all.sort(
                Comparator.comparing(CancellationAttemptEntity::updatedAt)
                        .thenComparing(CancellationAttemptEntity::id)
                        .reversed());

        List<SavingsCurrencySummaryResponse> currencies = summarize(all);
        int unquantifiedCount =
                SavingsAmounts.toIntExactBounded(
                        all.stream()
                                .filter(value -> value.projectedSavingsMinor() == null)
                                .count());
        List<CancellationAttemptEntity> filtered =
                state == null
                        ? all
                        : all.stream()
                                .filter(value -> value.savingsState() == state)
                                .toList();
        int pageIndex = decodePage(cursor, householdId, state, limit);
        int start = Math.multiplyExact(pageIndex, limit);
        if (start > filtered.size()) {
            throw new ValidationException("cursor is outside the available savings ledger.");
        }
        int end = Math.min(filtered.size(), Math.addExact(start, limit));
        List<SavingsItemResponse> items =
                filtered.subList(start, end).stream()
                        .map(SavingsService::toItem)
                        .toList();
        return new SavingsPageResponse(
                householdId,
                clock.instant(),
                currencies,
                unquantifiedCount,
                items,
                end < filtered.size()
                        ? encodePage(pageIndex + 1, householdId, state, limit)
                        : null);
    }

    private static List<SavingsCurrencySummaryResponse> summarize(
            List<CancellationAttemptEntity> attempts) {
        Map<String, EnumMap<SavingsState, MutableTotal>> byCurrency =
                new TreeMap<>();
        for (CancellationAttemptEntity attempt : attempts) {
            if (attempt.projectedSavingsMinor() == null) {
                continue;
            }
            EnumMap<SavingsState, MutableTotal> byState =
                    byCurrency.computeIfAbsent(
                            attempt.currency(),
                            ignored -> new EnumMap<>(SavingsState.class));
            MutableTotal total =
                    byState.computeIfAbsent(
                            attempt.savingsState(), ignored -> new MutableTotal());
            if (attempt.savingsEstimated()) {
                total.estimatedAmountMinor =
                        SavingsAmounts.addExactBounded(
                                total.estimatedAmountMinor,
                                attempt.projectedSavingsMinor());
                total.estimatedAttemptCount =
                        SavingsAmounts.incrementExactBounded(
                                total.estimatedAttemptCount);
            } else {
                total.exactAmountMinor =
                        SavingsAmounts.addExactBounded(
                                total.exactAmountMinor,
                                attempt.projectedSavingsMinor());
                total.exactAttemptCount =
                        SavingsAmounts.incrementExactBounded(
                                total.exactAttemptCount);
            }
        }
        List<SavingsCurrencySummaryResponse> result = new ArrayList<>();
        byCurrency.forEach(
                (currency, byState) -> {
                    List<SavingsStateTotalResponse> totals = new ArrayList<>();
                    for (SavingsState state : SavingsState.values()) {
                        MutableTotal total =
                                byState.getOrDefault(state, new MutableTotal());
                        totals.add(
                                new SavingsStateTotalResponse(
                                        state,
                                        total.exactAmountMinor,
                                        total.estimatedAmountMinor,
                                        total.exactAttemptCount,
                                        total.estimatedAttemptCount));
                    }
                    result.add(
                            new SavingsCurrencySummaryResponse(
                                    currency, List.copyOf(totals)));
                });
        return List.copyOf(result);
    }

    private static SavingsItemResponse toItem(CancellationAttemptEntity attempt) {
        return new SavingsItemResponse(
                attempt.id(),
                attempt.commitmentId(),
                attempt.displayName(),
                attempt.savingsState(),
                attempt.projectedSavingsMinor(),
                attempt.currency(),
                attempt.savingsEstimated(),
                attempt.savingsPeriodStart(),
                attempt.savingsPeriodEnd(),
                attempt.reversalReason(),
                attempt.updatedAt());
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ValidationException("limit must be between 1 and 100.");
        }
    }

    private static String encodePage(
            int page, UUID householdId, SavingsState state, int limit) {
        String value =
                CURSOR_PREFIX
                        + ":"
                        + page
                        + ":"
                        + limit
                        + ":"
                        + householdId
                        + ":"
                        + (state == null ? "*" : state.name());
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static int decodePage(
            String cursor, UUID householdId, SavingsState state, int limit) {
        if (cursor == null || cursor.isBlank()) {
            return 0;
        }
        if (cursor.length() > 300 || !cursor.matches("^[A-Za-z0-9_-]+$")) {
            throw new ValidationException("cursor is invalid.");
        }
        try {
            String value =
                    new String(
                            Base64.getUrlDecoder().decode(cursor),
                            StandardCharsets.UTF_8);
            String[] parts = value.split(":", -1);
            String expectedState = state == null ? "*" : state.name();
            if (parts.length != 5
                    || !CURSOR_PREFIX.equals(parts[0])
                    || Integer.parseInt(parts[2]) != limit
                    || !parts[3].equals(householdId.toString())
                    || !parts[4].equals(expectedState)) {
                throw new IllegalArgumentException();
            }
            int page = Integer.parseInt(parts[1]);
            if (page < 1 || page > MAXIMUM_PAGE_INDEX) {
                throw new IllegalArgumentException();
            }
            return page;
        } catch (RuntimeException exception) {
            throw new ValidationException(
                    "cursor is invalid or was issued for another savings ledger.");
        }
    }

    private static final class MutableTotal {

        private long exactAmountMinor;
        private long estimatedAmountMinor;
        private int exactAttemptCount;
        private int estimatedAttemptCount;
    }
}
