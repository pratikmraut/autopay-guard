"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import { Button } from "@/components/ui/button";
import {
  CancellationApi,
  type DecisionAction,
  type DecisionInboxItem,
  type OccurrenceDecision,
} from "@/lib/cancellation-api";
import {
  cancellationLoadErrorMessage,
  cancellationMutationFailure,
} from "@/lib/cancellation-api-messages";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import {
  formatLocalDate,
  formatYearMonth,
  monthRange,
  todayInTimeZone,
} from "@/lib/local-date";
import { formatMinorMoney } from "@/lib/money";

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type InboxState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      items: DecisionInboxItem[];
      nextCursor: string | null;
    };

export function DecisionInboxScreen() {
  const household = useSelectedHousehold();
  const searchParams = useSearchParams();
  const requestedMonth = searchParams.get("month");
  const month =
    requestedMonth && YEAR_MONTH.test(requestedMonth)
      ? requestedMonth
      : todayInTimeZone(household.timezone).slice(0, 7);
  const range = useMemo(() => monthRange(month), [month]);
  const requestKey = `${household.id}:${range.from}:${range.to}`;
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const [state, setState] = useState<InboxState>({
    status: "loading",
    requestKey: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      const page = await api.listDecisionInbox(
        {
          householdId: household.id,
          from: range.from,
          to: range.to,
          limit: 25,
          ...(cursor ? { cursor } : {}),
        },
        { signal },
      );
      if (
        page.householdId !== household.id ||
        page.from !== range.from ||
        page.to !== range.to ||
        page.items.some(
          (item) =>
            item.householdId !== household.id ||
            item.occurrenceId.length === 0 ||
            item.commitmentId.length === 0 ||
            item.reviewActions.length === 0,
        )
      ) {
        throw new Error("The API returned a mismatched decision scope.");
      }
      if (signal?.aborted) {
        return;
      }
      setState((current) =>
        current.requestKey === requestKey
          ? {
              status: "ready",
              requestKey,
              items:
                cursor && current.status === "ready"
                  ? [...current.items, ...page.items]
                  : page.items,
              nextCursor: page.nextCursor,
            }
          : current,
      );
    },
    [api, household.id, range.from, range.to, requestKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setState({ status: "loading", requestKey });
      setLoadMoreError(null);
      void load(undefined, controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            requestKey,
            message: cancellationLoadErrorMessage(error),
          });
        }
      });
    });
    return () => controller.abort();
  }, [load, requestKey]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading decision inbox…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Decision inbox unavailable</strong>
        <p>{state.message}</p>
        <button onClick={() => window.location.reload()} type="button">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="decision-inbox-page">
      <Link
        className="back-link"
        href={`/upcoming?householdId=${encodeURIComponent(household.id)}&month=${encodeURIComponent(month)}`}
      >
        ← Upcoming schedule
      </Link>
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Decision inbox · {formatYearMonth(month)}</p>
          <h1>Record what you plan to do</h1>
          <p>
            These are private tracking decisions. AutoPay Guard does not contact
            a provider, change a payment mandate, or move money.
          </p>
        </div>
        <Link
          className="secondary-link secondary-link--button"
          href={`/dashboard/savings?householdId=${encodeURIComponent(household.id)}`}
        >
          Savings records
        </Link>
      </header>

      {state.items.length === 0 ? (
        <section
          className="notification-empty"
          aria-labelledby="empty-decisions"
        >
          <span aria-hidden="true">✓</span>
          <h2 id="empty-decisions">No occurrences need a decision</h2>
          <p>
            This month has no upcoming tracked occurrences available for a
            category-safe decision.
          </p>
        </section>
      ) : (
        <ol className="decision-list" aria-label="Upcoming renewal decisions">
          {state.items.map((item) => (
            <li key={item.occurrenceId}>
              <OccurrenceDecisionCard
                item={item}
                onSaved={(decision) =>
                  setState((current) =>
                    current.status === "ready" &&
                    current.requestKey === requestKey
                      ? {
                          ...current,
                          items: current.items.map((candidate) =>
                            candidate.occurrenceId === item.occurrenceId
                              ? { ...candidate, currentDecision: decision }
                              : candidate,
                          ),
                        }
                      : current,
                  )
                }
              />
            </li>
          ))}
        </ol>
      )}

      {loadMoreError && (
        <div className="form-alert" role="alert">
          <strong>Could not load more decisions</strong>
          <p>{loadMoreError}</p>
        </div>
      )}
      {state.nextCursor && (
        <div className="notification-load-more">
          <Button
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              setLoadMoreError(null);
              try {
                await load(state.nextCursor ?? undefined);
              } catch (error) {
                setLoadMoreError(cancellationLoadErrorMessage(error));
              } finally {
                setLoadingMore(false);
              }
            }}
            variant="secondary"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function OccurrenceDecisionCard({
  item,
  onSaved,
}: {
  item: DecisionInboxItem;
  onSaved: (decision: OccurrenceDecision) => void;
}) {
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const [selected, setSelected] = useState<DecisionAction>(
    item.currentDecision?.decision ??
      (item.reviewActions.includes("REVIEW")
        ? "REVIEW"
        : (item.reviewActions[0] ?? "TRACK")),
  );
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const submissionRef = useRef<{
    decision: DecisionAction;
    key: string;
  } | null>(null);
  const amount =
    item.expectedAmountMinor === null
      ? "Unknown variable amount"
      : `${item.amountKind === "ESTIMATED" ? "Estimated " : ""}${formatMinorMoney(
          item.expectedAmountMinor,
          item.currency,
        )}`;

  return (
    <article className="decision-card">
      <header>
        <div>
          <p className="card-kicker">
            Due{" "}
            <time dateTime={item.scheduledDate}>
              {formatLocalDate(item.scheduledDate)}
            </time>
          </p>
          <h2>{item.displayName}</h2>
          <p>
            {amount} · {humanize(item.category)}
          </p>
        </div>
        {item.currentDecision && (
          <span className="decision-current">
            Current: {decisionLabel(item.currentDecision.decision)}
          </span>
        )}
      </header>

      {savedMessage && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {savedMessage}
        </div>
      )}
      {error && (
        <div className="form-alert" role="alert">
          <strong>Could not record decision</strong>
          <p>{error}</p>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setSavedMessage(null);
          setConfirming(true);
        }}
      >
        <fieldset className="decision-options" disabled={saving}>
          <legend>Decision for this scheduled occurrence</legend>
          {item.reviewActions.map((action) => (
            <label key={action}>
              <input
                checked={selected === action}
                name={`decision-${item.occurrenceId}`}
                onChange={() => {
                  setSelected(action);
                  setConfirming(false);
                  submissionRef.current = null;
                }}
                type="radio"
                value={action}
              />
              <span>
                <strong>{decisionLabel(action)}</strong>
                <small>{decisionDescription(action)}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {confirming ? (
          <div
            className="decision-confirmation"
            role="group"
            aria-label="Confirm decision"
          >
            <p>
              Record <strong>{decisionLabel(selected)}</strong>? This appends a
              new decision record but performs no provider or payment action.
            </p>
            <div>
              <Button
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setError(null);
                  const submission =
                    submissionRef.current?.decision === selected
                      ? submissionRef.current
                      : {
                          decision: selected,
                          key: createIdempotencyKey("decision"),
                        };
                  submissionRef.current = submission;
                  try {
                    const decision = await api.createDecision(
                      item.occurrenceId,
                      submission.key,
                      selected,
                    );
                    if (
                      decision.occurrenceId !== item.occurrenceId ||
                      decision.commitmentId !== item.commitmentId ||
                      decision.householdId !== item.householdId
                    ) {
                      throw new Error(
                        "The API returned a different decision scope.",
                      );
                    }
                    onSaved(decision);
                    submissionRef.current = null;
                    setConfirming(false);
                    setSavedMessage("Decision recorded. Tracking continues.");
                  } catch (caught) {
                    setError(
                      cancellationMutationFailure(caught, {
                        replayProtected: true,
                      }).message,
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Recording…" : "Record decision"}
              </Button>
              <button
                className="secondary-link"
                disabled={saving}
                onClick={() => setConfirming(false)}
                type="button"
              >
                Go back
              </button>
            </div>
          </div>
        ) : (
          <Button disabled={saving} type="submit" variant="secondary">
            Review decision
          </Button>
        )}
      </form>

      {item.currentDecision?.decision === "CANCEL_WITH_PROVIDER" && (
        <div className="decision-next-step">
          <p>
            Your cancellation decision is recorded. Review the fictional guide
            before starting a tracking attempt.
          </p>
          <Link
            className="primary-link"
            href={`/commitments/${encodeURIComponent(item.commitmentId)}/cancellation?householdId=${encodeURIComponent(item.householdId)}&occurrenceId=${encodeURIComponent(item.occurrenceId)}&decisionId=${encodeURIComponent(item.currentDecision.id)}`}
          >
            Review cancellation guide
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </article>
  );
}

const decisionLabels: Record<DecisionAction, string> = {
  KEEP: "Keep",
  REVIEW: "Review later",
  PAUSE_TRACKING: "Pause AutoPay Guard tracking",
  CANCEL_WITH_PROVIDER: "Plan to cancel with provider",
  DOWNGRADE_WITH_PROVIDER: "Plan to downgrade with provider",
  SWITCH_PROVIDER: "Plan to switch provider",
  CONFIRM_BILL: "Confirm the bill",
  COMPARE_PROVIDERS: "Compare providers",
  DUE_DATE_READINESS: "Check due-date readiness",
  PAYMENT_CONFIRMATION: "Confirm payment",
  RENEWAL_READINESS: "Check renewal readiness",
  TRACK: "Keep tracking",
};

function decisionLabel(action: DecisionAction) {
  return decisionLabels[action];
}

function decisionDescription(action: DecisionAction) {
  if (action === "PAUSE_TRACKING") {
    return "This changes only your recorded plan, not a provider or payment.";
  }
  if (
    action === "CANCEL_WITH_PROVIDER" ||
    action === "DOWNGRADE_WITH_PROVIDER" ||
    action === "SWITCH_PROVIDER"
  ) {
    return "You will perform any external action yourself.";
  }
  return "Record this choice for the scheduled occurrence.";
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
