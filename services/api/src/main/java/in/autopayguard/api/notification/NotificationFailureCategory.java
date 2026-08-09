package in.autopayguard.api.notification;

public enum NotificationFailureCategory {
    NONE,
    PROVIDER_TRANSIENT,
    PROVIDER_PERMANENT,
    PROVIDER_TIMEOUT,
    RECIPIENT_NOT_FAKE,
    DELIVERY_INVALIDATED,
    QUIET_HOURS_EXPIRED,
    INTERNAL_PAYLOAD
}
