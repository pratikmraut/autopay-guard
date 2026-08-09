import { ApiClientError } from "@autopay-guard/contracts";

export interface CancellationMutationFailure {
  conflict: boolean;
  uncertain: boolean;
  message: string;
}

export function cancellationLoadErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "Your secure session expired. Sign in again.";
    }
    if (error.status === 404) {
      return "This cancellation resource was not found in your owned workspaces.";
    }
  }
  return "AutoPay Guard could not return this cancellation information.";
}

export function cancellationMutationFailure(
  error: unknown,
  { replayProtected = false }: { replayProtected?: boolean } = {},
): CancellationMutationFailure {
  if (error instanceof ApiClientError) {
    if ([400, 409, 422].includes(error.status)) {
      return {
        conflict: error.status === 409,
        uncertain: false,
        message:
          error.problem?.detail ??
          "The requested cancellation record could not be saved.",
      };
    }
    if (error.status === 401) {
      return {
        conflict: false,
        uncertain: false,
        message: "Your secure session expired. Sign in again.",
      };
    }
    if (error.status === 412 || error.status === 428) {
      return {
        conflict: true,
        uncertain: false,
        message:
          "This record changed after you opened it. Reload the latest version before saving.",
      };
    }
  }
  return {
    conflict: false,
    uncertain: true,
    message: replayProtected
      ? "AutoPay Guard could not confirm whether the action was recorded. Reload before retrying; a retry of the same action reuses its idempotency key."
      : "AutoPay Guard could not confirm whether the update was recorded. Reload the latest version before deciding whether to retry.",
  };
}
