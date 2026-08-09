package in.autopayguard.api.commitment;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.audit.AuditService.Action;
import in.autopayguard.api.audit.AuditService.ActorRole;
import in.autopayguard.api.audit.AuditService.ResourceType;
import in.autopayguard.api.common.error.MalformedPreconditionException;
import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.household.HouseholdAccessService;
import in.autopayguard.api.household.ActiveHouseholdAccess;
import in.autopayguard.api.household.OwnedHousehold;
import in.autopayguard.api.household.HouseholdMembershipService;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import in.autopayguard.api.merchant.MerchantReference;
import in.autopayguard.api.merchant.MerchantService;
import in.autopayguard.api.privacy.ConsentService;
import jakarta.validation.ValidationException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CommitmentService {

    private static final String CURSOR_PREFIX = "v1";
    private static final int MAXIMUM_PAGE_INDEX = 10_000;

    private final CommitmentRepository commitmentRepository;
    private final CommitmentOccurrenceRepository occurrenceRepository;
    private final HouseholdAccessService householdAccessService;
    private final HouseholdMembershipService membershipService;
    private final CurrentUserService currentUserService;
    private final MerchantService merchantService;
    private final OccurrenceReconciliationService reconciliationService;
    private final CommitmentArchiveGuard archiveGuard;
    private final ConsentService consentService;
    private final AuditService auditService;
    private final Clock clock;

    CommitmentService(
            CommitmentRepository commitmentRepository,
            CommitmentOccurrenceRepository occurrenceRepository,
            HouseholdAccessService householdAccessService,
            HouseholdMembershipService membershipService,
            CurrentUserService currentUserService,
            MerchantService merchantService,
            OccurrenceReconciliationService reconciliationService,
            CommitmentArchiveGuard archiveGuard,
            ConsentService consentService,
            AuditService auditService,
            Clock clock) {
        this.commitmentRepository = commitmentRepository;
        this.occurrenceRepository = occurrenceRepository;
        this.householdAccessService = householdAccessService;
        this.membershipService = membershipService;
        this.currentUserService = currentUserService;
        this.merchantService = merchantService;
        this.reconciliationService = reconciliationService;
        this.archiveGuard = archiveGuard;
        this.consentService = consentService;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional
    public CommitmentResponse create(Jwt jwt, CreateCommitmentRequest request) {
        CurrentUser owner = currentUserService.resolve(jwt);
        OwnedHousehold household =
                householdAccessService.requireOwned(request.householdId(), owner.id());
        CommitmentRules.ValidatedCommitment input = CommitmentRules.validate(request);
        MerchantReference merchant = compatibleMerchant(input.merchantId(), input.category());

        CommitmentEntity commitment =
                CommitmentEntity.create(
                        household.id(),
                        owner.id(),
                        input.merchantId(),
                        input.displayName(),
                        input.category(),
                        input.paymentRail(),
                        input.amountMinor(),
                        input.estimatedAmountMinor(),
                        input.currency(),
                        input.frequency(),
                        input.intervalCount(),
                        input.customIntervalUnit(),
                        input.anchorDate(),
                        input.monthDayPolicy(),
                        input.variableAmount(),
                        input.maskedPaymentLabel(),
                        clock.instant());
        commitmentRepository.save(commitment);
        reconciliationService.replaceFutureAndReconcile(
                commitment, household.timezone(), false);
        commitmentRepository.saveAndFlush(commitment);
        return toResponse(commitment, merchant, true);
    }

    @Transactional(readOnly = true)
    public CommitmentResponse get(Jwt jwt, UUID commitmentId) {
        CurrentUser user = currentUserService.resolve(jwt);
        CommitmentEntity commitment = requireVisible(user.id(), commitmentId);
        ActiveHouseholdAccess access =
                membershipService.requireConsentedReadAccess(
                        commitment.householdId(), user.id());
        return toResponse(
                commitment,
                merchantService.findReference(commitment.merchantId()).orElse(null),
                access.owner());
    }

    @Transactional(readOnly = true)
    public CommitmentPageResponse list(
            Jwt jwt,
            UUID householdId,
            int limit,
            String cursor,
            boolean includeArchived) {
        if (limit < 1 || limit > 100) {
            throw new ValidationException("limit must be between 1 and 100.");
        }
        CurrentUser user = currentUserService.resolve(jwt);
        ActiveHouseholdAccess access =
                membershipService.requireConsentedReadAccess(householdId, user.id());
        int pageIndex = decodePage(cursor, limit);
        PageRequest pageable =
                PageRequest.of(
                        pageIndex,
                        limit,
                        Sort.unsorted());
        Page<CommitmentEntity> page =
                commitmentRepository.findVisiblePage(
                        user.id(), householdId, includeArchived, pageable);
        List<CommitmentResponse> items =
                page.getContent().stream()
                        .map(
                                commitment ->
                                        toResponse(
                                                commitment,
                                                merchantService
                                                        .findReference(
                                                                commitment.merchantId())
                                                        .orElse(null),
                                                access.owner()))
                        .toList();
        String nextCursor = page.hasNext() ? encodePage(pageIndex + 1, limit) : null;
        return new CommitmentPageResponse(items, nextCursor);
    }

    @Transactional
    public CommitmentResponse update(
            Jwt jwt,
            UUID commitmentId,
            long expectedVersion,
            UpdateCommitmentRequest request) {
        CurrentUser owner = currentUserService.resolve(jwt);
        CommitmentEntity commitment =
                requireOwnedMutableForUpdate(owner.id(), commitmentId);
        verifyVersion(commitment, expectedVersion);
        OwnedHousehold household =
                householdAccessService.requireOwned(commitment.householdId(), owner.id());
        CommitmentRules.ValidatedCommitment input = CommitmentRules.validate(request);
        MerchantReference merchant = compatibleMerchant(input.merchantId(), input.category());

        commitment.update(
                new UpdateCommitmentRequest(
                        input.merchantId(),
                        input.displayName(),
                        input.category(),
                        input.paymentRail(),
                        input.amountMinor(),
                        input.estimatedAmountMinor(),
                        input.currency(),
                        input.frequency(),
                        input.intervalCount(),
                        input.customIntervalUnit(),
                        input.anchorDate(),
                        input.monthDayPolicy(),
                        input.variableAmount(),
                        input.maskedPaymentLabel(),
                        CommitmentUpdateStatus.valueOf(input.status().name())),
                clock.instant());
        reconciliationService.replaceFutureAndReconcile(
                commitment, household.timezone(), true);
        commitmentRepository.saveAndFlush(commitment);
        return toResponse(commitment, merchant, true);
    }

    @Transactional
    public void archive(Jwt jwt, UUID commitmentId, long expectedVersion) {
        CurrentUser owner = currentUserService.resolve(jwt);
        CommitmentEntity commitment =
                requireOwnedMutableForUpdate(owner.id(), commitmentId);
        verifyVersion(commitment, expectedVersion);
        OwnedHousehold household =
                householdAccessService.requireOwned(commitment.householdId(), owner.id());
        archiveGuard.requireArchivable(commitment.id());
        commitment.archive(clock.instant());
        reconciliationService.replaceFutureAndReconcile(
                commitment, household.timezone(), true);
        commitmentRepository.saveAndFlush(commitment);
    }

    @Transactional
    public CommitmentResponse updateSharing(
            Jwt jwt,
            UUID commitmentId,
            long expectedVersion,
            UpdateCommitmentSharingRequest request) {
        CurrentUser owner = currentUserService.resolve(jwt);
        UUID householdId =
                commitmentRepository
                        .findOwnedHouseholdId(owner.id(), commitmentId)
                        .orElseThrow(ResourceNotFoundException::new);
        membershipService.lockOwnerMutationScope(householdId, owner.id());
        CommitmentEntity commitment =
                requireOwnedMutableForUpdate(owner.id(), commitmentId);
        verifyVersion(commitment, expectedVersion);
        UUID responsibleMemberId = request.responsibleMemberId();
        if (request.visibility() == CommitmentVisibility.PRIVATE) {
            if (responsibleMemberId != null) {
                throw new ValidationException(
                        "responsibleMemberId must be null when visibility is PRIVATE.");
            }
        } else {
            if (!consentService.isSharingGranted(owner.id())) {
                throw new in.autopayguard.api.common.error.RequestConflictException(
                        "Grant the current household-sharing consent before sharing a commitment.");
            }
            if (responsibleMemberId != null) {
                membershipService.requireAssignableMember(
                        householdId, responsibleMemberId);
            }
        }
        commitment.updateSharing(
                request.visibility(), responsibleMemberId, clock.instant());
        commitmentRepository.saveAndFlush(commitment);
        auditService.record(
                owner.id(),
                ActorRole.USER,
                Action.COMMITMENT_SHARING_CHANGED,
                ResourceType.RECURRING_COMMITMENT,
                commitment.id());
        return toResponse(
                commitment,
                merchantService.findReference(commitment.merchantId()).orElse(null),
                true);
    }

    @Transactional
    public OccurrenceListResponse occurrences(
            Jwt jwt, UUID commitmentId, LocalDate from, LocalDate to) {
        OccurrenceReconciliationService.validateRange(from, to);
        CurrentUser user = currentUserService.resolve(jwt);
        CommitmentEntity commitment = requireVisible(user.id(), commitmentId);
        ActiveHouseholdAccess access =
                membershipService.requireConsentedReadAccess(
                        commitment.householdId(), user.id());
        if (access.owner()) {
            CommitmentEntity locked =
                    requireOwnedForUpdate(user.id(), commitmentId);
            reconciliationService.ensureRange(
                    locked, access.timezone(), from, to);
        }
        List<OccurrenceResponse> items =
                occurrenceRepository
                        .findVisibleForCommitment(user.id(), commitmentId, from, to)
                        .stream()
                        .map(CommitmentService::toOccurrence)
                        .toList();
        return new OccurrenceListResponse(from, to, items);
    }

    @Transactional
    public UpcomingListResponse upcoming(
            Jwt jwt, UUID householdId, LocalDate requestedFrom, LocalDate requestedTo) {
        CurrentUser user = currentUserService.resolve(jwt);
        ActiveHouseholdAccess access =
                membershipService.requireConsentedReadAccess(householdId, user.id());
        LocalDate today = reconciliationService.localToday(access.timezone());
        LocalDate from = requestedFrom == null ? today : requestedFrom;
        OccurrenceReconciliationService.validateDate(from);
        LocalDate to =
                requestedTo == null
                        ? from.plusDays(
                                OccurrenceReconciliationService.MINIMUM_HORIZON_DAYS)
                        : requestedTo;
        OccurrenceReconciliationService.validateRange(from, to);

        List<CommitmentEntity> commitments;
        if (access.owner()) {
            commitments =
                    commitmentRepository.findOwnedActiveForUpdate(
                            user.id(), householdId);
            for (CommitmentEntity commitment : commitments) {
                reconciliationService.ensureRange(
                        commitment, access.timezone(), from, to);
            }
        } else {
            commitments =
                    commitmentRepository.findVisibleActive(user.id(), householdId);
        }
        Map<UUID, CommitmentEntity> byId =
                commitments.stream()
                        .collect(Collectors.toMap(CommitmentEntity::id, Function.identity()));
        List<UpcomingItemResponse> items =
                occurrenceRepository
                        .findVisibleUpcoming(user.id(), householdId, from, to)
                        .stream()
                        .map(
                                occurrence ->
                                        toUpcoming(
                                                occurrence,
                                                byId.get(occurrence.commitmentId()),
                                                access.owner()))
                        .toList();
        return new UpcomingListResponse(householdId, from, to, items);
    }

    @Transactional(readOnly = true)
    public OwnedCommitmentProjections requireOwnedActive(
            Jwt jwt, UUID householdId) {
        CurrentUser owner = currentUserService.resolve(jwt);
        OwnedHousehold household =
                householdAccessService.requireOwned(householdId, owner.id());
        return new OwnedCommitmentProjections(
                owner.id(),
                household,
                commitmentRepository.findOwnedActive(owner.id(), householdId).stream()
                        .map(CommitmentService::toProjection)
                        .toList());
    }

    @Transactional(readOnly = true)
    public OwnedCommitmentProjections requireVisibleActive(
            Jwt jwt, UUID householdId) {
        CurrentUser user = currentUserService.resolve(jwt);
        ActiveHouseholdAccess access =
                membershipService.requireConsentedReadAccess(householdId, user.id());
        return new OwnedCommitmentProjections(
                user.id(),
                new OwnedHousehold(
                        access.householdId(),
                        access.ownerUserId(),
                        access.defaultCurrency(),
                        access.timezone()),
                commitmentRepository.findVisibleActive(user.id(), householdId).stream()
                        .map(CommitmentService::toProjection)
                        .toList());
    }

    private CommitmentEntity requireOwned(UUID ownerId, UUID commitmentId) {
        return commitmentRepository
                .findOwnedById(ownerId, commitmentId)
                .orElseThrow(ResourceNotFoundException::new);
    }

    private CommitmentEntity requireVisible(UUID userId, UUID commitmentId) {
        return commitmentRepository
                .findVisibleById(userId, commitmentId)
                .orElseThrow(ResourceNotFoundException::new);
    }

    private CommitmentEntity requireOwnedForUpdate(
            UUID ownerId, UUID commitmentId) {
        return commitmentRepository
                .findOwnedByIdForUpdate(ownerId, commitmentId)
                .orElseThrow(ResourceNotFoundException::new);
    }

    private CommitmentEntity requireOwnedMutableForUpdate(
            UUID ownerId, UUID commitmentId) {
        CommitmentEntity commitment =
                requireOwnedForUpdate(ownerId, commitmentId);
        if (commitment.status() == CommitmentStatus.ARCHIVED) {
            throw new ResourceNotFoundException();
        }
        return commitment;
    }

    private MerchantReference compatibleMerchant(
            UUID merchantId, CommitmentCategory category) {
        return merchantId == null
                ? null
                : merchantService.requireCompatible(merchantId, category);
    }

    private static void verifyVersion(
            CommitmentEntity commitment, long expectedVersion) {
        if (expectedVersion < 0) {
            throw new MalformedPreconditionException();
        }
        if (commitment.version() != expectedVersion) {
            throw new PreconditionFailedException();
        }
    }

    private static CommitmentResponse toResponse(
            CommitmentEntity commitment,
            MerchantReference merchant,
            boolean canManage) {
        return new CommitmentResponse(
                commitment.id(),
                commitment.householdId(),
                commitment.dataOwnerUserId(),
                commitment.responsibleMemberId(),
                commitment.merchantId(),
                merchant == null ? null : merchant.canonicalName(),
                commitment.displayName(),
                commitment.category(),
                commitment.paymentRail(),
                commitment.amountMinor(),
                commitment.estimatedAmountMinor(),
                commitment.currency(),
                commitment.frequency(),
                commitment.intervalCount(),
                commitment.customIntervalUnit(),
                commitment.anchorDate(),
                commitment.monthDayPolicy(),
                commitment.nextDueDate(),
                commitment.variableAmount(),
                commitment.maskedPaymentLabel(),
                commitment.source(),
                commitment.sourceConfidence(),
                commitment.visibility(),
                commitment.status(),
                commitment.version(),
                canManage,
                ReviewActionPolicy.forCategory(commitment.category()),
                commitment.createdAt(),
                commitment.updatedAt());
    }

    private static OccurrenceResponse toOccurrence(
            CommitmentOccurrenceEntity occurrence) {
        return new OccurrenceResponse(
                occurrence.id(),
                occurrence.commitmentId(),
                occurrence.scheduledDate(),
                occurrence.expectedAmountMinor(),
                occurrence.currency(),
                occurrence.amountKind(),
                occurrence.state());
    }

    static UpcomingItemResponse toUpcoming(
            CommitmentOccurrenceEntity occurrence,
            CommitmentEntity commitment,
            boolean canManage) {
        if (commitment == null) {
            throw new IllegalStateException("Occurrence has no owned commitment.");
        }
        return new UpcomingItemResponse(
                occurrence.id(),
                commitment.id(),
                commitment.displayName(),
                commitment.category(),
                commitment.paymentRail(),
                occurrence.scheduledDate(),
                occurrence.expectedAmountMinor(),
                occurrence.currency(),
                occurrence.amountKind(),
                commitment.maskedPaymentLabel(),
                canManage,
                ReviewActionPolicy.forCategory(commitment.category()));
    }

    private static CommitmentProjection toProjection(
            CommitmentEntity commitment) {
        return new CommitmentProjection(
                commitment.id(),
                commitment.displayName(),
                commitment.category(),
                commitment.paymentRail(),
                commitment.amountMinor(),
                commitment.estimatedAmountMinor(),
                commitment.currency(),
                CommitmentRules.recurrenceRule(commitment),
                commitment.variableAmount(),
                commitment.maskedPaymentLabel());
    }

    private static String encodePage(int pageIndex, int limit) {
        String plain = CURSOR_PREFIX + ":" + pageIndex + ":" + limit;
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(plain.getBytes(StandardCharsets.UTF_8));
    }

    private static int decodePage(String cursor, int limit) {
        if (cursor == null || cursor.isBlank()) {
            return 0;
        }
        if (cursor.length() > 200 || !cursor.matches("^[A-Za-z0-9_-]+$")) {
            throw new ValidationException("cursor is invalid.");
        }
        try {
            String plain =
                    new String(
                            Base64.getUrlDecoder().decode(cursor),
                            StandardCharsets.UTF_8);
            String[] parts = plain.split(":", -1);
            if (parts.length != 3
                    || !CURSOR_PREFIX.equals(parts[0])
                    || Integer.parseInt(parts[2]) != limit) {
                throw new IllegalArgumentException();
            }
            int page = Integer.parseInt(parts[1]);
            if (page < 1 || page > MAXIMUM_PAGE_INDEX) {
                throw new IllegalArgumentException();
            }
            return page;
        } catch (IllegalArgumentException exception) {
            throw new ValidationException(
                    "cursor is invalid or was issued for a different limit.");
        }
    }

}
