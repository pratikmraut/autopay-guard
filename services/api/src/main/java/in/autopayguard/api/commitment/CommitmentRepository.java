package in.autopayguard.api.commitment;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CommitmentRepository extends JpaRepository<CommitmentEntity, UUID> {

    @Query(
            value =
                    """
                    SELECT c.*
                    FROM recurring_commitments c
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :userId
                     AND m.status = 'ACTIVE'
                    WHERE c.household_id = :householdId
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                      AND (:includeArchived = TRUE OR c.status <> 'ARCHIVED')
                    ORDER BY c.created_at DESC, c.id DESC
                    """,
            countQuery =
                    """
                    SELECT COUNT(*)
                    FROM recurring_commitments c
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :userId
                     AND m.status = 'ACTIVE'
                    WHERE c.household_id = :householdId
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                      AND (:includeArchived = TRUE OR c.status <> 'ARCHIVED')
                    """,
            nativeQuery = true)
    Page<CommitmentEntity> findVisiblePage(
            @Param("userId") UUID userId,
            @Param("householdId") UUID householdId,
            @Param("includeArchived") boolean includeArchived,
            Pageable pageable);

    @Query(
            value =
                    """
                    SELECT c.*
                    FROM recurring_commitments c
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :userId
                     AND m.status = 'ACTIVE'
                    WHERE c.id = :commitmentId
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    """,
            nativeQuery = true)
    Optional<CommitmentEntity> findVisibleById(
            @Param("userId") UUID userId,
            @Param("commitmentId") UUID commitmentId);

    @Query(
            value =
                    """
                    SELECT c.*
                    FROM recurring_commitments c
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :userId
                     AND m.status = 'ACTIVE'
                    WHERE c.household_id = :householdId
                      AND c.status = 'ACTIVE'
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    ORDER BY c.created_at ASC, c.id ASC
                    """,
            nativeQuery = true)
    List<CommitmentEntity> findVisibleActive(
            @Param("userId") UUID userId,
            @Param("householdId") UUID householdId);

    @Query(
            value =
                    """
                    select c
                    from CommitmentEntity c, HouseholdEntity h
                    where h.id = c.householdId
                      and h.ownerUserId = :ownerUserId
                      and c.householdId = :householdId
                      and (:includeArchived = true or c.status <> in.autopayguard.api.commitment.CommitmentStatus.ARCHIVED)
                    """,
            countQuery =
                    """
                    select count(c)
                    from CommitmentEntity c, HouseholdEntity h
                    where h.id = c.householdId
                      and h.ownerUserId = :ownerUserId
                      and c.householdId = :householdId
                      and (:includeArchived = true or c.status <> in.autopayguard.api.commitment.CommitmentStatus.ARCHIVED)
                    """)
    Page<CommitmentEntity> findOwnedPage(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId,
            @Param("includeArchived") boolean includeArchived,
            Pageable pageable);

    @Query(
            """
            select c
            from CommitmentEntity c, HouseholdEntity h
            where h.id = c.householdId
              and h.ownerUserId = :ownerUserId
              and c.id = :commitmentId
            """)
    Optional<CommitmentEntity> findOwnedById(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("commitmentId") UUID commitmentId);

    @Query(
            """
            select c.householdId
            from CommitmentEntity c, HouseholdEntity h
            where h.id = c.householdId
              and h.ownerUserId = :ownerUserId
              and c.id = :commitmentId
            """)
    Optional<UUID> findOwnedHouseholdId(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("commitmentId") UUID commitmentId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            """
            select c
            from CommitmentEntity c, HouseholdEntity h
            where h.id = c.householdId
              and h.ownerUserId = :ownerUserId
              and c.id = :commitmentId
            """)
    Optional<CommitmentEntity> findOwnedByIdForUpdate(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("commitmentId") UUID commitmentId);

    @Query(
            """
            select c
            from CommitmentEntity c, HouseholdEntity h
            where h.id = c.householdId
              and h.ownerUserId = :ownerUserId
              and c.householdId = :householdId
              and c.status = in.autopayguard.api.commitment.CommitmentStatus.ACTIVE
            order by c.createdAt asc, c.id asc
            """)
    List<CommitmentEntity> findOwnedActive(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            """
            select c
            from CommitmentEntity c, HouseholdEntity h
            where h.id = c.householdId
              and h.ownerUserId = :ownerUserId
              and c.householdId = :householdId
              and c.status = in.autopayguard.api.commitment.CommitmentStatus.ACTIVE
            order by c.createdAt asc, c.id asc
            """)
    List<CommitmentEntity> findOwnedActiveForUpdate(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            """
            select c
            from CommitmentEntity c
            where c.status = in.autopayguard.api.commitment.CommitmentStatus.ACTIVE
            order by c.id asc
            """)
    List<CommitmentEntity> findActiveForReconciliation();
}
