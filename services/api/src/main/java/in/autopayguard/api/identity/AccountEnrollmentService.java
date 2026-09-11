package in.autopayguard.api.identity;

import in.autopayguard.api.common.config.PrivacyProperties;
import in.autopayguard.api.common.error.LocalUserNotProvisionedException;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.privacy.PrivacyNoticeService;
import jakarta.validation.ValidationException;
import java.time.Clock;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountEnrollmentService {

    private final IdentityProperties identityProperties;
    private final PrivacyProperties privacyProperties;
    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final JdbcTemplate jdbcTemplate;
    private final PrivacyNoticeService noticeService;
    private final Clock clock;

    AccountEnrollmentService(
            IdentityProperties identityProperties,
            PrivacyProperties privacyProperties,
            CurrentUserService currentUserService,
            UserRepository userRepository,
            JdbcTemplate jdbcTemplate,
            PrivacyNoticeService noticeService,
            Clock clock) {
        this.identityProperties = identityProperties;
        this.privacyProperties = privacyProperties;
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.noticeService = noticeService;
        this.clock = clock;
    }

    @Transactional
    public CurrentUser enroll(Jwt jwt, AccountEnrollmentRequest request) {
        if (!identityProperties.selfRegistrationEnabled()
                || !CurrentUserService.hasExactUserRole(jwt)) {
            throw new LocalUserNotProvisionedException();
        }
        if (!request.ageConfirmed() || !request.privacyNoticeAccepted()) {
            throw new ValidationException(
                    "Age confirmation and privacy notice acceptance are required.");
        }
        if (!privacyProperties.noticeVersion().equals(request.privacyNoticeVersion())) {
            throw new RequestConflictException(
                    "The privacy notice version is no longer current. Refresh and review the current notice.");
        }
        CurrentUserService.IdentityProfile profile =
                currentUserService.validatedProfile(jwt, true);
        // Privacy execution takes this same lock before any user/request lock.
        jdbcTemplate.queryForObject(
                "SELECT id FROM account_enrollment_lock WHERE id = 1 FOR UPDATE", Integer.class);
        currentUserService.rejectDeletedSubject(profile.subject());
        Instant now = clock.instant();
        UserEntity user =
                userRepository.findByOidcSubject(profile.subject())
                        .orElseGet(() -> newBoundUser(profile, now));
        currentUserService.requireProvisionedIssuer(user, profile.issuer());
        CurrentUserService.requireProvisionedEmail(user, profile.email());
        user.synchronizeDisplayName(profile.displayName(), now);
        user.confirmOnboarding(request.privacyNoticeVersion(), now);
        CurrentUser result = userRepository.saveAndFlush(user).toCurrentUser();
        noticeService.recordForOnboarding(result.id(), request.privacyNoticeVersion(), now);
        return result;
    }

    private UserEntity newBoundUser(CurrentUserService.IdentityProfile profile, Instant now) {
        if (userRepository.existsByEmailIgnoreCase(profile.email())) {
            throw new RequestConflictException(
                    "This identity cannot create an application account.");
        }
        return UserEntity.createBound(
                profile.issuer(), profile.subject(), profile.email(), profile.displayName(), now);
    }
}
