"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AuditApi, type AuditEvent } from "@/lib/audit-api";

type AuditState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      items: AuditEvent[];
      nextCursor: string | null;
      paginationError: string | null;
    };

export function AdminAuditScreen() {
  const api = useMemo(() => new AuditApi(), []);
  const [state, setState] = useState<AuditState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await api.list(undefined, signal);
        if (!signal?.aborted) {
          setState({
            status: "ready",
            items: page.items,
            nextCursor: page.nextCursor,
            paginationError: null,
          });
        }
      } catch (error) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "The audit view could not be loaded.",
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
        Loading redacted audit events…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Local audit unavailable</strong>
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">AUDIT_READ only</p>
          <h1>Local application audit</h1>
          <p>
            Append-only, allowlisted application metadata. This is not a legal
            compliance report or a complete infrastructure audit; it contains no
            identity, title, amount, note, request body, target, token, code,
            digest, or export content.
          </p>
        </div>
      </header>

      {state.items.length === 0 ? (
        <div className="resource-state">
          <strong>No audit events</strong>
          <p>The bounded local event view is empty.</p>
        </div>
      ) : (
        <div
          aria-label="Redacted audit events"
          className="overflow-x-auto rounded-3xl border border-emerald-950/10 bg-white"
          role="region"
          tabIndex={0}
        >
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Redacted local application audit events
            </caption>
            <thead>
              <tr className="border-b border-emerald-950/10 text-xs tracking-wider text-slate-600 uppercase">
                <th className="p-4">Time</th>
                <th className="p-4">Actor role</th>
                <th className="p-4">Action</th>
                <th className="p-4">Resource</th>
                <th className="p-4">Outcome</th>
                <th className="p-4">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((event) => (
                <tr
                  className="border-b border-emerald-950/5 last:border-0"
                  key={event.id}
                >
                  <td className="p-4">{formatInstant(event.occurredAt)}</td>
                  <td className="p-4 font-bold">{event.actorRole}</td>
                  <td className="p-4">{event.action}</td>
                  <td className="p-4">
                    <span className="font-bold">{event.resourceType}</span>
                    <br />
                    <span className="font-mono text-xs text-slate-500">
                      {event.resourceId}
                    </span>
                  </td>
                  <td className="p-4">{event.outcome}</td>
                  <td className="p-4 font-mono text-xs">
                    {event.correlationId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state.paginationError && (
        <p className="field-error" role="alert">
          {state.paginationError}
        </p>
      )}
      {state.nextCursor && (
        <button
          className="secondary-link secondary-link--button justify-self-start"
          disabled={loadingMore}
          onClick={() => void loadMore(state.nextCursor!)}
          type="button"
        >
          {loadingMore ? "Loading…" : "Load older events"}
        </button>
      )}
    </div>
  );

  async function loadMore(cursor: string) {
    setLoadingMore(true);
    try {
      const page = await api.list(cursor);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              items: [...current.items, ...page.items],
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
              paginationError:
                error instanceof Error
                  ? error.message
                  : "Older events could not be loaded.",
            }
          : current,
      );
    } finally {
      setLoadingMore(false);
    }
  }
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
