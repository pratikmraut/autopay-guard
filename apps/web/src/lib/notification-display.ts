import type {
  NotificationFailureCategory,
  NotificationStatus,
} from "@/lib/notification-api";

export function notificationStatusLabel(status: NotificationStatus) {
  return {
    PENDING: "Pending",
    PROCESSING: "Processing",
    DELIVERED: "Delivered",
    RETRY_SCHEDULED: "Retry scheduled",
    DEAD: "Delivery failed",
    SUPPRESSED: "Suppressed",
  }[status];
}

export function notificationStatusTone(status: NotificationStatus) {
  if (status === "DELIVERED") {
    return "success";
  }
  if (status === "DEAD") {
    return "danger";
  }
  if (status === "RETRY_SCHEDULED") {
    return "warning";
  }
  return "neutral";
}

export function notificationFailureLabel(
  category: NotificationFailureCategory,
) {
  return {
    NONE: "None",
    PROVIDER_TRANSIENT: "Temporary delivery issue",
    PROVIDER_PERMANENT: "Permanent delivery issue",
    PROVIDER_TIMEOUT: "Delivery timed out",
    RECIPIENT_NOT_FAKE: "Recipient safety policy",
    DELIVERY_INVALIDATED: "Reminder no longer eligible",
    QUIET_HOURS_EXPIRED: "Quiet hours passed the scheduled date",
    INTERNAL_PAYLOAD: "Internal message preparation",
  }[category];
}

export function notificationChannelLabel(channel: "IN_APP" | "EMAIL") {
  return channel === "IN_APP" ? "In-app" : "Local test email";
}

export function notificationOffsetLabel(offsetDays: number) {
  if (offsetDays === 0) {
    return "On the scheduled date";
  }
  if (offsetDays === 1) {
    return "1 day before";
  }
  return `${offsetDays} days before`;
}

export function formatNotificationInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
