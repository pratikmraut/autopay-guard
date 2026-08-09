package in.autopayguard.api.notification;

import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.time.Clock;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationPreferenceService {

    private static final DateTimeFormatter MINUTE_TIME = DateTimeFormatter.ofPattern("HH:mm");
    private static final Set<String> IANA_ZONE_IDS = ZoneId.getAvailableZoneIds();

    private final NotificationPreferenceRepository repository;
    private final CurrentUserService currentUserService;
    private final Clock clock;

    NotificationPreferenceService(
            NotificationPreferenceRepository repository,
            CurrentUserService currentUserService,
            Clock clock) {
        this.repository = repository;
        this.currentUserService = currentUserService;
        this.clock = clock;
    }

    @Transactional
    public NotificationPreferencesResponse get(Jwt jwt) {
        CurrentUser user = currentUserService.resolve(jwt);
        return repository
                .findByUserId(user.id())
                .map(NotificationPreferenceService::toResponse)
                .orElseGet(() -> synthetic(user));
    }

    @Transactional
    public NotificationPreferencesResponse update(
            Jwt jwt, long expectedVersion, UpdateNotificationPreferencesRequest request) {
        CurrentUser user = currentUserService.resolve(jwt);
        ValidatedPreference input = validate(request);
        repository.lockUser(user.id());
        NotificationPreferenceEntity existing =
                repository.findByUserIdForUpdate(user.id()).orElse(null);
        if (existing == null) {
            if (expectedVersion != 0) {
                throw new PreconditionFailedException();
            }
            NotificationPreferenceEntity created =
                    NotificationPreferenceEntity.create(
                            user.id(),
                            input.enabled(),
                            input.inAppEnabled(),
                            input.emailEnabled(),
                            input.timezone(),
                            input.quietHoursEnabled(),
                            input.quietStart(),
                            input.quietEnd(),
                            clock.instant());
            return toResponse(repository.saveAndFlush(created));
        }
        if (existing.version() != expectedVersion) {
            throw new PreconditionFailedException();
        }
        existing.update(
                input.enabled(),
                input.inAppEnabled(),
                input.emailEnabled(),
                input.timezone(),
                input.quietHoursEnabled(),
                input.quietStart(),
                input.quietEnd(),
                clock.instant());
        return toResponse(repository.saveAndFlush(existing));
    }

    @Transactional(readOnly = true)
    public Optional<NotificationPreferenceSnapshot> findForScheduling(UUID userId) {
        return repository.findByUserId(userId).map(NotificationPreferenceEntity::toSnapshot);
    }

    private static ValidatedPreference validate(UpdateNotificationPreferencesRequest request) {
        String timezone = validatedTimezone(request.timezone());
        LocalTime quietStart = parseTime(request.quietStart());
        LocalTime quietEnd = parseTime(request.quietEnd());
        if ((quietStart == null) != (quietEnd == null)) {
            throw new ValidationException("quietStart and quietEnd must both be present or both be null.");
        }
        if (Boolean.TRUE.equals(request.quietHoursEnabled()) && quietStart == null) {
            throw new ValidationException(
                    "quietStart and quietEnd are required when quiet hours are enabled.");
        }
        if (quietStart != null && quietStart.equals(quietEnd)) {
            throw new ValidationException("quietStart and quietEnd must be different.");
        }
        return new ValidatedPreference(
                request.enabled(),
                request.inAppEnabled(),
                request.emailEnabled(),
                timezone,
                request.quietHoursEnabled(),
                quietStart,
                quietEnd);
    }

    static String validatedTimezone(String timezone) {
        if (!timezone.equals(timezone.strip())) {
            throw new ValidationException("timezone must not contain surrounding whitespace.");
        }
        if (!IANA_ZONE_IDS.contains(timezone)) {
            throw new ValidationException("timezone must be a valid IANA timezone.");
        }
        return timezone;
    }

    private static LocalTime parseTime(String value) {
        return value == null ? null : LocalTime.parse(value, MINUTE_TIME);
    }

    private static NotificationPreferencesResponse synthetic(CurrentUser user) {
        return new NotificationPreferencesResponse(
                null, false, false, false, user.timezone(), false, null, null, 0, null);
    }

    private static NotificationPreferencesResponse toResponse(
            NotificationPreferenceEntity preference) {
        return new NotificationPreferencesResponse(
                preference.id(),
                preference.enabled(),
                preference.inAppEnabled(),
                preference.emailEnabled(),
                preference.timezone(),
                preference.quietHoursEnabled(),
                formatTime(preference.quietStart()),
                formatTime(preference.quietEnd()),
                preference.version(),
                preference.updatedAt());
    }

    private static String formatTime(LocalTime value) {
        return value == null ? null : MINUTE_TIME.format(value);
    }

    private record ValidatedPreference(
            boolean enabled,
            boolean inAppEnabled,
            boolean emailEnabled,
            String timezone,
            boolean quietHoursEnabled,
            LocalTime quietStart,
            LocalTime quietEnd) {}
}
