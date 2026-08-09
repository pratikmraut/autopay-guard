package in.autopayguard.api.notification;

import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.household.ActiveHouseholdAccess;
import in.autopayguard.api.household.HouseholdMembershipService;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationQueryService {

    private static final String CURSOR_PREFIX = "n1";
    private static final int MAXIMUM_PAGE_INDEX = 10_000;

    private final NotificationRepository notificationRepository;
    private final NotificationDeliveryRepository deliveryRepository;
    private final NotificationDiagnosticsRepository diagnosticsRepository;
    private final CurrentUserService currentUserService;
    private final HouseholdMembershipService householdMembershipService;
    private final Clock clock;

    NotificationQueryService(
            NotificationRepository notificationRepository,
            NotificationDeliveryRepository deliveryRepository,
            NotificationDiagnosticsRepository diagnosticsRepository,
            CurrentUserService currentUserService,
            HouseholdMembershipService householdMembershipService,
            Clock clock) {
        this.notificationRepository = notificationRepository;
        this.deliveryRepository = deliveryRepository;
        this.diagnosticsRepository = diagnosticsRepository;
        this.currentUserService = currentUserService;
        this.householdMembershipService = householdMembershipService;
        this.clock = clock;
    }

    @Transactional
    public NotificationPageResponse list(
            Jwt jwt,
            UUID householdId,
            NotificationFilter filter,
            int limit,
            String cursor) {
        CurrentUser caller = currentUserService.resolve(jwt);
        ActiveHouseholdAccess access =
                householdMembershipService.requireConsentedReadAccess(
                        householdId, caller.id());
        int pageIndex = decodePage(cursor, householdId, filter, limit);
        PageRequest pageRequest = PageRequest.of(pageIndex, limit);
        Page<NotificationEntity> page =
                switch (filter) {
                    case ALL ->
                            notificationRepository.findAllVisiblePage(
                                    caller.id(),
                                    access.ownerUserId(),
                                    householdId,
                                    pageRequest);
                    case UNREAD ->
                            notificationRepository.findUnreadVisiblePage(
                                    caller.id(),
                                    access.ownerUserId(),
                                    householdId,
                                    pageRequest);
                    case FAILED ->
                            notificationRepository.findFailedVisiblePage(
                                    caller.id(),
                                    access.ownerUserId(),
                                    householdId,
                                    pageRequest);
                };
        List<NotificationResponse> items =
                page.getContent().stream().map(this::toResponse).toList();
        String nextCursor =
                page.hasNext()
                        ? encodePage(
                                pageIndex + 1,
                                householdId,
                                filter,
                                limit)
                        : null;
        return new NotificationPageResponse(
                householdId, filter, items, nextCursor);
    }

    @Transactional(readOnly = true)
    public NotificationResponse get(Jwt jwt, UUID notificationId) {
        CurrentUser caller = currentUserService.resolve(jwt);
        NotificationEntity notification =
                notificationRepository
                        .findVisibleById(caller.id(), notificationId)
                        .orElseThrow(ResourceNotFoundException::new);
        householdMembershipService.requireConsentedReadAccess(
                notification.householdId(), caller.id());
        return toResponse(notification);
    }

    @Transactional
    public NotificationResponse updateRead(
            Jwt jwt,
            UUID notificationId,
            long expectedVersion,
            boolean read) {
        CurrentUser owner = currentUserService.resolve(jwt);
        NotificationEntity notification =
                notificationRepository
                        .findOwnedByIdForUpdate(owner.id(), notificationId)
                        .orElseThrow(ResourceNotFoundException::new);
        if (notification.version() != expectedVersion) {
            throw new PreconditionFailedException();
        }
        notification.markRead(read, clock.instant());
        return toResponse(notificationRepository.saveAndFlush(notification));
    }

    @Transactional
    public NotificationDiagnosticsResponse diagnostics(
            Jwt jwt, UUID householdId) {
        CurrentUser caller = currentUserService.resolve(jwt);
        ActiveHouseholdAccess access =
                householdMembershipService.requireConsentedReadAccess(
                        householdId, caller.id());
        NotificationDiagnosticsRepository.DiagnosticCounts counts =
                diagnosticsRepository.counts(
                        caller.id(), access.ownerUserId(), householdId);
        Long oldestAge =
                counts.oldestPendingAt() == null
                        ? null
                        : Math.max(
                                0,
                                Duration.between(
                                                counts.oldestPendingAt(),
                                                clock.instant())
                                        .getSeconds());
        return new NotificationDiagnosticsResponse(
                householdId,
                counts.pending(),
                counts.processing(),
                counts.retryScheduled(),
                counts.delivered(),
                counts.dead(),
                counts.suppressed(),
                oldestAge,
                counts.nextRetryAt(),
                diagnosticsRepository.failures(
                        caller.id(), access.ownerUserId(), householdId));
    }

    private NotificationResponse toResponse(NotificationEntity notification) {
        NotificationDeliveryEntity delivery =
                deliveryRepository
                        .findByNotificationId(notification.id())
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "Notification delivery is missing."));
        Instant nextAttemptAt =
                delivery.status() == NotificationStatus.PENDING
                                || delivery.status()
                                        == NotificationStatus.RETRY_SCHEDULED
                        ? delivery.availableAt()
                        : null;
        return new NotificationResponse(
                notification.id(),
                notification.householdId(),
                notification.commitmentId(),
                notification.scheduledDate(),
                notification.channel(),
                notification.offsetDays(),
                notification.plannedFor(),
                delivery.status(),
                notification.read(),
                notification.version(),
                delivery.failureCategory() == null
                        ? NotificationFailureCategory.NONE
                        : delivery.failureCategory(),
                nextAttemptAt,
                delivery.deliveredAt(),
                notification.createdAt());
    }

    private static String encodePage(
            int pageIndex,
            UUID householdId,
            NotificationFilter filter,
            int limit) {
        String plain =
                String.join(
                        ":",
                        CURSOR_PREFIX,
                        Integer.toString(pageIndex),
                        Integer.toString(limit),
                        filter.name(),
                        householdId.toString());
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(plain.getBytes(StandardCharsets.UTF_8));
    }

    private static int decodePage(
            String cursor,
            UUID householdId,
            NotificationFilter filter,
            int limit) {
        if (cursor == null || cursor.isBlank()) {
            return 0;
        }
        if (cursor.length() > 200 || !cursor.matches("^[A-Za-z0-9_-]+$")) {
            throw new ValidationException("cursor is invalid.");
        }
        try {
            String plain =
                    new String(
                            Base64.getUrlDecoder().decode(cursor),
                            StandardCharsets.UTF_8);
            String[] parts = plain.split(":", -1);
            if (parts.length != 5
                    || !CURSOR_PREFIX.equals(parts[0])
                    || Integer.parseInt(parts[2]) != limit
                    || !filter.name().equals(parts[3])
                    || !householdId.toString().equals(parts[4])) {
                throw new IllegalArgumentException();
            }
            int page = Integer.parseInt(parts[1]);
            if (page < 1 || page > MAXIMUM_PAGE_INDEX) {
                throw new IllegalArgumentException();
            }
            return page;
        } catch (IllegalArgumentException exception) {
            throw new ValidationException(
                    "cursor is invalid or was issued for a different notification query.");
        }
    }
}
