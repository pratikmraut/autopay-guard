package in.autopayguard.api.commitment;

import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.household.HouseholdMembershipService;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CancellationCommitmentAccessService {

    private final CommitmentRepository commitmentRepository;
    private final CommitmentOccurrenceRepository occurrenceRepository;
    private final HouseholdMembershipService householdMembershipService;

    CancellationCommitmentAccessService(
            CommitmentRepository commitmentRepository,
            CommitmentOccurrenceRepository occurrenceRepository,
            HouseholdMembershipService householdMembershipService) {
        this.commitmentRepository = commitmentRepository;
        this.occurrenceRepository = occurrenceRepository;
        this.householdMembershipService = householdMembershipService;
    }

    @Transactional(readOnly = true)
    public CancellationCommitmentSnapshot requireOwned(UUID ownerUserId, UUID commitmentId) {
        return commitmentRepository
                .findOwnedById(ownerUserId, commitmentId)
                .map(CancellationCommitmentAccessService::snapshot)
                .orElseThrow(ResourceNotFoundException::new);
    }

    @Transactional(readOnly = true)
    public CancellationCommitmentSnapshot requireVisible(
            UUID callerUserId, UUID commitmentId) {
        CommitmentEntity commitment =
                commitmentRepository
                        .findVisibleById(callerUserId, commitmentId)
                        .orElseThrow(ResourceNotFoundException::new);
        householdMembershipService.requireConsentedReadAccess(
                commitment.householdId(), callerUserId);
        return snapshot(commitment);
    }

    @Transactional
    public CancellationCommitmentSnapshot lockOwned(UUID ownerUserId, UUID commitmentId) {
        return commitmentRepository
                .findOwnedByIdForUpdate(ownerUserId, commitmentId)
                .map(CancellationCommitmentAccessService::snapshot)
                .orElseThrow(ResourceNotFoundException::new);
    }

    @Transactional
    public CancellationOccurrenceSnapshot lockOwnedOccurrence(
            UUID ownerUserId, UUID occurrenceId) {
        CommitmentOccurrenceEntity initial =
                occurrenceRepository
                        .findOwnedById(ownerUserId, occurrenceId)
                        .orElseThrow(ResourceNotFoundException::new);
        CommitmentEntity commitment =
                commitmentRepository
                        .findOwnedByIdForUpdate(ownerUserId, initial.commitmentId())
                        .orElseThrow(ResourceNotFoundException::new);
        CommitmentOccurrenceEntity occurrence =
                occurrenceRepository
                        .findOwnedById(ownerUserId, occurrenceId)
                        .orElseThrow(ResourceNotFoundException::new);
        if (!occurrence.commitmentId().equals(commitment.id())) {
            throw new ResourceNotFoundException();
        }
        return new CancellationOccurrenceSnapshot(
                occurrence.id(),
                occurrence.scheduledDate(),
                occurrence.expectedAmountMinor(),
                occurrence.currency(),
                occurrence.amountKind(),
                snapshot(commitment));
    }

    private static CancellationCommitmentSnapshot snapshot(CommitmentEntity commitment) {
        return new CancellationCommitmentSnapshot(
                commitment.id(),
                commitment.householdId(),
                commitment.merchantId(),
                commitment.displayName(),
                commitment.category(),
                commitment.paymentRail(),
                commitment.amountMinor(),
                commitment.estimatedAmountMinor(),
                commitment.currency(),
                CommitmentRules.recurrenceRule(commitment),
                commitment.variableAmount(),
                commitment.status(),
                commitment.version());
    }
}
