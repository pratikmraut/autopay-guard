package in.autopayguard.api.cancellation;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface OccurrenceDecisionRepository extends JpaRepository<OccurrenceDecisionEntity, UUID> {

    Optional<OccurrenceDecisionEntity> findByIdAndOwnerUserId(UUID id, UUID ownerUserId);

    Optional<OccurrenceDecisionEntity>
            findFirstByOwnerUserIdAndOccurrenceIdOrderBySequenceNumberDesc(
                    UUID ownerUserId, UUID occurrenceId);

    Optional<OccurrenceDecisionEntity>
            findFirstByOccurrenceIdOrderBySequenceNumberDesc(UUID occurrenceId);

    @Query(
            """
            select coalesce(max(d.sequenceNumber), 0)
            from OccurrenceDecisionEntity d
            where d.commitmentId = :commitmentId
              and d.scheduledDate = :scheduledDate
            """)
    int maximumSequence(
            @Param("commitmentId") UUID commitmentId,
            @Param("scheduledDate") LocalDate scheduledDate);
}
