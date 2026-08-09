package in.autopayguard.api.identity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "users")
class UserEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "oidc_subject", nullable = false, unique = true, length = 255, updatable = false)
    private String oidcSubject;

    @Column(name = "email", nullable = false, length = 320)
    private String email;

    @Column(name = "display_name", nullable = false, length = 200)
    private String displayName;

    @Column(name = "timezone", nullable = false, length = 64)
    private String timezone;

    @Column(name = "locale", nullable = false, length = 35)
    private String locale;

    @Column(name = "age_confirmed_at")
    private Instant ageConfirmedAt;

    @Column(name = "privacy_notice_accepted_at")
    private Instant privacyNoticeAcceptedAt;

    @Column(name = "privacy_notice_version", length = 64)
    private String privacyNoticeVersion;

    @Column(name = "deletion_protected", nullable = false)
    private boolean deletionProtected;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected UserEntity() {}

    private UserEntity(
            UUID id,
            String oidcSubject,
            String email,
            String displayName,
            String timezone,
            String locale,
            Instant now) {
        this.id = Objects.requireNonNull(id);
        this.oidcSubject = Objects.requireNonNull(oidcSubject);
        this.email = Objects.requireNonNull(email);
        this.displayName = Objects.requireNonNull(displayName);
        this.timezone = Objects.requireNonNull(timezone);
        this.locale = Objects.requireNonNull(locale);
        this.deletionProtected =
                "demo@autopayguard.local".equalsIgnoreCase(email);
        this.createdAt = Objects.requireNonNull(now);
        this.updatedAt = now;
    }

    static UserEntity create(
            String oidcSubject, String email, String displayName, Instant now) {
        return new UserEntity(
                UUID.randomUUID(),
                oidcSubject,
                email,
                displayName,
                "Asia/Kolkata",
                "en-IN",
                now);
    }

    boolean hasEmail(String normalizedEmail) {
        return email.equals(normalizedEmail);
    }

    void synchronizeDisplayName(String normalizedDisplayName, Instant now) {
        if (!displayName.equals(normalizedDisplayName)) {
            displayName = normalizedDisplayName;
            updatedAt = now;
        }
    }

    void confirmOnboarding(String acceptedNoticeVersion, Instant now) {
        boolean changed = false;
        if (ageConfirmedAt == null) {
            ageConfirmedAt = now;
            changed = true;
        }
        if (privacyNoticeAcceptedAt == null
                || !acceptedNoticeVersion.equals(privacyNoticeVersion)) {
            privacyNoticeAcceptedAt = now;
            privacyNoticeVersion = acceptedNoticeVersion;
            changed = true;
        }
        if (changed) {
            updatedAt = now;
        }
    }

    CurrentUser toCurrentUser() {
        return new CurrentUser(
                id,
                email,
                displayName,
                timezone,
                locale,
                ageConfirmedAt != null,
                privacyNoticeAcceptedAt != null,
                privacyNoticeVersion,
                createdAt);
    }
}
