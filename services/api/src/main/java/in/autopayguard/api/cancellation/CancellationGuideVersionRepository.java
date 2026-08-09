package in.autopayguard.api.cancellation;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface CancellationGuideVersionRepository
        extends JpaRepository<CancellationGuideVersionEntity, GuideVersionId> {

    Optional<CancellationGuideVersionEntity>
            findFirstByGuideIdAndStatusOrderByVersionDesc(UUID guideId, GuideStatus status);

    @Query(
            value =
                    """
                    SELECT v.*
                    FROM cancellation_guide_versions v
                    JOIN cancellation_guide_catalog_state s
                      ON s.guide_id = v.guide_id
                     AND s.current_published_version = v.version
                    WHERE v.guide_id = :guideId
                      AND s.state = 'ACTIVE'
                      AND v.status = 'PUBLISHED'
                    """,
            nativeQuery = true)
    Optional<CancellationGuideVersionEntity> findCurrentPublished(UUID guideId);
}
