package in.autopayguard.api.identity;

import in.autopayguard.api.common.error.IdentityClaimsException;
import in.autopayguard.api.common.error.LocalUserNotProvisionedException;
import in.autopayguard.api.common.security.OpaqueCodes;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
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

    private final UserRepository userRepository;
    private final Clock clock;
    private final IdentityProperties identityProperties;

    CurrentUserService(
            UserRepository userRepository,
            Clock clock,
            IdentityProperties identityProperties) {
        this.userRepository = userRepository;
        this.clock = clock;
        this.identityProperties = identityProperties;
    }

    @Transactional
    public CurrentUser resolve(Jwt jwt) {
        IdentityProfile profile = validatedProfile(jwt);
        rejectDeletedSubject(profile.subject());
        Instant now = clock.instant();
        UserEntity user =
                userRepository
                        .findByOidcSubject(profile.subject())
                        .orElseGet(() -> newLocalUser(profile, now));
        requireProvisionedEmail(user, profile.email());
        user.synchronizeDisplayName(profile.displayName(), now);
        return userRepository.saveAndFlush(user).toCurrentUser();
    }

    @Transactional
    public CurrentUser resolveAndConfirmOnboarding(Jwt jwt, String privacyNoticeVersion) {
        IdentityProfile profile = validatedProfile(jwt);
        rejectDeletedSubject(profile.subject());
        Instant now = clock.instant();
        UserEntity user =
                userRepository
                        .findByOidcSubject(profile.subject())
                        .orElseGet(() -> newLocalUser(profile, now));
        requireProvisionedEmail(user, profile.email());
        user.synchronizeDisplayName(profile.displayName(), now);
        user.confirmOnboarding(privacyNoticeVersion, now);
        return userRepository.saveAndFlush(user).toCurrentUser();
    }

    private static void requireProvisionedEmail(UserEntity user, String normalizedEmail) {
        if (!user.hasEmail(normalizedEmail)) {
            throw new IdentityClaimsException(
                    "The authenticated identity email does not match the provisioned account.");
        }
    }

    private UserEntity newLocalUser(IdentityProfile profile, Instant now) {
        rejectDeletedSubject(profile.subject());
        if (!identityProperties.autoProvision()) {
            throw new LocalUserNotProvisionedException();
        }
        return UserEntity.create(
                profile.subject(), profile.email(), profile.displayName(), now);
    }

    private void rejectDeletedSubject(String subject) {
        String subjectHash = OpaqueCodes.sha256(TOMBSTONE_DOMAIN + subject);
        if (userRepository.existsDeletionTombstoneBySubjectHash(subjectHash)) {
            throw new LocalUserNotProvisionedException();
        }
    }

    private IdentityProfile validatedProfile(Jwt jwt) {
        String subject = requiredSubjectClaim(jwt);
        String email =
                requiredStringClaim(jwt, "email", EMAIL_MAX_LENGTH).toLowerCase(Locale.ROOT);
        if (!SAFE_EMAIL.matcher(email).matches()) {
            throw new IdentityClaimsException(
                    "The authenticated identity must contain a valid email claim.");
        }
        if (identityProperties.requireVerifiedEmail()
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

        return new IdentityProfile(subject, email, displayName);
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

    private record IdentityProfile(String subject, String email, String displayName) {}
}
