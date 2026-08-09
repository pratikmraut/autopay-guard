package in.autopayguard.api.notification;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface NotificationRepository extends JpaRepository<NotificationEntity, UUID> {

    @Query(
            value =
                    """
                    select n
                    from NotificationEntity n
                    where n.recipientUserId = :ownerUserId
                      and n.householdId = :householdId
                    """,
            countQuery =
                    """
                    select count(n)
                    from NotificationEntity n
                    where n.recipientUserId = :ownerUserId
                      and n.householdId = :householdId
                    """)
    Page<NotificationEntity> findAllOwnedPage(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId,
            Pageable pageable);

    @Query(
            value =
                    """
                    SELECT n.*
                    FROM notifications n
                    JOIN recurring_commitments c ON c.id = n.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE n.recipient_user_id = :ownerUserId
                      AND n.household_id = :householdId
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    ORDER BY n.created_at DESC, n.id DESC
                    """,
            countQuery =
                    """
                    SELECT COUNT(*)
                    FROM notifications n
                    JOIN recurring_commitments c ON c.id = n.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE n.recipient_user_id = :ownerUserId
                      AND n.household_id = :householdId
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    """,
            nativeQuery = true)
    Page<NotificationEntity> findAllVisiblePage(
            @Param("callerUserId") UUID callerUserId,
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId,
            Pageable pageable);

    @Query(
            value =
                    """
                    select n
                    from NotificationEntity n, NotificationDeliveryEntity d
                    where d.notificationId = n.id
                      and n.recipientUserId = :ownerUserId
                      and n.householdId = :householdId
                      and n.readAt is null
                      and d.status = :status
                    """,
            countQuery =
                    """
                    select count(n)
                    from NotificationEntity n, NotificationDeliveryEntity d
                    where d.notificationId = n.id
                      and n.recipientUserId = :ownerUserId
                      and n.householdId = :householdId
                      and n.readAt is null
                      and d.status = :status
                    """)
    Page<NotificationEntity> findUnreadOwnedPage(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId,
            @Param("status") NotificationStatus status,
            Pageable pageable);

    @Query(
            value =
                    """
                    SELECT n.*
                    FROM notifications n
                    JOIN notification_deliveries d ON d.notification_id = n.id
                    JOIN recurring_commitments c ON c.id = n.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE n.recipient_user_id = :ownerUserId
                      AND n.household_id = :householdId
                      AND n.read_at IS NULL
                      AND d.status = 'DELIVERED'
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    ORDER BY n.created_at DESC, n.id DESC
                    """,
            countQuery =
                    """
                    SELECT COUNT(*)
                    FROM notifications n
                    JOIN notification_deliveries d ON d.notification_id = n.id
                    JOIN recurring_commitments c ON c.id = n.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE n.recipient_user_id = :ownerUserId
                      AND n.household_id = :householdId
                      AND n.read_at IS NULL
                      AND d.status = 'DELIVERED'
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    """,
            nativeQuery = true)
    Page<NotificationEntity> findUnreadVisiblePage(
            @Param("callerUserId") UUID callerUserId,
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId,
            Pageable pageable);

    @Query(
            value =
                    """
                    select n
                    from NotificationEntity n, NotificationDeliveryEntity d
                    where d.notificationId = n.id
                      and n.recipientUserId = :ownerUserId
                      and n.householdId = :householdId
                      and d.status = :status
                    """,
            countQuery =
                    """
                    select count(n)
                    from NotificationEntity n, NotificationDeliveryEntity d
                    where d.notificationId = n.id
                      and n.recipientUserId = :ownerUserId
                      and n.householdId = :householdId
                      and d.status = :status
                    """)
    Page<NotificationEntity> findFailedOwnedPage(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId,
            @Param("status") NotificationStatus status,
            Pageable pageable);

    @Query(
            value =
                    """
                    SELECT n.*
                    FROM notifications n
                    JOIN notification_deliveries d ON d.notification_id = n.id
                    JOIN recurring_commitments c ON c.id = n.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE n.recipient_user_id = :ownerUserId
                      AND n.household_id = :householdId
                      AND d.status = 'DEAD'
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    ORDER BY n.created_at DESC, n.id DESC
                    """,
            countQuery =
                    """
                    SELECT COUNT(*)
                    FROM notifications n
                    JOIN notification_deliveries d ON d.notification_id = n.id
                    JOIN recurring_commitments c ON c.id = n.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE n.recipient_user_id = :ownerUserId
                      AND n.household_id = :householdId
                      AND d.status = 'DEAD'
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    """,
            nativeQuery = true)
    Page<NotificationEntity> findFailedVisiblePage(
            @Param("callerUserId") UUID callerUserId,
            @Param("ownerUserId") UUID ownerUserId,
            @Param("householdId") UUID householdId,
            Pageable pageable);

    @Query(
            """
            select n
            from NotificationEntity n
            where n.id = :notificationId
              and n.recipientUserId = :ownerUserId
            """)
    Optional<NotificationEntity> findOwnedById(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("notificationId") UUID notificationId);

    @Query(
            value =
                    """
                    SELECT n.*
                    FROM notifications n
                    JOIN recurring_commitments c ON c.id = n.commitment_id
                    JOIN household_members m
                      ON m.household_id = c.household_id
                     AND m.user_id = :callerUserId
                     AND m.status = 'ACTIVE'
                    WHERE n.id = :notificationId
                      AND n.recipient_user_id = c.data_owner_user_id
                      AND (m.role = 'OWNER' OR c.visibility = 'HOUSEHOLD')
                    """,
            nativeQuery = true)
    Optional<NotificationEntity> findVisibleById(
            @Param("callerUserId") UUID callerUserId,
            @Param("notificationId") UUID notificationId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            """
            select n
            from NotificationEntity n
            where n.id = :notificationId
              and n.recipientUserId = :ownerUserId
            """)
    Optional<NotificationEntity> findOwnedByIdForUpdate(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("notificationId") UUID notificationId);

    Optional<NotificationEntity> findBySemanticKey(String semanticKey);
}
