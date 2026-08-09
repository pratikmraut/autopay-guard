package in.autopayguard.api.household;

import in.autopayguard.api.common.config.PrivacyProperties;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.validation.SensitiveContentGuard;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.Currency;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HouseholdService {

    private static final Set<String> IANA_ZONE_IDS = ZoneId.getAvailableZoneIds();

    private final HouseholdRepository householdRepository;
    private final CurrentUserService currentUserService;
    private final HouseholdMembershipService membershipService;
    private final in.autopayguard.api.privacy.PrivacyNoticeService privacyNoticeService;
    private final PrivacyProperties privacyProperties;
    private final Clock clock;

    HouseholdService(
            HouseholdRepository householdRepository,
            CurrentUserService currentUserService,
            HouseholdMembershipService membershipService,
            in.autopayguard.api.privacy.PrivacyNoticeService privacyNoticeService,
            PrivacyProperties privacyProperties,
            Clock clock) {
        this.householdRepository = householdRepository;
        this.currentUserService = currentUserService;
        this.membershipService = membershipService;
        this.privacyNoticeService = privacyNoticeService;
        this.privacyProperties = privacyProperties;
        this.clock = clock;
    }

    @Transactional
    public HouseholdResponse create(Jwt jwt, CreateHouseholdRequest request) {
        if (!privacyProperties.noticeVersion().equals(request.privacyNoticeVersion())) {
            throw new RequestConflictException(
                    "The privacy notice version is no longer current. Refresh and review the current notice.");
        }

        String name = request.name().strip();
        SensitiveContentGuard.rejectObviousSecrets(name, "name");
        String currency = validatedCurrency(request.defaultCurrency());
        String timezone = validatedTimezone(request.timezone());
        CurrentUser owner =
                currentUserService.resolveAndConfirmOnboarding(
                        jwt, request.privacyNoticeVersion());

        HouseholdEntity household =
                HouseholdEntity.create(
                        name, owner.id(), currency, timezone, clock.instant());
        HouseholdEntity saved = householdRepository.saveAndFlush(household);
        membershipService.registerFounder(saved.id(), owner.id(), clock.instant());
        privacyNoticeService.recordForOnboarding(
                owner.id(), request.privacyNoticeVersion(), clock.instant());
        return saved.toResponse(HouseholdMemberRole.OWNER);
    }

    @Transactional
    public HouseholdCollectionResponse list(Jwt jwt, UUID cursor, int limit) {
        CurrentUser owner = currentUserService.resolve(jwt);
        return membershipService.listAccessibleHouseholds(
                owner.id(), cursor, limit);
    }

    private static String validatedCurrency(String currencyCode) {
        String candidate = currencyCode.strip();
        try {
            Currency currency = Currency.getInstance(candidate);
            if (!currency.getCurrencyCode().equals(candidate)
                    || candidate.length() != 3
                    || !candidate.equals(candidate.toUpperCase(Locale.ROOT))) {
                throw new IllegalArgumentException("Invalid ISO 4217 currency.");
            }
            return candidate;
        } catch (IllegalArgumentException exception) {
            throw new jakarta.validation.ValidationException(
                    "defaultCurrency must be a supported ISO 4217 currency code.");
        }
    }

    private static String validatedTimezone(String timezone) {
        String candidate = timezone.strip();
        if (!IANA_ZONE_IDS.contains(candidate)) {
            throw new jakarta.validation.ValidationException(
                    "timezone must be a supported IANA time-zone identifier.");
        }
        try {
            return ZoneId.of(candidate).getId();
        } catch (DateTimeException exception) {
            throw new jakarta.validation.ValidationException(
                    "timezone must be a supported IANA time-zone identifier.");
        }
    }
}
