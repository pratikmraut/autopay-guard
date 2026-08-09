package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.CancellationCommitmentAccessService;
import in.autopayguard.api.commitment.CancellationCommitmentSnapshot;
import in.autopayguard.api.commitment.CancellationOccurrenceSnapshot;
import in.autopayguard.api.commitment.CommitmentStatus;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.common.validation.SensitiveContentGuard;
import in.autopayguard.api.common.web.EntityTags;
import in.autopayguard.api.household.HouseholdAccessService;
import in.autopayguard.api.household.HouseholdMembershipService;
import in.autopayguard.api.household.OwnedHousehold;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class CancellationAttemptService {

    private static final String CURSOR_PREFIX = "a1";
    private static final int MAXIMUM_PAGE_INDEX = 10_000;

    private final CancellationAttemptRepository attemptRepository;
    private final CancellationAttemptVerificationRepository verificationRepository;
    private final SavingsEventRepository savingsEventRepository;
    private final CancellationCommitmentAccessService commitmentAccess;
    private final HouseholdAccessService householdAccessService;
    private final HouseholdMembershipService householdMembershipService;
    private final OccurrenceDecisionService decisionService;
    private final CancellationGuideService guideService;
    private final CurrentUserService currentUserService;
    private final IdempotencyService idempotencyService;
    private final SavingsCalculator savingsCalculator;
    private final Clock clock;

    CancellationAttemptService(
            CancellationAttemptRepository attemptRepository,
            CancellationAttemptVerificationRepository verificationRepository,
            SavingsEventRepository savingsEventRepository,
            CancellationCommitmentAccessService commitmentAccess,
            HouseholdAccessService householdAccessService,
            HouseholdMembershipService householdMembershipService,
            OccurrenceDecisionService decisionService,
            CancellationGuideService guideService,
            CurrentUserService currentUserService,
            IdempotencyService idempotencyService,
            SavingsCalculator savingsCalculator,
            Clock clock) {
        this.attemptRepository = attemptRepository;
        this.verificationRepository = verificationRepository;
        this.savingsEventRepository = savingsEventRepository;
        this.commitmentAccess = commitmentAccess;
        this.householdAccessService = householdAccessService;
        this.householdMembershipService = householdMembershipService;
        this.decisionService = decisionService;
        this.guideService = guideService;
        this.currentUserService = currentUserService;
        this.idempotencyService = idempotencyService;
        this.savingsCalculator = savingsCalculator;
        this.clock = clock;
    }

    @Transactional
    CancellationAttemptResponse create(
            Jwt jwt,
            UUID pathCommitmentId,
            String idempotencyKey,
            CreateCancellationAttemptRequest request) {
        CurrentUser owner = currentUserService.resolve(jwt);
        String note = normalizeNote(request.note());
        IdempotencyService.Claim claim =
                idempotencyService.begin(
                        owner.id(),
                        IdempotencyOperation.CANCELLATION_ATTEMPT,
                        idempotencyKey,
                        List.of(
                                pathCommitmentId.toString(),
                                request.occurrenceId().toString(),
                                request.decisionId().toString(),
                                request.guideId().toString(),
                                Integer.toString(request.guideVersion()),
                                note == null ? "" : note));
        if (claim.replay()) {
            return refreshGuideProjection(
                    owner.id(),
                    idempotencyService.replay(
                            claim, CancellationAttemptResponse.class));
        }

        CancellationOccurrenceSnapshot occurrence =
                commitmentAccess.lockOwnedOccurrence(owner.id(), request.occurrenceId());
        CancellationCommitmentSnapshot commitment = occurrence.commitment();
        if (!commitment.id().equals(pathCommitmentId)) {
            throw new ResourceNotFoundException();
        }
        if (commitment.status() == CommitmentStatus.ARCHIVED) {
            throw new ResourceNotFoundException();
        }
        OccurrenceDecisionEntity decision =
                decisionService.requireCurrentCancellationDecision(
                        owner.id(),
                        commitment.id(),
                        occurrence.id(),
                        request.decisionId());
        OwnedHousehold household =
                householdAccessService.requireOwned(commitment.householdId(), owner.id());
        CancellationGuideService.GuideSelection guide =
                guideService.requireCurrentForAttempt(
                        owner.id(),
                        commitment,
                        request.guideId(),
                        request.guideVersion());
        if (attemptRepository.existsByCommitmentIdAndUnresolvedKeyIsNotNull(
                commitment.id())) {
            throw new RequestConflictException(
                    "Only one unresolved cancellation attempt is allowed per commitment.");
        }

        SavingsProjection savings = savingsCalculator.calculate(occurrence);
        Instant now = clock.instant();
        CancellationAttemptEntity attempt =
                attemptRepository.saveAndFlush(
                        CancellationAttemptEntity.create(
                                owner.id(),
                                occurrence,
                                decision,
                                guide,
                                household.timezone(),
                                paymentMandateRequired(commitment.paymentRail()),
                                savings,
                                note,
                                unresolvedKey(commitment.id()),
                                now));
        if (attempt.projectedSavingsMinor() != null) {
            savingsEventRepository.save(
                    SavingsEventEntity.create(
                            attempt, SavingsState.POTENTIAL, null, now));
        }
        CancellationAttemptResponse response = toResponse(attempt);
        idempotencyService.complete(
                owner.id(),
                IdempotencyOperation.CANCELLATION_ATTEMPT,
                claim,
                attempt.id(),
                response,
                response.version());
        return response;
    }

    @Transactional(readOnly = true)
    CancellationAttemptResponse get(Jwt jwt, UUID attemptId) {
        CurrentUser caller = currentUserService.resolve(jwt);
        CancellationAttemptEntity attempt =
                attemptRepository
                        .findVisibleById(caller.id(), attemptId)
                        .orElseThrow(ResourceNotFoundException::new);
        householdMembershipService.requireConsentedReadAccess(
                attempt.householdId(), caller.id());
        return toResponse(attempt);
    }

    @Transactional(readOnly = true)
    CancellationAttemptPageResponse list(
            Jwt jwt,
            UUID commitmentId,
            UUID householdId,
            int limit,
            String cursor) {
        validateLimit(limit);
        CurrentUser caller = currentUserService.resolve(jwt);
        CancellationCommitmentSnapshot commitment =
                commitmentAccess.requireVisible(caller.id(), commitmentId);
        if (!commitment.householdId().equals(householdId)) {
            throw new ResourceNotFoundException();
        }
        int pageIndex = decodePage(cursor, householdId, commitmentId, limit);
        Page<CancellationAttemptEntity> page =
                attemptRepository.findByHouseholdIdAndCommitmentId(
                        householdId,
                        commitmentId,
                        PageRequest.of(
                                pageIndex,
                                limit,
                                Sort.by(
                                        Sort.Order.desc("createdAt"),
                                        Sort.Order.desc("id"))));
        List<CancellationAttemptResponse> items =
                page.getContent().stream().map(this::toResponse).toList();
        return new CancellationAttemptPageResponse(
                householdId,
                commitmentId,
                items,
                page.hasNext()
                        ? encodePage(pageIndex + 1, householdId, commitmentId, limit)
                        : null);
    }

    @Transactional
    CancellationAttemptResponse update(
            Jwt jwt,
            UUID attemptId,
            String ifMatch,
            UpdateCancellationAttemptRequest request) {
        long expectedVersion = EntityTags.requiredVersion(ifMatch);
        CurrentUser owner = currentUserService.resolve(jwt);
        CancellationAttemptEntity attempt =
                attemptRepository
                        .findOwnedByIdForUpdate(attemptId, owner.id())
                        .orElseThrow(ResourceNotFoundException::new);
        verifyVersion(attempt, expectedVersion);
        if (attempt.abandoned()
                || attempt.verificationStatus()
                        == CancellationVerificationStatus.VERIFIED
                || attempt.verificationStatus()
                        == CancellationVerificationStatus.DISPUTED) {
            throw new RequestConflictException(
                    "A closed cancellation attempt cannot change its tracks or be abandoned.");
        }
        Instant now = clock.instant();
        if (request.abandoned()) {
            if (attempt.serviceStatus() != request.serviceStatus()
                    || attempt.paymentMandateStatus()
                            != request.paymentMandateStatus()) {
                throw new ValidationException(
                        "Abandonment must preserve the current track states.");
            }
            attempt.abandon(now);
            appendSavingsEvent(
                    attempt,
                    SavingsState.REVERSED,
                    SavingsReversalReason.ABANDONED,
                    now);
        } else {
            attempt.replaceTracks(
                    request.serviceStatus(), request.paymentMandateStatus(), now);
        }
        attemptRepository.saveAndFlush(attempt);
        return toResponse(attempt);
    }

    @Transactional
    CancellationAttemptResponse verify(
            Jwt jwt,
            UUID attemptId,
            String ifMatch,
            String idempotencyKey,
            VerifyCancellationAttemptRequest request) {
        long expectedVersion = EntityTags.requiredVersion(ifMatch);
        CancellationVerificationStatus requestedStatus =
                CancellationVerificationStatus.valueOf(request.status().name());
        CurrentUser owner = currentUserService.resolve(jwt);
        IdempotencyService.Claim claim =
                idempotencyService.begin(
                        owner.id(),
                        IdempotencyOperation.ATTEMPT_VERIFICATION,
                        idempotencyKey,
                        List.of(attemptId.toString(), request.status().name()));
        if (claim.replay()) {
            return refreshGuideProjection(
                    owner.id(),
                    idempotencyService.replay(
                            claim, CancellationAttemptResponse.class));
        }

        CancellationAttemptEntity attempt =
                attemptRepository
                        .findOwnedByIdForUpdate(attemptId, owner.id())
                        .orElseThrow(ResourceNotFoundException::new);
        verifyVersion(attempt, expectedVersion);
        if ((requestedStatus == CancellationVerificationStatus.SELF_REPORTED
                        || requestedStatus == CancellationVerificationStatus.VERIFIED)
                && !attempt.tracksComplete()) {
            throw new RequestConflictException(
                    "All required cancellation tracks must be confirmed first.");
        }
        if ((requestedStatus == CancellationVerificationStatus.VERIFIED
                        || requestedStatus == CancellationVerificationStatus.DISPUTED)
                && localToday(attempt).isBefore(attempt.verificationDueDate())) {
            throw new RequestConflictException(
                    "Verification is available on or after the household due date.");
        }

        CancellationVerificationStatus previous = attempt.verificationStatus();
        Instant now = clock.instant();
        attempt.verify(requestedStatus, now);
        attemptRepository.saveAndFlush(attempt);
        verificationRepository.save(
                CancellationAttemptVerificationEntity.create(
                        attempt.id(),
                        previous,
                        requestedStatus,
                        attempt.version(),
                        now));
        switch (requestedStatus) {
            case SELF_REPORTED ->
                    appendSavingsEvent(
                            attempt, SavingsState.SELF_REPORTED, null, now);
            case VERIFIED ->
                    appendSavingsEvent(attempt, SavingsState.VERIFIED, null, now);
            case DISPUTED ->
                    appendSavingsEvent(
                            attempt,
                            SavingsState.REVERSED,
                            SavingsReversalReason.DEBIT_OCCURRED,
                            now);
            case PENDING ->
                    throw new IllegalStateException("PENDING is not a verification event.");
        }
        CancellationAttemptResponse response = toResponse(attempt);
        idempotencyService.complete(
                owner.id(),
                IdempotencyOperation.ATTEMPT_VERIFICATION,
                claim,
                attempt.id(),
                response,
                response.version());
        return response;
    }

    private CancellationAttemptResponse toResponse(CancellationAttemptEntity attempt) {
        CancellationGuideResponse guide =
                guideService.pinnedAttemptResponse(
                        attempt.ownerUserId(),
                        attempt.householdId(),
                        attempt.commitmentId(),
                        attempt.guideId(),
                        attempt.guideVersion());
        return new CancellationAttemptResponse(
                attempt.id(),
                attempt.householdId(),
                attempt.commitmentId(),
                attempt.occurrenceId(),
                attempt.decisionId(),
                attempt.guideId(),
                attempt.guideVersion(),
                guide,
                attempt.scheduledDate(),
                attempt.amountKind(),
                attempt.currency(),
                attempt.projectedSavingsMinor(),
                attempt.savingsPeriodStart(),
                attempt.savingsPeriodEnd(),
                attempt.savingsEstimated(),
                attempt.serviceStatus(),
                attempt.paymentMandateStatus(),
                attempt.verificationStatus(),
                attempt.verificationDueDate(),
                verificationDueReached(attempt),
                attempt.completedAt(),
                attempt.abandoned(),
                attempt.version(),
                attempt.createdAt(),
                attempt.updatedAt());
    }

    private CancellationAttemptResponse refreshGuideProjection(
            UUID ownerUserId, CancellationAttemptResponse original) {
        CancellationGuideResponse guide =
                guideService.pinnedAttemptResponse(
                        ownerUserId,
                        original.householdId(),
                        original.commitmentId(),
                        original.guideId(),
                        original.guideVersion());
        return new CancellationAttemptResponse(
                original.id(),
                original.householdId(),
                original.commitmentId(),
                original.occurrenceId(),
                original.decisionId(),
                original.guideId(),
                original.guideVersion(),
                guide,
                original.scheduledDate(),
                original.amountKind(),
                original.currency(),
                original.projectedSavingsMinor(),
                original.savingsPeriodStart(),
                original.savingsPeriodEnd(),
                original.estimated(),
                original.serviceStatus(),
                original.paymentMandateStatus(),
                original.verificationStatus(),
                original.verificationDueDate(),
                original.verificationDueReached(),
                original.completedAt(),
                original.abandoned(),
                original.version(),
                original.createdAt(),
                original.updatedAt());
    }

    private CancellationAttemptEntity requireOwned(UUID ownerUserId, UUID attemptId) {
        return attemptRepository
                .findByIdAndOwnerUserId(attemptId, ownerUserId)
                .orElseThrow(ResourceNotFoundException::new);
    }

    private void appendSavingsEvent(
            CancellationAttemptEntity attempt,
            SavingsState state,
            SavingsReversalReason reason,
            Instant now) {
        if (attempt.projectedSavingsMinor() != null) {
            savingsEventRepository.save(
                    SavingsEventEntity.create(attempt, state, reason, now));
        }
    }

    private LocalDate localToday(CancellationAttemptEntity attempt) {
        return LocalDate.now(clock.withZone(ZoneId.of(attempt.householdTimezone())));
    }

    private boolean verificationDueReached(CancellationAttemptEntity attempt) {
        return !localToday(attempt).isBefore(attempt.verificationDueDate());
    }

    private static boolean paymentMandateRequired(PaymentRail rail) {
        return switch (rail) {
            case UPI_AUTOPAY,
                    CARD_RECURRING,
                    NACH_ENACH,
                    APP_STORE,
                    MERCHANT_DIRECT -> true;
            case CASH_OR_MANUAL, UNKNOWN -> false;
        };
    }

    private static void verifyVersion(
            CancellationAttemptEntity attempt, long expectedVersion) {
        if (attempt.version() != expectedVersion) {
            throw new PreconditionFailedException();
        }
    }

    private static String normalizeNote(String raw) {
        if (raw == null) {
            return null;
        }
        if (raw.isBlank()) {
            throw new ValidationException(
                    "note must contain non-whitespace text when supplied.");
        }
        String value = raw.strip();
        SensitiveContentGuard.rejectObviousSecrets(value, "note");
        return value;
    }

    private static String unresolvedKey(UUID commitmentId) {
        return IdempotencyService.canonicalHash(
                List.of("unresolved-attempt", commitmentId.toString()));
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ValidationException("limit must be between 1 and 100.");
        }
    }

    private static String encodePage(
            int page, UUID householdId, UUID commitmentId, int limit) {
        String value =
                CURSOR_PREFIX
                        + ":"
                        + page
                        + ":"
                        + limit
                        + ":"
                        + householdId
                        + ":"
                        + commitmentId;
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static int decodePage(
            String cursor, UUID householdId, UUID commitmentId, int limit) {
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
            if (parts.length != 5
                    || !CURSOR_PREFIX.equals(parts[0])
                    || Integer.parseInt(parts[2]) != limit
                    || !parts[3].equals(householdId.toString())
                    || !parts[4].equals(commitmentId.toString())) {
                throw new IllegalArgumentException();
            }
            int page = Integer.parseInt(parts[1]);
            if (page < 1 || page > MAXIMUM_PAGE_INDEX) {
                throw new IllegalArgumentException();
            }
            return page;
        } catch (RuntimeException exception) {
            throw new ValidationException(
                    "cursor is invalid or was issued for another attempt collection.");
        }
    }
}
