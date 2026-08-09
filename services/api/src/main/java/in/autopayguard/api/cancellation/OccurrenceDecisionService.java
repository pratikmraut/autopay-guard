package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.CancellationCommitmentAccessService;
import in.autopayguard.api.commitment.CancellationOccurrenceSnapshot;
import in.autopayguard.api.commitment.CommitmentService;
import in.autopayguard.api.commitment.ReviewAction;
import in.autopayguard.api.commitment.ReviewActionPolicy;
import in.autopayguard.api.commitment.UpcomingItemResponse;
import in.autopayguard.api.commitment.UpcomingListResponse;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OccurrenceDecisionService {

    private static final String CURSOR_PREFIX = "d1";
    private static final int MAXIMUM_PAGE_INDEX = 10_000;

    private final OccurrenceDecisionRepository repository;
    private final CancellationCommitmentAccessService commitmentAccess;
    private final CommitmentService commitmentService;
    private final CurrentUserService currentUserService;
    private final IdempotencyService idempotency;
    private final Clock clock;

    OccurrenceDecisionService(
            OccurrenceDecisionRepository repository,
            CancellationCommitmentAccessService commitmentAccess,
            CommitmentService commitmentService,
            CurrentUserService currentUserService,
            IdempotencyService idempotency,
            Clock clock) {
        this.repository = repository;
        this.commitmentAccess = commitmentAccess;
        this.commitmentService = commitmentService;
        this.currentUserService = currentUserService;
        this.idempotency = idempotency;
        this.clock = clock;
    }

    @Transactional
    public OccurrenceDecisionResponse create(
            Jwt jwt,
            UUID occurrenceId,
            String idempotencyKey,
            CreateOccurrenceDecisionRequest request) {
        CurrentUser owner = currentUserService.resolve(jwt);
        IdempotencyService.Claim claim =
                idempotency.begin(
                        owner.id(),
                        IdempotencyOperation.OCCURRENCE_DECISION,
                        idempotencyKey,
                        List.of(occurrenceId.toString(), request.decision().name()));
        if (claim.replay()) {
            return idempotency.replay(claim, OccurrenceDecisionResponse.class);
        }

        CancellationOccurrenceSnapshot occurrence =
                commitmentAccess.lockOwnedOccurrence(owner.id(), occurrenceId);
        if (!ReviewActionPolicy.forCategory(occurrence.commitment().category())
                .contains(request.decision())) {
            throw new ValidationException(
                    "decision is not allowed for this commitment category.");
        }
        int sequence =
                Math.addExact(
                        repository.maximumSequence(
                                occurrence.commitment().id(), occurrence.scheduledDate()),
                        1);
        OccurrenceDecisionEntity decision =
                repository.saveAndFlush(
                        OccurrenceDecisionEntity.create(
                                owner.id(),
                                occurrence,
                                request.decision(),
                                sequence,
                                clock.instant()));
        OccurrenceDecisionResponse response = toResponse(decision);
        idempotency.complete(
                owner.id(),
                IdempotencyOperation.OCCURRENCE_DECISION,
                claim,
                decision.id(),
                response,
                null);
        return response;
    }

    @Transactional
    public DecisionInboxPageResponse inbox(
            Jwt jwt,
            UUID householdId,
            LocalDate from,
            LocalDate to,
            int limit,
            String cursor) {
        if (limit < 1 || limit > 100) {
            throw new ValidationException("limit must be between 1 and 100.");
        }
        UpcomingListResponse upcoming =
                commitmentService.upcoming(jwt, householdId, from, to);
        int pageIndex = decodePage(cursor, householdId, limit);
        int start = Math.multiplyExact(pageIndex, limit);
        List<UpcomingItemResponse> all = upcoming.items();
        if (start > all.size()) {
            throw new ValidationException("cursor is outside the available decision inbox.");
        }
        int end = Math.min(all.size(), Math.addExact(start, limit));
        List<DecisionInboxItemResponse> items =
                all.subList(start, end).stream()
                        .map(item -> toInboxItem(householdId, item))
                        .toList();
        String nextCursor =
                end < all.size() ? encodePage(pageIndex + 1, householdId, limit) : null;
        return new DecisionInboxPageResponse(
                householdId, upcoming.from(), upcoming.to(), items, nextCursor);
    }

    @Transactional(readOnly = true)
    OccurrenceDecisionEntity requireCurrentCancellationDecision(
            UUID ownerUserId,
            UUID commitmentId,
            UUID occurrenceId,
            UUID decisionId) {
        OccurrenceDecisionEntity current =
                repository
                        .findFirstByOwnerUserIdAndOccurrenceIdOrderBySequenceNumberDesc(
                                ownerUserId, occurrenceId)
                        .orElseThrow(ResourceNotFoundException::new);
        if (!current.id().equals(decisionId)
                || !current.commitmentId().equals(commitmentId)
                || current.action() != ReviewAction.CANCEL_WITH_PROVIDER) {
            throw new ResourceNotFoundException();
        }
        return current;
    }

    private DecisionInboxItemResponse toInboxItem(
            UUID householdId, UpcomingItemResponse item) {
        OccurrenceDecisionResponse current =
                repository
                        .findFirstByOccurrenceIdOrderBySequenceNumberDesc(item.id())
                        .map(OccurrenceDecisionService::toResponse)
                        .orElse(null);
        return new DecisionInboxItemResponse(
                item.id(),
                item.commitmentId(),
                householdId,
                item.displayName(),
                item.category(),
                item.paymentRail(),
                item.scheduledDate(),
                item.expectedAmountMinor(),
                item.currency(),
                item.amountKind(),
                item.reviewActions(),
                current);
    }

    static OccurrenceDecisionResponse toResponse(OccurrenceDecisionEntity decision) {
        return new OccurrenceDecisionResponse(
                decision.id(),
                decision.occurrenceId(),
                decision.commitmentId(),
                decision.householdId(),
                decision.action(),
                decision.createdAt());
    }

    private static String encodePage(int page, UUID householdId, int limit) {
        String value = CURSOR_PREFIX + ":" + page + ":" + limit + ":" + householdId;
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static int decodePage(String cursor, UUID householdId, int limit) {
        if (cursor == null || cursor.isBlank()) {
            return 0;
        }
        if (cursor.length() > 200 || !cursor.matches("^[A-Za-z0-9_-]+$")) {
            throw new ValidationException("cursor is invalid.");
        }
        try {
            String value =
                    new String(
                            Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            String[] parts = value.split(":", -1);
            int page = Integer.parseInt(parts[1]);
            if (parts.length != 4
                    || !CURSOR_PREFIX.equals(parts[0])
                    || Integer.parseInt(parts[2]) != limit
                    || !parts[3].equals(householdId.toString())
                    || page < 1
                    || page > MAXIMUM_PAGE_INDEX) {
                throw new IllegalArgumentException();
            }
            return page;
        } catch (RuntimeException exception) {
            throw new ValidationException(
                    "cursor is invalid or was issued for another decision inbox.");
        }
    }
}
