package in.autopayguard.api.reminder;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ReminderRuleRepository extends JpaRepository<ReminderRuleEntity, UUID> {

    List<ReminderRuleEntity> findByRuleSetId(UUID ruleSetId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from ReminderRuleEntity rule where rule.ruleSetId = :ruleSetId")
    int deleteForRuleSet(@Param("ruleSetId") UUID ruleSetId);
}
