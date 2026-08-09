"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createIdempotencyKey } from "@/lib/idempotency-key";
import {
  PrivacyApi,
  PrivacyApiError,
  type PrivacyRequest,
} from "@/lib/privacy-api";

type QueueState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      requests: PrivacyRequest[];
      nextCursor: string | null;
    };

export function AdminPrivacyQueueScreen() {
  const api = useMemo(() => new PrivacyApi(), []);
  const [state, setState] = useState<QueueState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await api.adminRequests(signal);
        if (!signal?.aborted) {
          setState({
            status: "ready",
            requests: page.items,
            nextCursor: page.nextCursor,
          });
        }
      } catch (cause) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "The privacy queue could not be loaded.",
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
        Loading privacy request queue…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Privacy queue unavailable</strong>
        <p>{state.message}</p>
      </div>
    );
  }

  const selected =
    state.requests.find((request) => request.id === selectedId) ?? null;
  const expectedConfirmation = selected
    ? `EXECUTE ${selected.requestType}`
    : "";

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">PRIVACY_ADMIN only</p>
          <h1>Privacy request queue</h1>
          <p>
            Execute bounded local export, timezone-correction, or deletion
            workflows. This authority does not grant export download, household
            membership, audit access, support access, or identity-provider
            deletion.
          </p>
        </div>
        <button
          className="secondary-link secondary-link--button"
          onClick={() => {
            setState({ status: "loading" });
            void load();
          }}
          type="button"
        >
          Refresh queue
        </button>
      </header>

      {message && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {message}
        </div>
      )}
      {error && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>Request not executed</strong>
          <p>{error}</p>
        </div>
      )}

      {state.requests.length === 0 ? (
        <div className="resource-state">
          <strong>No privacy requests</strong>
          <p>The bounded local queue is empty.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {state.requests.map((request) => {
              const selectable = request.status === "REQUESTED";
              return (
                <article
                  className="notification-settings-card"
                  key={request.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="card-kicker">{request.requestType}</p>
                      <h2 className="mt-2 text-2xl font-black text-emerald-950">
                        {request.id}
                      </h2>
                      <p className="mt-2 text-sm text-slate-600">
                        Created {formatInstant(request.createdAt)} · version{" "}
                        {request.version}
                      </p>
                      {request.correctionValue && (
                        <p className="mt-2 text-sm">
                          Requested app timezone:{" "}
                          <strong>{request.correctionValue}</strong>
                        </p>
                      )}
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-900">
                      {request.status}
                    </span>
                  </div>
                  {selectable && (
                    <label className="mt-5 flex items-center gap-3 font-bold">
                      <input
                        checked={selectedId === request.id}
                        name="privacy-request"
                        onChange={() => {
                          setSelectedId(request.id);
                          setConfirmation("");
                          setError(null);
                        }}
                        type="radio"
                      />
                      Select for conditional execution
                    </label>
                  )}
                </article>
              );
            })}
          </div>
          {state.nextCursor && (
            <button
              className="secondary-link secondary-link--button"
              disabled={busy || pageBusy}
              onClick={() => void loadMore(state.nextCursor!)}
              type="button"
            >
              {pageBusy ? "Loading…" : "Load more privacy requests"}
            </button>
          )}
        </>
      )}

      {selected && (
        <section className="notification-settings-card">
          <div className="settings-card-heading">
            <p className="card-kicker">Explicit confirmation</p>
            <h2>Execute {selected.requestType.toLowerCase()}</h2>
            <p>
              The API rechecks status, ETag, subject eligibility, and the
              fake-local boundary in one transaction. Deletion can be blocked
              without changing household or user data.
            </p>
          </div>
          <label className="field-label mt-5" htmlFor="execute-confirmation">
            Type {expectedConfirmation}
          </label>
          <input
            autoComplete="off"
            className="form-input"
            id="execute-confirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            value={confirmation}
          />
          <button
            className="primary-action mt-4"
            disabled={confirmation !== expectedConfirmation || busy}
            onClick={() => void execute(selected)}
            type="button"
          >
            {busy ? "Executing…" : "Execute conditional local operation"}
          </button>
        </section>
      )}
    </div>
  );

  async function execute(request: PrivacyRequest) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.executeRequest(
        request.id,
        request.version,
        createIdempotencyKey("privacy-admin-execute"),
      );
      setMessage(
        updated.status === "BLOCKED"
          ? "Execution was safely blocked; household and user data were preserved."
          : `Privacy request moved to ${updated.status}.`,
      );
      setSelectedId(null);
      setConfirmation("");
      await load();
    } catch (cause) {
      setError(adminError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(cursor: string) {
    setPageBusy(true);
    setError(null);
    try {
      const page = await api.adminRequests(undefined, cursor);
      setState((current) => {
        if (current.status !== "ready") {
          return current;
        }
        const known = new Set(current.requests.map((request) => request.id));
        return {
          status: "ready",
          requests: [
            ...current.requests,
            ...page.items.filter((request) => !known.has(request.id)),
          ],
          nextCursor: page.nextCursor,
        };
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The next privacy queue page could not be loaded.",
      );
    } finally {
      setPageBusy(false);
    }
  }
}

function adminError(error: unknown) {
  if (error instanceof PrivacyApiError && error.status === 412) {
    return "The request changed in another session. Refresh before executing.";
  }
  if (error instanceof PrivacyApiError && error.status === 409) {
    return "The request is no longer eligible for this transition.";
  }
  return error instanceof Error
    ? error.message
    : "The privacy request could not be executed.";
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
