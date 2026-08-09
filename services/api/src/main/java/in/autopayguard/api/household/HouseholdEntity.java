package in.autopayguard.api.household;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "households")
class HouseholdEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    @Column(name = "owner_user_id", nullable = false, updatable = false)
    private UUID ownerUserId;

    @Column(name = "default_currency", nullable = false, length = 3)
    private String defaultCurrency;

    @Column(name = "timezone", nullable = false, length = 64)
    private String timezone;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected HouseholdEntity() {}

    private HouseholdEntity(
            UUID id,
            String name,
            UUID ownerUserId,
            String defaultCurrency,
            String timezone,
            Instant now) {
        this.id = Objects.requireNonNull(id);
        this.name = Objects.requireNonNull(name);
        this.ownerUserId = Objects.requireNonNull(ownerUserId);
        this.defaultCurrency = Objects.requireNonNull(defaultCurrency);
        this.timezone = Objects.requireNonNull(timezone);
        this.createdAt = Objects.requireNonNull(now);
        this.updatedAt = now;
    }

    static HouseholdEntity create(
            String name,
            UUID ownerUserId,
            String defaultCurrency,
            String timezone,
            Instant now) {
        return new HouseholdEntity(
                UUID.randomUUID(), name, ownerUserId, defaultCurrency, timezone, now);
    }

    HouseholdResponse toResponse(HouseholdMemberRole accessRole) {
        return new HouseholdResponse(
                id,
                name,
                ownerUserId,
                defaultCurrency,
                timezone,
                createdAt,
                updatedAt,
                accessRole,
                accessRole == HouseholdMemberRole.OWNER);
    }

    OwnedHousehold toOwnedHousehold() {
        return new OwnedHousehold(id, ownerUserId, defaultCurrency, timezone);
    }

    UUID id() {
        return id;
    }
}
