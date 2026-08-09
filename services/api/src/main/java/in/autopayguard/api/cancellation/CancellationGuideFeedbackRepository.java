package in.autopayguard.api.cancellation;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface CancellationGuideFeedbackRepository
        extends JpaRepository<CancellationGuideFeedbackEntity, UUID> {

    boolean existsByOwnerUserIdAndCommitmentIdAndGuideIdAndGuideVersionAndOutcome(
            UUID ownerUserId,
            UUID commitmentId,
            UUID guideId,
            int guideVersion,
            GuideFeedbackOutcome outcome);
}
