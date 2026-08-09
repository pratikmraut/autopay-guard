package in.autopayguard.api.cancellation;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CancellationAttemptRepository
        extends JpaRepository<CancellationAttemptEntity, UUID> {

    Optional<CancellationAttemptEntity> findByIdAndOwnerUserId(
            UUID id, UUID ownerUserId);

    @Query(
            value =
                    """
                    SELECT a.*
                    FROM cancellation_attempts a
                    JOIN recurring_commitments c ON c.id = a.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE a.id = :attemptId
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    """,
            nativeQuery = true)
    Optional<CancellationAttemptEntity> findVisibleById(
            @Param("callerUserId") UUID callerUserId,
            @Param("attemptId") UUID attemptId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            """
            select a
            from CancellationAttemptEntity a
            where a.id = :id and a.ownerUserId = :ownerUserId
            """)
    Optional<CancellationAttemptEntity> findOwnedByIdForUpdate(
            @Param("id") UUID id, @Param("ownerUserId") UUID ownerUserId);

    Page<CancellationAttemptEntity>
            findByOwnerUserIdAndHouseholdIdAndCommitmentId(
                    UUID ownerUserId,
                    UUID householdId,
                    UUID commitmentId,
                    Pageable pageable);

    Page<CancellationAttemptEntity> findByHouseholdIdAndCommitmentId(
            UUID householdId, UUID commitmentId, Pageable pageable);

    List<CancellationAttemptEntity> findByOwnerUserIdAndHouseholdId(
            UUID ownerUserId, UUID householdId);

    @Query(
            value =
                    """
                    SELECT a.*
                    FROM cancellation_attempts a
                    JOIN recurring_commitments c ON c.id = a.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE a.household_id = :householdId
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    ORDER BY a.updated_at DESC, a.id DESC
                    """,
            nativeQuery = true)
    List<CancellationAttemptEntity> findVisibleByCallerAndHousehold(
            @Param("callerUserId") UUID callerUserId,
            @Param("householdId") UUID householdId);

    boolean existsByCommitmentIdAndUnresolvedKeyIsNotNull(UUID commitmentId);
}
