"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createIdempotencyKey } from "@/lib/idempotency-key";
import {
  GuideAdminApi,
  GuideAdminApiError,
  type AdminGuideFeedback,
  type AdminGuideSummary,
} from "@/lib/guide-admin-api";

type CatalogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      guides: AdminGuideSummary[];
      feedback: AdminGuideFeedback[];
      nextCursor: string | null;
      paginationError: string | null;
    };

type ReviewDisposition = "" | "RESOLVED" | "DISMISSED";

export function AdminGuideCatalogScreen() {
  const api = useMemo(() => new GuideAdminApi(), []);
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const [reviewChoices, setReviewChoices] = useState<
    Record<string, ReviewDisposition>
  >({});
  const [reviewConfirmations, setReviewConfirmations] = useState<
    Record<string, boolean>
  >({});
  const [busyFeedbackId, setBusyFeedbackId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const reviewKeys = useRef(new Map<string, string>());

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [guides, feedbackPage] = await Promise.all([
          api.listGuides(signal),
          api.feedback(undefined, signal),
        ]);
        if (!signal?.aborted) {
          setState({
            status: "ready",
            guides,
            feedback: feedbackPage.items,
            nextCursor: feedbackPage.nextCursor,
            paginationError: null,
          });
        }
      } catch (error) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            message: guideAdminError(
              error,
              "The guide administration view could not be loaded.",
            ),
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
        Loading fictional guide administration…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Guide administration unavailable</strong>
        <p>{state.message}</p>
        <button
          className="secondary-link secondary-link--button"
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

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">GUIDE_ADMIN only</p>
          <h1>Fictional guide administration</h1>
          <p>
            Create drafts from server-selected published versions, review
            immutable history, and manage the current local catalog head.
            Publishing makes a fictional local guide current; it does not verify
            a merchant or link, and no provider is contacted.
          </p>
        </div>
        <button
          className="secondary-link secondary-link--button"
          onClick={() => {
            setState({ status: "loading" });
            setMessage(null);
            setMutationError(null);
            void load();
          }}
          type="button"
        >
          Refresh administration
        </button>
      </header>

      {message && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {message}
        </div>
      )}
      {mutationError && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>Feedback review was not saved</strong>
          <p>{mutationError}</p>
        </div>
      )}

      <section
        className="notification-settings-card"
        aria-labelledby="guide-catalog-heading"
      >
        <div className="settings-card-heading">
          <p className="card-kicker">Current catalog heads</p>
          <h2 id="guide-catalog-heading">Cancellation guides</h2>
          <p>
            Merchant identity, category, published versions, targets, structure,
            and catalog-head history are server controlled.
          </p>
        </div>

        {state.guides.length === 0 ? (
          <div className="resource-state mt-6">
            <strong>No fictional guides</strong>
            <p>The bounded local guide catalog is empty.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {state.guides.map((guide) => (
              <article
                className="rounded-3xl border border-emerald-950/10 bg-white p-5"
                key={guide.guideId}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="card-kicker">{guide.merchantCategory}</p>
                    <h3 className="mt-2 break-words text-xl font-black text-emerald-950">
                      {guide.merchantName}
                    </h3>
                  </div>
                  <StatusPill state={guide.state} />
                </div>
                <dl className="diagnostic-timing mt-5">
                  <div>
                    <dt>Current published version</dt>
                    <dd>{guide.currentPublishedVersion ?? "None"}</dd>
                  </div>
                  <div>
                    <dt>Catalog ETag version</dt>
                    <dd>{guide.version}</dd>
                  </div>
                  <div>
                    <dt>Last head event</dt>
                    <dd>{formatInstant(guide.updatedAt)}</dd>
                  </div>
                </dl>
                <Link
                  className="secondary-link mt-5 inline-flex"
                  href={`/admin/guides/${encodeURIComponent(guide.guideId)}`}
                >
                  Open guide and immutable history
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        className="notification-settings-card"
        aria-labelledby="feedback-queue-heading"
      >
        <div className="settings-card-heading">
          <p className="card-kicker">Redacted review queue</p>
          <h2 id="feedback-queue-heading">Guide feedback</h2>
          <p>
            This queue exposes only feedback ID, guide ID and version, outcome,
            creation time, review disposition, and record version. It never
            displays a note, user, household, commitment, identity, amount, or
            guide target. Reviewing feedback cannot edit, publish, or retire a
            guide.
          </p>
        </div>

        {state.feedback.length === 0 ? (
          <div className="resource-state mt-6">
            <strong>No feedback to review</strong>
            <p>The redacted local queue is empty.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {state.feedback.map((feedback) => {
              const choice = reviewChoices[feedback.id] ?? "";
              const confirmed = reviewConfirmations[feedback.id] ?? false;
              const pending = feedback.disposition === "PENDING";
              return (
                <article
                  className="rounded-3xl border border-emerald-950/10 bg-white p-5"
                  key={feedback.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="card-kicker">
                        {formatOutcome(feedback.outcome)}
                      </p>
                      <h3 className="mt-2 break-all text-lg font-black text-emerald-950">
                        Feedback {feedback.id}
                      </h3>
                      <p className="mt-2 break-all text-sm text-slate-600">
                        Guide {feedback.guideId} · published version{" "}
                        {feedback.guideVersion}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Created {formatInstant(feedback.createdAt)} · record
                        version {feedback.version}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-900">
                      {feedback.disposition}
                    </span>
                  </div>

                  {pending && (
                    <fieldset className="mt-5">
                      <legend className="field-label">
                        Review disposition
                      </legend>
                      <div className="mt-3 flex flex-wrap gap-4">
                        {(["RESOLVED", "DISMISSED"] as const).map(
                          (disposition) => (
                            <label
                              className="flex min-h-11 items-center gap-2 rounded-2xl border border-emerald-950/15 px-4 py-2 text-sm font-bold"
                              key={disposition}
                            >
                              <input
                                checked={choice === disposition}
                                name={`feedback-disposition-${feedback.id}`}
                                onChange={() => {
                                  setReviewChoices((current) => ({
                                    ...current,
                                    [feedback.id]: disposition,
                                  }));
                                  setReviewConfirmations((current) => ({
                                    ...current,
                                    [feedback.id]: false,
                                  }));
                                  setMutationError(null);
                                }}
                                type="radio"
                              />
                              {disposition === "RESOLVED"
                                ? "Mark resolved"
                                : "Dismiss"}
                            </label>
                          ),
                        )}
                      </div>
                      <label className="mt-4 flex items-start gap-3 text-sm leading-6">
                        <input
                          checked={confirmed}
                          className="mt-1 size-5"
                          onChange={(event) =>
                            setReviewConfirmations((current) => ({
                              ...current,
                              [feedback.id]: event.target.checked,
                            }))
                          }
                          type="checkbox"
                        />
                        I confirm this changes only the redacted feedback review
                        disposition. It does not change the guide.
                      </label>
                      <button
                        className="primary-action mt-4"
                        disabled={
                          !choice || !confirmed || busyFeedbackId !== null
                        }
                        onClick={() => void reviewFeedback(feedback, choice)}
                        type="button"
                      >
                        {busyFeedbackId === feedback.id
                          ? "Saving review…"
                          : "Save feedback review"}
                      </button>
                    </fieldset>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {state.paginationError && (
          <p className="field-error mt-4" role="alert">
            {state.paginationError}
          </p>
        )}
        {state.nextCursor && (
          <button
            className="secondary-link secondary-link--button mt-5"
            disabled={loadingMore}
            onClick={() => void loadMore(state.nextCursor!)}
            type="button"
          >
            {loadingMore ? "Loading…" : "Load more redacted feedback"}
          </button>
        )}
      </section>
    </div>
  );

  async function reviewFeedback(
    feedback: AdminGuideFeedback,
    disposition: ReviewDisposition,
  ) {
    if (!disposition) {
      return;
    }
    setBusyFeedbackId(feedback.id);
    setMessage(null);
    setMutationError(null);
    const operation = `${feedback.id}:${feedback.version}:${disposition}`;
    const idempotencyKey =
      reviewKeys.current.get(operation) ??
      createIdempotencyKey("guide-feedback-review");
    reviewKeys.current.set(operation, idempotencyKey);
    try {
      const reviewed = await api.reviewFeedback(
        feedback.id,
        feedback.version,
        disposition,
        idempotencyKey,
      );
      reviewKeys.current.delete(operation);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              feedback: current.feedback.map((item) =>
                item.id === reviewed.id ? reviewed : item,
              ),
            }
          : current,
      );
      setReviewChoices((current) => ({ ...current, [feedback.id]: "" }));
      setReviewConfirmations((current) => ({
        ...current,
        [feedback.id]: false,
      }));
      setMessage(
        `Feedback review saved as ${reviewed.disposition.toLowerCase()}.`,
      );
    } catch (error) {
      setMutationError(
        guideAdminError(error, "The feedback review could not be completed."),
      );
    } finally {
      setBusyFeedbackId(null);
    }
  }

  async function loadMore(cursor: string) {
    setLoadingMore(true);
    try {
      const page = await api.feedback(cursor);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              feedback: [...current.feedback, ...page.items],
              nextCursor: page.nextCursor,
              paginationError: null,
            }
          : current,
      );
    } catch (error) {
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              paginationError: guideAdminError(
                error,
                "More redacted feedback could not be loaded.",
              ),
            }
          : current,
      );
    } finally {
      setLoadingMore(false);
    }
  }
}

function StatusPill({ state }: { state: AdminGuideSummary["state"] }) {
  return (
    <span
      className={
        state === "ACTIVE"
          ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-900"
          : "rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700"
      }
    >
      {state}
    </span>
  );
}

function guideAdminError(error: unknown, fallback: string) {
  if (error instanceof GuideAdminApiError) {
    if (error.status === 401) {
      return "Your session expired. Sign in again before continuing.";
    }
    if (error.status === 403 || error.status === 404) {
      return "This guide-admin resource is unavailable to the current role.";
    }
    if (error.status === 409) {
      return "The operation conflicts with the latest server state. Refresh before deciding again.";
    }
    if (error.status === 412) {
      return "This record changed in another session. Refresh before retrying.";
    }
    if (error.status === 428) {
      return "The conditional record version was missing. Refresh before retrying.";
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function formatOutcome(outcome: AdminGuideFeedback["outcome"]) {
  return outcome.replaceAll("_", " ").toLowerCase();
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
