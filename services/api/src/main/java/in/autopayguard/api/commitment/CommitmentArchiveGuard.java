package in.autopayguard.api.commitment;

import java.util.UUID;

public interface CommitmentArchiveGuard {

    void requireArchivable(UUID commitmentId);
}
