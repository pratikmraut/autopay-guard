package in.autopayguard.api.reminder;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "reminder_rule_sets")
class ReminderRuleSetEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "household_id", nullable = false, updatable = false)
    private UUID householdId;

    @Column(name = "commitment_id", updatable = false)
    private UUID commitmentId;

    @Enumerated(EnumType.STRING)
    @Column(name = "scope_type", nullable = false, length = 16, updatable = false)
    private ReminderRuleScope scopeType;

    @Column(name = "scope_reference_id", nullable = false, updatable = false)
    private UUID scopeReferenceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "mode", nullable = false, length = 16)
    private ReminderRuleMode mode;

    @Column(name = "activated_at", nullable = false)
    private Instant activatedAt;

    @Column(name = "optimistic_version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected ReminderRuleSetEntity() {}

    private ReminderRuleSetEntity(
            UUID householdId,
            UUID commitmentId,
            ReminderRuleScope scopeType,
            UUID scopeReferenceId,
            ReminderRuleMode mode,
            Instant now) {
        this.id = UUID.randomUUID();
        this.householdId = Objects.requireNonNull(householdId);
        this.commitmentId = commitmentId;
        this.scopeType = Objects.requireNonNull(scopeType);
        this.scopeReferenceId = Objects.requireNonNull(scopeReferenceId);
        this.mode = Objects.requireNonNull(mode);
        this.activatedAt = Objects.requireNonNull(now);
        this.version = 1;
        this.createdAt = now;
        this.updatedAt = now;
    }

    static ReminderRuleSetEntity forHousehold(
            UUID householdId, ReminderRuleMode mode, Instant now) {
        return new ReminderRuleSetEntity(
                householdId,
                null,
                ReminderRuleScope.HOUSEHOLD,
                householdId,
                mode,
                now);
    }

    static ReminderRuleSetEntity forCommitment(
            UUID householdId,
            UUID commitmentId,
            ReminderRuleMode mode,
            Instant now) {
        return new ReminderRuleSetEntity(
                householdId,
                commitmentId,
                ReminderRuleScope.COMMITMENT,
                commitmentId,
                mode,
                now);
    }

    void update(ReminderRuleMode newMode, Instant now) {
        mode = Objects.requireNonNull(newMode);
        activatedAt = Objects.requireNonNull(now);
        updatedAt = now;
        version++;
    }

    UUID id() {
        return id;
    }

    UUID householdId() {
        return householdId;
    }

    UUID commitmentId() {
        return commitmentId;
    }

    ReminderRuleScope scopeType() {
        return scopeType;
    }

    ReminderRuleMode mode() {
        return mode;
    }

    Instant activatedAt() {
        return activatedAt;
    }

    long version() {
        return version;
    }

    Instant updatedAt() {
        return updatedAt;
    }
}
