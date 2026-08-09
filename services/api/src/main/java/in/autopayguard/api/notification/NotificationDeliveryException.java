package in.autopayguard.api.notification;

final class NotificationDeliveryException extends RuntimeException {

    private final NotificationFailureCategory category;
    private final boolean retryable;

    NotificationDeliveryException(
            NotificationFailureCategory category, boolean retryable) {
        super(category.name(), null, false, false);
        this.category = category;
        this.retryable = retryable;
    }

    NotificationFailureCategory category() {
        return category;
    }

    boolean retryable() {
        return retryable;
    }
}
