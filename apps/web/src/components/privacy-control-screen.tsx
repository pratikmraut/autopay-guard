"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createIdempotencyKey } from "@/lib/idempotency-key";
import {
  PrivacyApi,
  PrivacyApiError,
  type ConsentHistory,
  type NoticeAcknowledgement,
  type PrivacyNotice,
  type PrivacyRequest,
} from "@/lib/privacy-api";

interface PrivacyData {
  notice: PrivacyNotice;
  acknowledgements: NoticeAcknowledgement[];
  nextAcknowledgementCursor: string | null;
  consent: ConsentHistory;
  nextConsentCursor: string | null;
  requests: PrivacyRequest[];
  nextRequestCursor: string | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PrivacyData };

export function PrivacyControlScreen() {
  const api = useMemo(() => new PrivacyApi(), []);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [deletionPhrase, setDeletionPhrase] = useState("");
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [notice, acknowledgementPage, consent, requestPage] =
          await Promise.all([
            api.currentNotice(signal),
            api.acknowledgements(signal),
            api.consents(signal),
            api.requests(signal),
          ]);
        if (!signal?.aborted) {
          setState({
            status: "ready",
            data: {
              notice,
              acknowledgements: acknowledgementPage.items,
              nextAcknowledgementCursor: acknowledgementPage.nextCursor,
              consent,
              nextConsentCursor: consent.nextCursor,
              requests: requestPage.items,
              nextRequestCursor: requestPage.nextCursor,
            },
          });
        }
      } catch (error) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            message: errorMessage(error),
          });
        }
      }
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void load(controller.signal);
      }
    });
    return () => controller.abort();
  }, [load]);

  if (state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading privacy controls…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Privacy controls unavailable</strong>
        <p>{state.message}</p>
        <button
          className="secondary-link"
          onClick={() => {
            setState({ status: "loading" });
            void load();
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  const {
    notice,
    acknowledgements,
    nextAcknowledgementCursor,
    consent,
    nextConsentCursor,
    requests,
    nextRequestCursor,
  } = state.data;
  const currentNoticeAcknowledged = acknowledgements.some(
    (item) =>
      item.noticeVersion === notice.noticeVersion &&
      item.contentSha256 === notice.contentSha256,
  );
  const sharingGranted =
    consent.currentAction === "GRANTED" &&
    consent.currentPurposeVersion === notice.noticeVersion;

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Your app-owned data</p>
          <h1>Privacy controls</h1>
          <p>
            Review append-only notice and consent history, request a canonical
            JSON export, correct your app timezone, or request local deletion.
            These controls do not change Keycloak or establish legal compliance.
          </p>
        </div>
      </header>

      <MutationMessages message={message} error={mutationError} />

      <div className="notification-settings-grid">
        <section className="notification-settings-card">
          <div className="settings-card-heading">
            <p className="card-kicker">Current notice</p>
            <h2>Notice acknowledgement</h2>
            <p>
              Acknowledgement records that you saw this exact notice version. It
              is not blanket consent.
            </p>
          </div>
          <dl className="diagnostic-timing">
            <div>
              <dt>Version</dt>
              <dd>{notice.noticeVersion}</dd>
            </div>
            <div>
              <dt>Current status</dt>
              <dd>
                {currentNoticeAcknowledged
                  ? "Acknowledged"
                  : "Acknowledgement required"}
              </dd>
            </div>
          </dl>
          {!currentNoticeAcknowledged && (
            <button
              className="primary-action mt-5"
              disabled={busy !== null}
              onClick={() =>
                void mutate("notice", async () => {
                  await api.acknowledge(
                    notice.noticeVersion,
                    createIdempotencyKey("notice-ack"),
                  );
                  return "Current privacy notice acknowledged.";
                })
              }
              type="button"
            >
              {busy === "notice" ? "Recording…" : "Acknowledge this notice"}
            </button>
          )}
          <HistoryList
            empty="No notice acknowledgement has been recorded."
            items={acknowledgements.map((item) => ({
              id: item.id,
              label: `${item.noticeVersion} · ${formatInstant(item.acknowledgedAt)}`,
            }))}
          />
          {nextAcknowledgementCursor && (
            <button
              className="secondary-link secondary-link--button mt-4"
              disabled={busy !== null}
              onClick={() =>
                void loadMoreAcknowledgements(nextAcknowledgementCursor)
              }
              type="button"
            >
              {busy === "notice-page" ? "Loading…" : "Load more notice history"}
            </button>
          )}
        </section>

        <section className="notification-settings-card">
          <div className="settings-card-heading">
            <p className="card-kicker">Household sharing</p>
            <h2>Sharing consent</h2>
            <p>
              A current grant is required before invitations or member-visible
              reads. Withdrawal pauses sharing without rewriting membership or
              commitment history.
            </p>
          </div>
          <p className="mt-4 text-lg font-black text-emerald-950">
            {sharingGranted ? "Sharing is granted" : "Sharing is not granted"}
          </p>
          {sharingGranted ? (
            <>
              <label className="mt-5 flex items-start gap-3 text-sm leading-6">
                <input
                  checked={withdrawConfirmed}
                  className="mt-1 size-5"
                  onChange={(event) =>
                    setWithdrawConfirmed(event.target.checked)
                  }
                  type="checkbox"
                />
                I understand that withdrawing pauses member access to shared
                commitments until a later valid grant.
              </label>
              <button
                className="secondary-link secondary-link--button mt-4"
                disabled={!withdrawConfirmed || busy !== null}
                onClick={() =>
                  void mutate("consent", async () => {
                    await api.recordSharingConsent(
                      notice.noticeVersion,
                      "WITHDRAWN",
                      createIdempotencyKey("sharing-withdraw"),
                    );
                    setWithdrawConfirmed(false);
                    return "Household sharing consent withdrawn.";
                  })
                }
                type="button"
              >
                {busy === "consent" ? "Recording…" : "Withdraw sharing consent"}
              </button>
            </>
          ) : (
            <button
              className="primary-action mt-5"
              disabled={!currentNoticeAcknowledged || busy !== null}
              onClick={() =>
                void mutate("consent", async () => {
                  await api.recordSharingConsent(
                    notice.noticeVersion,
                    "GRANTED",
                    createIdempotencyKey("sharing-grant"),
                  );
                  return "Household sharing consent granted.";
                })
              }
              type="button"
            >
              {busy === "consent" ? "Recording…" : "Grant sharing consent"}
            </button>
          )}
          {!currentNoticeAcknowledged && (
            <p className="field-hint mt-3">
              Acknowledge the current notice before granting.
            </p>
          )}
          <HistoryList
            empty="No household-sharing consent event has been recorded."
            items={consent.events.map((item) => ({
              id: item.id,
              label: `${item.action === "GRANTED" ? "Granted" : "Withdrawn"} · ${item.purposeVersion} · ${formatInstant(item.occurredAt)}`,
            }))}
          />
          {nextConsentCursor && (
            <button
              className="secondary-link secondary-link--button mt-4"
              disabled={busy !== null}
              onClick={() => void loadMoreConsent(nextConsentCursor)}
              type="button"
            >
              {busy === "consent-page"
                ? "Loading…"
                : "Load more consent history"}
            </button>
          )}
        </section>

        <section className="notification-settings-card">
          <div className="settings-card-heading">
            <p className="card-kicker">Subject-only JSON</p>
            <h2>Export app-owned data</h2>
            <p>
              The generated canonical JSON is available only to your signed-in
              subject, is integrity-labeled, and expires within 24 hours.
            </p>
          </div>
          <button
            className="primary-action mt-5"
            disabled={busy !== null}
            onClick={() =>
              void mutate("export-request", async () => {
                await api.createRequest(
                  "EXPORT",
                  null,
                  createIdempotencyKey("privacy-export"),
                );
                return "Export request created.";
              })
            }
            type="button"
          >
            {busy === "export-request" ? "Requesting…" : "Request JSON export"}
          </button>
        </section>

        <section className="notification-settings-card">
          <div className="settings-card-heading">
            <p className="card-kicker">Bounded correction</p>
            <h2>Correct app timezone</h2>
            <p>
              Only your app-owned IANA timezone can be corrected here. Identity
              provider attributes and historical snapshots are unchanged.
            </p>
          </div>
          <label className="field-label mt-5" htmlFor="privacy-timezone">
            IANA timezone
          </label>
          <input
            className="form-input"
            id="privacy-timezone"
            maxLength={64}
            onChange={(event) => setTimezone(event.target.value)}
            value={timezone}
          />
          <button
            className="primary-action mt-4"
            disabled={!validTimeZone(timezone) || busy !== null}
            onClick={() =>
              void mutate("correction", async () => {
                await api.createRequest(
                  "CORRECTION",
                  timezone.trim(),
                  createIdempotencyKey("privacy-correction"),
                );
                return "Timezone correction request created for privacy admin review.";
              })
            }
            type="button"
          >
            {busy === "correction"
              ? "Requesting…"
              : "Request timezone correction"}
          </button>
          {!validTimeZone(timezone) && (
            <p className="field-error mt-2" role="alert">
              Enter a valid IANA timezone such as Asia/Kolkata.
            </p>
          )}
        </section>

        <section className="notification-settings-card">
          <div className="settings-card-heading">
            <p className="card-kicker">Destructive local operation</p>
            <h2>Request local deletion</h2>
            <p>
              A privacy admin must execute this separately. Multi-member
              households and the protected canonical demo are blocked. If
              eligible, execution removes your local profile, sole-member
              households, tracked commitments, notification and cancellation
              history, privacy records, and short-lived artifacts.
            </p>
            <p className="mt-3">
              Only a minimal tombstone remains: a one-way, domain-separated
              fake-local subject digest, a random execution reference, its
              timestamp, and one redacted audit event. It contains no email,
              name, household, or financial content. This does not delete your
              Keycloak identity and is not a legal-compliance claim.
            </p>
          </div>
          <label className="field-label mt-5" htmlFor="deletion-confirmation">
            Type DELETE LOCAL DATA
          </label>
          <input
            autoComplete="off"
            className="form-input"
            id="deletion-confirmation"
            onChange={(event) => setDeletionPhrase(event.target.value)}
            value={deletionPhrase}
          />
          <button
            className="secondary-link secondary-link--button mt-4 border-red-300 text-red-900"
            disabled={deletionPhrase !== "DELETE LOCAL DATA" || busy !== null}
            onClick={() =>
              void mutate("deletion", async () => {
                await api.createRequest(
                  "DELETION",
                  null,
                  createIdempotencyKey("privacy-deletion"),
                );
                setDeletionPhrase("");
                return "Local deletion request created for privacy admin review.";
              })
            }
            type="button"
          >
            {busy === "deletion" ? "Requesting…" : "Request local deletion"}
          </button>
        </section>

        <section className="notification-settings-card lg:col-span-2">
          <div className="settings-card-heading">
            <p className="card-kicker">Lifecycle</p>
            <h2>Your privacy requests</h2>
            <p>
              Statuses describe this local application workflow. They are not
              legal-compliance claims.
            </p>
          </div>
          {requests.length === 0 ? (
            <p className="mt-5 text-sm text-slate-600">
              No privacy request has been created.
            </p>
          ) : (
            <>
              <ul className="mt-5 grid gap-3">
                {requests.map((request) => (
                  <li
                    className="rounded-2xl border border-emerald-950/10 bg-white p-4"
                    key={request.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-emerald-950">
                          {requestLabel(request)}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {formatInstant(request.createdAt)} · version{" "}
                          {request.version}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-900">
                        {request.status}
                      </span>
                    </div>
                    {requestStatusExplanation(request) && (
                      <p className="mt-3 text-sm text-slate-600">
                        {requestStatusExplanation(request)}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-3">
                      {request.requestType === "EXPORT" &&
                        request.status === "READY" && (
                          <button
                            className="primary-action"
                            disabled={busy !== null}
                            onClick={() =>
                              void downloadExport(
                                request.id,
                                api,
                                setBusy,
                                setMessage,
                                setMutationError,
                              )
                            }
                            type="button"
                          >
                            {busy === `download:${request.id}`
                              ? "Preparing…"
                              : "Download canonical JSON"}
                          </button>
                        )}
                      {request.status === "REQUESTED" && (
                        <button
                          className="secondary-link secondary-link--button"
                          disabled={busy !== null}
                          onClick={() =>
                            void mutate(`cancel:${request.id}`, async () => {
                              await api.cancelRequest(
                                request.id,
                                request.version,
                                createIdempotencyKey("privacy-cancel"),
                              );
                              return "Privacy request cancelled.";
                            })
                          }
                          type="button"
                        >
                          {busy === `cancel:${request.id}`
                            ? "Cancelling…"
                            : "Cancel request"}
                        </button>
                      )}
                    </div>
                    {request.export && (
                      <p className="mt-3 break-all text-xs text-slate-500">
                        {request.export.byteCount.toLocaleString()} bytes ·
                        expires {formatInstant(request.export.expiresAt)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {nextRequestCursor && (
                <button
                  className="secondary-link secondary-link--button mt-5"
                  disabled={busy !== null}
                  onClick={() =>
                    void loadMorePrivacyRequests(nextRequestCursor)
                  }
                  type="button"
                >
                  {busy === "privacy-request-page"
                    ? "Loading…"
                    : "Load more privacy requests"}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );

  async function mutate(operation: string, action: () => Promise<string>) {
    setBusy(operation);
    setMessage(null);
    setMutationError(null);
    try {
      const success = await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMutationError(mutationErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadMorePrivacyRequests(cursor: string) {
    setBusy("privacy-request-page");
    setMutationError(null);
    try {
      const page = await api.requests(undefined, cursor);
      setState((current) => {
        if (current.status !== "ready") {
          return current;
        }
        const known = new Set(
          current.data.requests.map((request) => request.id),
        );
        return {
          status: "ready",
          data: {
            ...current.data,
            requests: [
              ...current.data.requests,
              ...page.items.filter((request) => !known.has(request.id)),
            ],
            nextRequestCursor: page.nextCursor,
          },
        };
      });
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : "The next privacy-request page could not be loaded.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreAcknowledgements(cursor: string) {
    setBusy("notice-page");
    setMutationError(null);
    try {
      const page = await api.acknowledgements(undefined, cursor);
      setState((current) => {
        if (current.status !== "ready") {
          return current;
        }
        const known = new Set(
          current.data.acknowledgements.map((item) => item.id),
        );
        return {
          status: "ready",
          data: {
            ...current.data,
            acknowledgements: [
              ...current.data.acknowledgements,
              ...page.items.filter((item) => !known.has(item.id)),
            ],
            nextAcknowledgementCursor: page.nextCursor,
          },
        };
      });
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : "The next notice-history page could not be loaded.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreConsent(cursor: string) {
    setBusy("consent-page");
    setMutationError(null);
    try {
      const page = await api.consents(undefined, cursor);
      setState((current) => {
        if (current.status !== "ready") {
          return current;
        }
        const known = new Set(
          current.data.consent.events.map((item) => item.id),
        );
        return {
          status: "ready",
          data: {
            ...current.data,
            consent: {
              ...page,
              events: [
                ...current.data.consent.events,
                ...page.events.filter((item) => !known.has(item.id)),
              ],
            },
            nextConsentCursor: page.nextCursor,
          },
        };
      });
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : "The next consent-history page could not be loaded.",
      );
    } finally {
      setBusy(null);
    }
  }
}

function MutationMessages({
  message,
  error,
}: {
  message: string | null;
  error: string | null;
}) {
  return (
    <>
      {message && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {message}
        </div>
      )}
      {error && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>That operation was not completed</strong>
          <p>{error}</p>
        </div>
      )}
    </>
  );
}

function HistoryList({
  items,
  empty,
}: {
  items: Array<{ id: string; label: string }>;
  empty: string;
}) {
  return items.length === 0 ? (
    <p className="mt-5 text-sm text-slate-600">{empty}</p>
  ) : (
    <ul className="mt-5 grid gap-2 text-sm text-slate-600">
      {items.map((item) => (
        <li key={item.id}>{item.label}</li>
      ))}
    </ul>
  );
}

async function downloadExport(
  requestId: string,
  api: PrivacyApi,
  setBusy: (value: string | null) => void,
  setMessage: (value: string | null) => void,
  setError: (value: string | null) => void,
) {
  setBusy(`download:${requestId}`);
  setMessage(null);
  setError(null);
  try {
    const { bytes, filename } = await api.exportBytes(requestId);
    const blob = new Blob([bytes], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Canonical JSON export downloaded.");
  } catch (error) {
    setError(mutationErrorMessage(error));
  } finally {
    setBusy(null);
  }
}

function validTimeZone(value: string) {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: normalized }).format();
    return true;
  } catch {
    return false;
  }
}

function requestLabel(request: PrivacyRequest) {
  if (request.requestType === "CORRECTION") {
    return `Timezone correction${request.correctionValue ? ` · ${request.correctionValue}` : ""}`;
  }
  return request.requestType === "EXPORT"
    ? "Canonical JSON export"
    : "Local deletion";
}

function requestStatusExplanation(request: PrivacyRequest) {
  switch (request.status) {
    case "PROCESSING":
      return "Local processing has started, so this request can no longer be cancelled.";
    case "BLOCKED":
      return "Nothing was erased. The current local eligibility check blocked execution; review household membership or protected-demo status.";
    case "EXPIRED":
      return "The stored export bytes reached their retention deadline and were physically removed. Metadata remains so the lifecycle is clear.";
    case "FAILED":
      return "The local operation failed safely and produced no partial export or partial mutation.";
    case "CANCELLED":
      return "You cancelled this request before local processing started.";
    case "EXECUTED":
      return request.requestType === "DELETION"
        ? "Eligible app-owned data was removed; only the minimal tombstone and redacted execution audit remain."
        : "The bounded local operation completed.";
    default:
      return null;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The privacy service could not be loaded.";
}

function mutationErrorMessage(error: unknown) {
  if (error instanceof PrivacyApiError) {
    if (error.status === 409) {
      return "The request conflicts with current state. Reload and review the latest status.";
    }
    if (error.status === 412) {
      return "This record changed in another session. Reload before trying again.";
    }
    if (error.status === 429) {
      return "Too many attempts were made. Wait before trying again.";
    }
    if (error.status === 410) {
      return "This export expired and was removed. Create a new export request.";
    }
  }
  return errorMessage(error);
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
