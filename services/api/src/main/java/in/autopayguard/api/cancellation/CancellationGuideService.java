package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.CancellationCommitmentAccessService;
import in.autopayguard.api.commitment.CancellationCommitmentSnapshot;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import in.autopayguard.api.household.HouseholdMembershipService;
import in.autopayguard.api.merchant.MerchantReference;
import in.autopayguard.api.merchant.MerchantService;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class CancellationGuideService {

    private static final String SERVICE_TITLE = "Merchant service";
    private static final String PAYMENT_TITLE = "Payment mandate";

    private final CancellationCommitmentAccessService commitmentAccess;
    private final CurrentUserService currentUserService;
    private final HouseholdMembershipService householdMembershipService;
    private final MerchantService merchantService;
    private final CancellationGuideRepository guideRepository;
    private final CancellationGuideVersionRepository versionRepository;
    private final CancellationGuideStepRepository stepRepository;
    private final CancellationTargetRepository targetRepository;
    private final CancellationGuideFeedbackRepository feedbackRepository;
    private final SafeGuideTargetPolicy targetPolicy;
    private final Clock clock;

    CancellationGuideService(
            CancellationCommitmentAccessService commitmentAccess,
            CurrentUserService currentUserService,
            HouseholdMembershipService householdMembershipService,
            MerchantService merchantService,
            CancellationGuideRepository guideRepository,
            CancellationGuideVersionRepository versionRepository,
            CancellationGuideStepRepository stepRepository,
            CancellationTargetRepository targetRepository,
            CancellationGuideFeedbackRepository feedbackRepository,
            SafeGuideTargetPolicy targetPolicy,
            Clock clock) {
        this.commitmentAccess = commitmentAccess;
        this.currentUserService = currentUserService;
        this.householdMembershipService = householdMembershipService;
        this.merchantService = merchantService;
        this.guideRepository = guideRepository;
        this.versionRepository = versionRepository;
        this.stepRepository = stepRepository;
        this.targetRepository = targetRepository;
        this.feedbackRepository = feedbackRepository;
        this.targetPolicy = targetPolicy;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    CancellationGuideResponse get(Jwt jwt, UUID commitmentId) {
        CurrentUser caller = currentUserService.resolve(jwt);
        CancellationCommitmentSnapshot commitment =
                commitmentAccess.requireVisible(caller.id(), commitmentId);
        UUID ownerUserId =
                householdMembershipService
                        .requireConsentedReadAccess(
                                commitment.householdId(), caller.id())
                        .ownerUserId();
        GuideSelection selection = latestPublished(commitment);
        return toResponse(ownerUserId, commitment, selection);
    }

    @Transactional(readOnly = true)
    GuideSelection requireCurrentForAttempt(
            UUID ownerUserId,
            CancellationCommitmentSnapshot commitment,
            UUID requestedGuideId,
            int requestedVersion) {
        GuideSelection selection = latestPublished(commitment);
        if (!selection.guide().id().equals(requestedGuideId)
                || selection.version().version() != requestedVersion) {
            throw new RequestConflictException(
                    "The cancellation guide is no longer the current published version.");
        }
        if (freshness(selection.version()) != GuideFreshness.CURRENT) {
            throw new RequestConflictException(
                    "The cancellation guide is due for structural review.");
        }
        if (isUnsafeForCommitment(ownerUserId, commitment.id(), selection)) {
            throw new RequestConflictException(
                    "The cancellation guide target was reported unsafe by this user.");
        }
        validatedSteps(selection);
        return selection;
    }

    @Transactional(readOnly = true)
    GuideSelection requirePinnedForCommitment(
            CancellationCommitmentSnapshot commitment, UUID guideId, int guideVersion) {
        CancellationGuideEntity guide =
                guideRepository.findById(guideId).orElseThrow(ResourceNotFoundException::new);
        if (commitment.merchantId() == null
                || !guide.merchantId().equals(commitment.merchantId())) {
            throw new ResourceNotFoundException();
        }
        CancellationGuideVersionEntity version =
                versionRepository
                        .findById(new GuideVersionId(guideId, guideVersion))
                        .orElseThrow(ResourceNotFoundException::new);
        if (version.status() == GuideStatus.DRAFT) {
            throw new ResourceNotFoundException();
        }
        return new GuideSelection(guide, version, merchant(commitment));
    }

    @Transactional(readOnly = true)
    CancellationGuideResponse pinnedResponse(
            UUID ownerUserId,
            CancellationCommitmentSnapshot commitment,
            UUID guideId,
            int guideVersion) {
        return toResponse(
                ownerUserId,
                commitment,
                requirePinnedForCommitment(commitment, guideId, guideVersion));
    }

    @Transactional(readOnly = true)
    CancellationGuideResponse pinnedAttemptResponse(
            UUID ownerUserId,
            UUID householdId,
            UUID commitmentId,
            UUID guideId,
            int guideVersion) {
        CancellationGuideEntity guide =
                guideRepository.findById(guideId).orElseThrow(ResourceNotFoundException::new);
        CancellationGuideVersionEntity version =
                versionRepository
                        .findById(new GuideVersionId(guideId, guideVersion))
                        .orElseThrow(ResourceNotFoundException::new);
        MerchantReference merchant =
                merchantService
                        .findReference(guide.merchantId())
                        .orElseThrow(ResourceNotFoundException::new);
        return toResponse(
                ownerUserId,
                householdId,
                commitmentId,
                new GuideSelection(guide, version, merchant));
    }

    void validatePublishedCatalog() {
        List<CancellationGuideEntity> guides = guideRepository.findAll();
        if (guides.size() < 20) {
            throw new IllegalStateException(
                    "The fictional cancellation guide catalog must contain at least 20 guides.");
        }
        for (CancellationGuideEntity guide : guides) {
            CancellationGuideVersionEntity version =
                    versionRepository
                            .findFirstByGuideIdAndStatusOrderByVersionDesc(
                                    guide.id(), GuideStatus.PUBLISHED)
                            .orElseThrow(
                                    () ->
                                            new IllegalStateException(
                                                    "Every guide must have a published version."));
            if (version.publishedAt() == null
                    || version.structuralReviewedAt().isAfter(version.publishedAt())
                    || version.reviewIntervalDays() < 30
                    || version.reviewIntervalDays() > 90) {
                throw new IllegalStateException(
                        "Published guide review metadata is invalid.");
            }
            MerchantReference merchant =
                    merchantService
                            .findReference(guide.merchantId())
                            .orElseThrow(
                                    () ->
                                            new IllegalStateException(
                                                    "A guide merchant is missing."));
            validatedSteps(new GuideSelection(guide, version, merchant));
        }
    }

    private GuideSelection latestPublished(CancellationCommitmentSnapshot commitment) {
        if (commitment.merchantId() == null) {
            throw new ResourceNotFoundException();
        }
        CancellationGuideEntity guide =
                guideRepository
                        .findByMerchantId(commitment.merchantId())
                        .orElseThrow(ResourceNotFoundException::new);
        CancellationGuideVersionEntity version =
                versionRepository
                        .findCurrentPublished(guide.id())
                        .orElseThrow(ResourceNotFoundException::new);
        return new GuideSelection(guide, version, merchant(commitment));
    }

    private MerchantReference merchant(CancellationCommitmentSnapshot commitment) {
        return merchantService
                .findReference(commitment.merchantId())
                .filter(value -> value.category() == commitment.category())
                .orElseThrow(ResourceNotFoundException::new);
    }

    private CancellationGuideResponse toResponse(
            UUID ownerUserId,
            CancellationCommitmentSnapshot commitment,
            GuideSelection selection) {
        return toResponse(
                ownerUserId,
                commitment.householdId(),
                commitment.id(),
                selection);
    }

    private CancellationGuideResponse toResponse(
            UUID ownerUserId,
            UUID householdId,
            UUID commitmentId,
            GuideSelection selection) {
        GuideFreshness freshness = freshness(selection.version());
        boolean unsafe = isUnsafeForCommitment(ownerUserId, commitmentId, selection);
        GuideTargetSuppressionReason suppressionReason =
                unsafe
                        ? GuideTargetSuppressionReason.USER_REPORTED_UNSAFE
                        : freshness == GuideFreshness.REVIEW_DUE
                                ? GuideTargetSuppressionReason.REVIEW_DUE
                                : GuideTargetSuppressionReason.NONE;
        boolean suppressTargets = suppressionReason != GuideTargetSuppressionReason.NONE;

        Map<GuideTrackKind, List<GuideStepResponse>> byTrack =
                new EnumMap<>(GuideTrackKind.class);
        for (GuideTrackKind track : GuideTrackKind.values()) {
            byTrack.put(track, new ArrayList<>());
        }
        for (ValidatedStep step : validatedSteps(selection)) {
            GuideTargetResponse target =
                    suppressTargets || step.entity().actionType() == GuideStepKind.INFORMATION
                            ? null
                            : new GuideTargetResponse(
                                    targetLabel(step.entity().actionType()),
                                    step.entity().targetUri());
            byTrack.get(step.entity().track())
                    .add(
                            new GuideStepResponse(
                                    step.entity().sequenceNumber(),
                                    step.entity().actionType(),
                                    step.entity().title(),
                                    step.entity().instruction(),
                                    target));
        }
        List<GuideTrackResponse> tracks =
                List.of(
                        new GuideTrackResponse(
                                GuideTrackKind.SERVICE,
                                SERVICE_TITLE,
                                List.copyOf(byTrack.get(GuideTrackKind.SERVICE))),
                        new GuideTrackResponse(
                                GuideTrackKind.PAYMENT_MANDATE,
                                PAYMENT_TITLE,
                                List.copyOf(byTrack.get(GuideTrackKind.PAYMENT_MANDATE))));
        CancellationGuideVersionEntity version = selection.version();
        return new CancellationGuideResponse(
                selection.guide().id(),
                version.version(),
                householdId,
                commitmentId,
                selection.merchant().canonicalName(),
                PublishedGuideStatus.PUBLISHED,
                freshness,
                version.structuralReviewedAt(),
                version.reviewDueAt(),
                version.publishedAt(),
                version.riskNotice(),
                suppressTargets,
                suppressionReason,
                tracks);
    }

    private List<ValidatedStep> validatedSteps(GuideSelection selection) {
        List<CancellationGuideStepEntity> steps =
                stepRepository.findByGuideIdAndGuideVersionOrderByTrackAscSequenceNumberAsc(
                        selection.guide().id(), selection.version().version());
        List<ValidatedStep> result = new ArrayList<>();
        for (GuideTrackKind track : GuideTrackKind.values()) {
            int expectedSequence = 1;
            for (CancellationGuideStepEntity step : steps) {
                if (step.track() != track) {
                    continue;
                }
                if (step.sequenceNumber() != expectedSequence++) {
                    throw new IllegalStateException(
                            "Cancellation guide steps are not contiguous.");
                }
                CancellationTargetEntity target = null;
                if (step.actionType() != GuideStepKind.INFORMATION) {
                    target =
                            targetRepository
                                    .findById(step.targetKey())
                                    .orElseThrow(
                                            () ->
                                                    new IllegalStateException(
                                                            "Cancellation guide target is missing."));
                    targetPolicy.validate(step.actionType(), step.targetUri(), target);
                } else if (step.targetKey() != null || step.targetUri() != null) {
                    throw new IllegalStateException(
                            "Informational guide steps cannot contain targets.");
                }
                result.add(new ValidatedStep(step, target));
            }
            if (expectedSequence != 3) {
                throw new IllegalStateException(
                        "Each cancellation guide track must contain exactly two ordered steps.");
            }
        }
        return List.copyOf(result);
    }

    private boolean isUnsafeForCommitment(
            UUID ownerUserId, UUID commitmentId, GuideSelection selection) {
        return feedbackRepository
                .existsByOwnerUserIdAndCommitmentIdAndGuideIdAndGuideVersionAndOutcome(
                ownerUserId,
                commitmentId,
                selection.guide().id(),
                selection.version().version(),
                GuideFeedbackOutcome.UNSAFE_LINK);
    }

    private GuideFreshness freshness(CancellationGuideVersionEntity version) {
        LocalDate catalogToday = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        LocalDate reviewDueDate =
                version.reviewDueAt().atZone(ZoneOffset.UTC).toLocalDate();
        return catalogToday.isAfter(reviewDueDate)
                ? GuideFreshness.REVIEW_DUE
                : GuideFreshness.CURRENT;
    }

    private static String targetLabel(GuideStepKind kind) {
        return switch (kind) {
            case SAFE_LINK -> "Open fictional provider";
            case APP_DEEP_LINK -> "Open demo mandate screen";
            case INFORMATION ->
                    throw new IllegalArgumentException("Informational steps have no target.");
        };
    }

    record GuideSelection(
            CancellationGuideEntity guide,
            CancellationGuideVersionEntity version,
            MerchantReference merchant) {}

    private record ValidatedStep(
            CancellationGuideStepEntity entity, CancellationTargetEntity target) {}
}
