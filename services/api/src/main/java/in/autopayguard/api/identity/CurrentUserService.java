package in.autopayguard.api.identity;

import in.autopayguard.api.common.error.AccountEnrollmentRequiredException;
import in.autopayguard.api.common.error.IdentityClaimsException;
import in.autopayguard.api.common.error.LocalUserNotProvisionedException;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.security.OpaqueCodes;
import in.autopayguard.api.common.security.SecurityProperties;
import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CurrentUserService {

    private static final int SUBJECT_MAX_LENGTH = 255;
    private static final int EMAIL_MAX_LENGTH = 320;
    private static final int DISPLAY_NAME_MAX_LENGTH = 200;
    private static final Pattern SAFE_EMAIL =
            Pattern.compile("^[^\\s@\\p{Cntrl}]+@[^\\s@\\p{Cntrl}]+$");
    private static final Pattern CONTROL_CHARACTER = Pattern.compile("\\p{Cntrl}");
    private static final String TOMBSTONE_DOMAIN =
            "autopay-guard/deletion-tombstone/v1:";
    private static final String LOCAL_ISSUER =
            "http://localhost:8081/realms/autopay-guard";
    private static final Map<String, String> RESERVED_LOCAL_IDENTITIES =
            Map.of(
                    "11111111-1111-4111-8111-111111111111", "demo@autopayguard.local",
                    "22222222-2222-4222-8222-222222222222", "member@autopayguard.local",
                    "33333333-3333-4333-8333-333333333333", "admin@autopayguard.local",
                    "44444444-4444-4444-8444-444444444444", "support@autopayguard.local",
                    "55555555-5555-4555-8555-555555555555", "foreign@autopayguard.local",
                    "66666666-6666-4666-8666-666666666666", "privacy-admin@autopayguard.local",
                    "77777777-7777-4777-8777-777777777777", "audit-reader@autopayguard.local",
                    "88888888-8888-4888-8888-888888888888", "deletion@autopayguard.local");

    private final UserRepository userRepository;
    private final Clock clock;
    private final IdentityProperties identityProperties;
    private final SecurityProperties securityProperties;

    CurrentUserService(
            UserRepository userRepository,
            Clock clock,
            IdentityProperties identityProperties,
            SecurityProperties securityProperties) {
        this.userRepository = userRepository;
        this.clock = clock;
        this.identityProperties = identityProperties;
        this.securityProperties = securityProperties;
    }

    @Transactional
    public CurrentUser resolve(Jwt jwt) {
        IdentityProfile profile = validatedProfile(jwt, false);
        rejectDeletedSubject(profile.subject());
        Instant now = clock.instant();
        UserEntity user =
                userRepository
                        .findByOidcSubject(profile.subject())
                        .orElseGet(() -> newLocalUser(jwt, profile, now));
        requireProvisionedIssuer(user, profile.issuer());
        requireProvisionedEmail(user, profile.email());
        user.synchronizeDisplayName(profile.displayName(), now);
        return userRepository.saveAndFlush(user).toCurrentUser();
    }

    @Transactional
    public CurrentUser resolveAndConfirmOnboarding(Jwt jwt, String privacyNoticeVersion) {
        IdentityProfile profile = validatedProfile(jwt, false);
        rejectDeletedSubject(profile.subject());
        Instant now = clock.instant();
        UserEntity user =
                userRepository
                        .findByOidcSubject(profile.subject())
                        .orElseGet(() -> newLocalUser(jwt, profile, now));
        requireProvisionedIssuer(user, profile.issuer());
        requireProvisionedEmail(user, profile.email());
        user.synchronizeDisplayName(profile.displayName(), now);
        user.confirmOnboarding(privacyNoticeVersion, now);
        return userRepository.saveAndFlush(user).toCurrentUser();
    }

    static void requireProvisionedEmail(UserEntity user, String normalizedEmail) {
        if (!user.hasEmail(normalizedEmail)) {
            throw new IdentityClaimsException(
                    "The authenticated identity email does not match the provisioned account.");
        }
    }

    void requireProvisionedIssuer(UserEntity user, String issuer) {
        if (!user.acceptsIssuer(issuer, identityProperties.legacyIssuerUri())) {
            throw new LocalUserNotProvisionedException();
        }
    }

    private UserEntity newLocalUser(Jwt jwt, IdentityProfile profile, Instant now) {
        rejectDeletedSubject(profile.subject());
        // The canonical local provider always uses explicit enrollment for new
        // identities. Closing signup must not reopen implicit GET provisioning.
        if ((identityProperties.selfRegistrationEnabled()
                        || LOCAL_ISSUER.equals(profile.issuer()))
                && !isReservedLocalFixture(profile)) {
            if (identityProperties.selfRegistrationEnabled()
                    && Boolean.TRUE.equals(jwt.getClaims().get("email_verified"))
                    && hasExactUserRole(jwt)
                    && !userRepository.existsByEmailIgnoreCase(profile.email())) {
                throw new AccountEnrollmentRequiredException();
            }
            throw new LocalUserNotProvisionedException();
        }
        if (!identityProperties.autoProvision()) {
            throw new LocalUserNotProvisionedException();
        }
        if (userRepository.existsByEmailIgnoreCase(profile.email())) {
            throw new RequestConflictException(
                    "This identity cannot create an application account.");
        }
        return UserEntity.createBound(
                profile.issuer(), profile.subject(), profile.email(), profile.displayName(), now);
    }

    void rejectDeletedSubject(String subject) {
        String subjectHash = OpaqueCodes.sha256(TOMBSTONE_DOMAIN + subject);
        if (userRepository.existsDeletionTombstoneBySubjectHash(subjectHash)) {
            throw new LocalUserNotProvisionedException();
        }
    }

    IdentityProfile validatedProfile(Jwt jwt, boolean enrollment) {
        String issuer = requiredStringClaim(jwt, "iss", 2048);
        if (!issuer.equals(securityProperties.issuerUri())
                || !issuer.equals(jwt.getClaims().get("iss"))) {
            throw new IdentityClaimsException(
                    "The authenticated identity contains an invalid issuer claim.");
        }
        String subject = requiredSubjectClaim(jwt);
        String email =
                requiredStringClaim(jwt, "email", EMAIL_MAX_LENGTH).toLowerCase(Locale.ROOT);
        if (!SAFE_EMAIL.matcher(email).matches()) {
            throw new IdentityClaimsException(
                    "The authenticated identity must contain a valid email claim.");
        }
        if ((enrollment || identityProperties.requireVerifiedEmail())
                && !Boolean.TRUE.equals(jwt.getClaims().get("email_verified"))) {
            throw new IdentityClaimsException(
                    "The authenticated identity must contain a verified email claim.");
        }

        String displayName = optionalStringClaim(jwt, "name", DISPLAY_NAME_MAX_LENGTH);
        if (displayName == null) {
            displayName = optionalStringClaim(jwt, "preferred_username", DISPLAY_NAME_MAX_LENGTH);
        }
        if (displayName == null) {
            throw new IdentityClaimsException(
                    "The authenticated identity must contain a name or preferred_username claim.");
        }

        return new IdentityProfile(issuer, subject, email, displayName);
    }

    static boolean hasExactUserRole(Jwt jwt) {
        Object rawAccess = jwt.getClaims().get("resource_access");
        if (!(rawAccess instanceof Map<?, ?> access)
                || !(access.get("autopay-guard-api") instanceof Map<?, ?> api)
                || !(api.get("roles") instanceof Collection<?> roles)) {
            return false;
        }
        return roles.size() == 1 && "USER".equals(roles.iterator().next());
    }

    private static boolean isReservedLocalFixture(IdentityProfile profile) {
        return LOCAL_ISSUER.equals(profile.issuer())
                && profile.email().equals(RESERVED_LOCAL_IDENTITIES.get(profile.subject()));
    }

    private static String requiredSubjectClaim(Jwt jwt) {
        Object rawValue = jwt.getClaims().get("sub");
        if (!(rawValue instanceof String subject)
                || subject.isEmpty()
                || subject.length() > SUBJECT_MAX_LENGTH
                || !subject.equals(subject.strip())
                || CONTROL_CHARACTER.matcher(subject).find()) {
            throw new IdentityClaimsException(
                    "The authenticated identity contains an invalid sub claim.");
        }
        return subject;
    }

    private static String requiredStringClaim(Jwt jwt, String claimName, int maxLength) {
        String value = optionalStringClaim(jwt, claimName, maxLength);
        if (value == null) {
            throw new IdentityClaimsException(
                    "The authenticated identity is missing the required "
                            + claimName
                            + " claim.");
        }
        return value;
    }

    private static String optionalStringClaim(Jwt jwt, String claimName, int maxLength) {
        Object rawValue = jwt.getClaims().get(claimName);
        if (rawValue == null) {
            return null;
        }
        if (!(rawValue instanceof String stringValue)) {
            throw new IdentityClaimsException(
                    "The authenticated identity contains an invalid "
                            + claimName
                            + " claim.");
        }

        String value = stringValue.strip();
        if (value.isEmpty()
                || value.length() > maxLength
                || CONTROL_CHARACTER.matcher(value).find()) {
            throw new IdentityClaimsException(
                    "The authenticated identity contains an invalid "
                            + claimName
                            + " claim.");
        }
        return value;
    }

    record IdentityProfile(String issuer, String subject, String email, String displayName) {}
}
