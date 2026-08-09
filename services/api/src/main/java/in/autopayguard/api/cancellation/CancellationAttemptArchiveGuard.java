package in.autopayguard.api.cancellation;

import in.autopayguard.api.commitment.CommitmentArchiveGuard;
import in.autopayguard.api.common.error.RequestConflictException;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class CancellationAttemptArchiveGuard implements CommitmentArchiveGuard {

    private final CancellationAttemptRepository repository;

    CancellationAttemptArchiveGuard(CancellationAttemptRepository repository) {
        this.repository = repository;
    }

    @Override
    public void requireArchivable(UUID commitmentId) {
        if (repository.existsByCommitmentIdAndUnresolvedKeyIsNotNull(commitmentId)) {
            throw new RequestConflictException(
                    "Resolve or abandon the active cancellation attempt before archiving.");
        }
    }
}
