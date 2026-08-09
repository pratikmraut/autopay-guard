import { ApiClientError } from "@autopay-guard/contracts";

export function archiveCommitmentErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 412) {
      return "This commitment changed after you opened it. Reload before archiving.";
    }
    if (error.status === 428) {
      return "A current version is required. Reload before archiving.";
    }
  }
  return "Could not confirm whether it was archived. Reload before retrying.";
}

export function saveCommitmentErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 400) {
      return error.problem?.detail ?? "Check the highlighted details.";
    }
    if (error.status === 401) {
      return "Your secure session expired. Sign in again.";
    }
    if (error.status === 409) {
      return "A matching commitment already exists or the request conflicts.";
    }
    if (error.status === 428) {
      return "Reload this commitment before updating it.";
    }
  }
  return "Could not confirm whether it was saved. Check the list or reload before retrying.";
}
