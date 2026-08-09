package in.autopayguard.api.notification;

public enum NotificationStatus {
    PENDING,
    PROCESSING,
    DELIVERED,
    RETRY_SCHEDULED,
    DEAD,
    SUPPRESSED
}
