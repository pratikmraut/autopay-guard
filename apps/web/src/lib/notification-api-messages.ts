import { ApiClientError } from "@autopay-guard/contracts";

export interface NotificationMutationFailure {
  conflict: boolean;
  message: string;
}

export function notificationLoadErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "Your secure session expired. Sign in again.";
    }
    if (error.status === 404) {
      return "This notification resource was not found in your owned workspaces.";
    }
  }
  return "The notification service could not return this information.";
}

export function notificationMutationFailure(
  error: unknown,
): NotificationMutationFailure {
  if (error instanceof ApiClientError) {
    if (error.status === 400) {
      return {
        conflict: false,
        message: error.problem?.detail ?? "Check the reminder details.",
      };
    }
    if (error.status === 401) {
      return {
        conflict: false,
        message: "Your secure session expired. Sign in again.",
      };
    }
    if (error.status === 412) {
      return {
        conflict: true,
        message:
          "This resource changed after you opened it. Reload before saving.",
      };
    }
    if (error.status === 428) {
      return {
        conflict: true,
        message: "A current version is required. Reload before saving.",
      };
    }
  }
  return {
    conflict: false,
    message:
      "Could not confirm whether it was saved. Reload before retrying to avoid a duplicate action.",
  };
}
