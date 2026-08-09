package in.autopayguard.api.cancellation;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface CancellationGuideStepRepository
        extends JpaRepository<CancellationGuideStepEntity, GuideStepId> {

    List<CancellationGuideStepEntity>
            findByGuideIdAndGuideVersionOrderByTrackAscSequenceNumberAsc(
                    UUID guideId, int guideVersion);
}
