package in.autopayguard.api.reminder;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ReminderRuleSetRepository extends JpaRepository<ReminderRuleSetEntity, UUID> {

    @Query(
            value = "SELECT id FROM households WHERE id = :householdId FOR UPDATE",
            nativeQuery = true)
    Object lockHousehold(@Param("householdId") UUID householdId);

    @Query(
            value =
                    "SELECT id FROM recurring_commitments "
                            + "WHERE id = :commitmentId "
                            + "AND household_id = :householdId "
                            + "AND status <> 'ARCHIVED' "
                            + "FOR UPDATE",
            nativeQuery = true)
    Optional<UUID> lockMutableCommitment(
            @Param("householdId") UUID householdId,
            @Param("commitmentId") UUID commitmentId);

    @Query(
            "select ruleSet from ReminderRuleSetEntity ruleSet "
                    + "where ruleSet.householdId = :householdId "
                    + "and ruleSet.scopeType = in.autopayguard.api.reminder.ReminderRuleScope.HOUSEHOLD")
    Optional<ReminderRuleSetEntity> findHousehold(@Param("householdId") UUID householdId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select ruleSet from ReminderRuleSetEntity ruleSet "
                    + "where ruleSet.householdId = :householdId "
                    + "and ruleSet.scopeType = in.autopayguard.api.reminder.ReminderRuleScope.HOUSEHOLD")
    Optional<ReminderRuleSetEntity> findHouseholdForUpdate(
            @Param("householdId") UUID householdId);

    @Query(
            "select ruleSet from ReminderRuleSetEntity ruleSet "
                    + "where ruleSet.commitmentId = :commitmentId "
                    + "and ruleSet.scopeType = in.autopayguard.api.reminder.ReminderRuleScope.COMMITMENT")
    Optional<ReminderRuleSetEntity> findCommitment(
            @Param("commitmentId") UUID commitmentId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select ruleSet from ReminderRuleSetEntity ruleSet "
                    + "where ruleSet.commitmentId = :commitmentId "
                    + "and ruleSet.scopeType = in.autopayguard.api.reminder.ReminderRuleScope.COMMITMENT")
    Optional<ReminderRuleSetEntity> findCommitmentForUpdate(
            @Param("commitmentId") UUID commitmentId);
}
