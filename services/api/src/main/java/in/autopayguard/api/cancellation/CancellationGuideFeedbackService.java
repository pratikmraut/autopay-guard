package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.CancellationCommitmentAccessService;
import in.autopayguard.api.commitment.CancellationCommitmentSnapshot;
import in.autopayguard.api.common.validation.SensitiveContentGuard;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class CancellationGuideFeedbackService {

    private final CurrentUserService currentUserService;
    private final IdempotencyService idempotencyService;
    private final CancellationCommitmentAccessService commitmentAccess;
    private final CancellationGuideService guideService;
    private final CancellationGuideFeedbackRepository feedbackRepository;
    private final Clock clock;

    CancellationGuideFeedbackService(
            CurrentUserService currentUserService,
            IdempotencyService idempotencyService,
            CancellationCommitmentAccessService commitmentAccess,
            CancellationGuideService guideService,
            CancellationGuideFeedbackRepository feedbackRepository,
            Clock clock) {
        this.currentUserService = currentUserService;
        this.idempotencyService = idempotencyService;
        this.commitmentAccess = commitmentAccess;
        this.guideService = guideService;
        this.feedbackRepository = feedbackRepository;
        this.clock = clock;
    }

    @Transactional
    void create(
            Jwt jwt,
            UUID guideId,
            String idempotencyKey,
            CreateCancellationGuideFeedbackRequest request) {
        CurrentUser owner = currentUserService.resolve(jwt);
        String note = normalizeNote(request.note());
        IdempotencyService.Claim claim =
                idempotencyService.begin(
                        owner.id(),
                        IdempotencyOperation.GUIDE_FEEDBACK,
                        idempotencyKey,
                        List.of(
                                guideId.toString(),
                                request.commitmentId().toString(),
                                Integer.toString(request.guideVersion()),
                                request.outcome().name(),
                                note == null ? "" : note));
        if (claim.replay()) {
            return;
        }

        CancellationCommitmentSnapshot commitment =
                commitmentAccess.lockOwned(owner.id(), request.commitmentId());
        guideService.requirePinnedForCommitment(
                commitment, guideId, request.guideVersion());
        CancellationGuideFeedbackEntity feedback =
                CancellationGuideFeedbackEntity.create(
                        owner.id(),
                        commitment.householdId(),
                        commitment.id(),
                        guideId,
                        request.guideVersion(),
                        request.outcome(),
                        note,
                        clock.instant());
        feedbackRepository.saveAndFlush(feedback);
        idempotencyService.complete(
                owner.id(), IdempotencyOperation.GUIDE_FEEDBACK, claim, feedback.id());
    }

    private static String normalizeNote(String raw) {
        if (raw == null) {
            return null;
        }
        if (raw.isBlank()) {
            throw new jakarta.validation.ValidationException(
                    "note must contain non-whitespace text when supplied.");
        }
        String value = raw.strip();
        SensitiveContentGuard.rejectObviousSecrets(value, "note");
        return value;
    }
}
