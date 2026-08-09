package in.autopayguard.api.commitment;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CommitmentOccurrenceRepository
        extends JpaRepository<CommitmentOccurrenceEntity, UUID> {

    @Query(
            value =
                    """
                    SELECT o.*
                    FROM commitment_occurrences o
                    JOIN recurring_commitments c ON c.id = o.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :userId
                     AND m.status = 'ACTIVE'
                    WHERE c.id = :commitmentId
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                      AND o.scheduled_date BETWEEN :from AND :to
                    ORDER BY o.scheduled_date ASC, o.id ASC
                    """,
            nativeQuery = true)
    List<CommitmentOccurrenceEntity> findVisibleForCommitment(
            @Param("userId") UUID userId,
            @Param("commitmentId") UUID commitmentId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Query(
            value =
                    """
                    SELECT o.*
                    FROM commitment_occurrences o
                    JOIN recurring_commitments c ON c.id = o.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :userId
                     AND m.status = 'ACTIVE'
                    WHERE c.household_id = :householdId
                      AND c.status = 'ACTIVE'
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                      AND o.scheduled_date BETWEEN :from AND :to
                    ORDER BY o.scheduled_date ASC, o.id ASC
                    """,
            nativeQuery = true)
    List<CommitmentOccurrenceEntity> findVisibleUpcoming(
            @Param("userId") UUID userId,
            @Param("householdId") UUID householdId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Query(
            """
            select o
            from CommitmentOccurrenceEntity o, CommitmentEntity c, HouseholdEntity h
            where c.id = o.commitmentId
              and h.id = c.householdId
              and h.ownerUserId = :ownerUserId
              and o.id = :occurrenceId
            """)
    Optional<CommitmentOccurrenceEntity> findOwnedById(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("occurrenceId") UUID occurrenceId);

    @Query(
            """
            select o.scheduledDate
            from CommitmentOccurrenceEntity o
            where o.commitmentId = :commitmentId
              and o.scheduledDate between :from and :to
            """)
    Set<LocalDate> findScheduledDates(
            @Param("commitmentId") UUID commitmentId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Modifying
    @Query(
            """
            delete from CommitmentOccurrenceEntity o
            where o.commitmentId = :commitmentId
              and o.state = in.autopayguard.api.commitment.OccurrenceState.UPCOMING
              and o.scheduledDate >= :from
            """)
    int deleteFutureUpcoming(
            @Param("commitmentId") UUID commitmentId, @Param("from") LocalDate from);

    @Query(
            """
            select o
            from CommitmentOccurrenceEntity o, CommitmentEntity c, HouseholdEntity h
            where c.id = o.commitmentId
              and h.id = c.householdId
              and h.ownerUserId = :ownerUserId
              and c.id = :commitmentId
              and o.scheduledDate between :from and :to
            order by o.scheduledDate asc, o.id asc
            """)
    List<CommitmentOccurrenceEntity> findOwnedForCommitment(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("commitmentId") UUID commitmentId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Query(
            """
            select o
            from CommitmentOccurrenceEntity o, CommitmentEntity c, HouseholdEntity h
            where c.id = o.commitmentId
              and h.id = c.householdId
              and h.ownerUserId = :ownerUserId
              and c.householdId = :householdId
              and c.status = in.autopayguard.api.commitment.CommitmentStatus.ACTIVE
              and o.scheduledDate between :from and :to
            order by o.scheduledDate asc, o.id asc
            """)
    List<CommitmentOccurrenceEntity> findOwnedUpcoming(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);
}
