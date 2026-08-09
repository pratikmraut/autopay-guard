"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import { Button } from "@/components/ui/button";
import {
  CancellationApi,
  type SavingsCurrencySummary,
  type SavingsItem,
  type SavingsState,
} from "@/lib/cancellation-api";
import { cancellationLoadErrorMessage } from "@/lib/cancellation-api-messages";
import { formatLocalDate } from "@/lib/local-date";
import { formatMinorMoney } from "@/lib/money";

const savingsStates: SavingsState[] = [
  "POTENTIAL",
  "SELF_REPORTED",
  "VERIFIED",
  "REVERSED",
];

type SavingsStateView =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      asOf: string;
      currencies: SavingsCurrencySummary[];
      unquantifiedCount: number;
      items: SavingsItem[];
      nextCursor: string | null;
    };

export function SavingsDashboardScreen() {
  const household = useSelectedHousehold();
  const searchParams = useSearchParams();
  const filter = parseSavingsState(searchParams.get("state"));
  const requestKey = `${household.id}:${filter ?? "ALL"}`;
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const [state, setState] = useState<SavingsStateView>({
    status: "loading",
    requestKey: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      const page = await api.getSavings(
        {
          householdId: household.id,
          ...(filter ? { state: filter } : {}),
          ...(cursor ? { cursor } : {}),
          limit: 25,
        },
        { signal },
      );
      if (
        page.householdId !== household.id ||
        page.items.some(
          (item) =>
            item.commitmentId.length === 0 || item.attemptId.length === 0,
        )
      ) {
        throw new Error("The API returned a mismatched savings scope.");
      }
      if (signal?.aborted) {
        return;
      }
      setState((current) =>
        current.requestKey === requestKey
          ? {
              status: "ready",
              requestKey,
              asOf: page.asOf,
              currencies: page.currencies,
              unquantifiedCount: page.unquantifiedCount,
              items:
                cursor && current.status === "ready"
                  ? [...current.items, ...page.items]
                  : page.items,
              nextCursor: page.nextCursor,
            }
          : current,
      );
    },
    [api, filter, household.id, requestKey],
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
        Loading honest savings records…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Savings records unavailable</strong>
        <p>{state.message}</p>
        <button onClick={() => window.location.reload()} type="button">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="savings-dashboard-page">
      <Link
        className="back-link"
        href={`/dashboard?householdId=${encodeURIComponent(household.id)}`}
      >
        ← Dashboard
      </Link>
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Current-state records</p>
          <h1>Honest savings</h1>
          <p>
            Potential, self-reported, user-confirmed-after-due-date, and
            reversed amounts stay separate by currency. They are never added
            into one headline total.
          </p>
          <p>Exact and estimated projections also stay in separate buckets.</p>
        </div>
        <Link
          className="secondary-link secondary-link--button"
          href={`/upcoming/decisions?householdId=${encodeURIComponent(household.id)}`}
        >
          Decision inbox
        </Link>
      </header>

      <aside className="savings-boundary-note">
        <strong>Records, not bank proof or advice</strong>
        <p>
          AutoPay Guard uses the saved recurrence snapshot. It has no bank feed,
          provider confirmation, currency conversion, refund action, or
          independent verification source.
        </p>
      </aside>

      {state.currencies.length === 0 ? (
        <section className="notification-empty" aria-labelledby="no-savings">
          <span aria-hidden="true">₹</span>
          <h2 id="no-savings">No quantified savings records yet</h2>
          <p>
            Starting an eligible cancellation attempt creates a potential
            record. Unknown variable amounts stay unquantified.
          </p>
          <Link
            className="secondary-link"
            href={`/upcoming/decisions?householdId=${encodeURIComponent(household.id)}`}
          >
            Review upcoming decisions
          </Link>
        </section>
      ) : (
        <div className="savings-currency-list">
          {state.currencies.map((currency) => (
            <SavingsCurrencySection
              currency={currency}
              key={currency.currency}
            />
          ))}
        </div>
      )}

      {state.unquantifiedCount > 0 && (
        <section
          className="unquantified-savings"
          aria-label="Unquantified attempts"
        >
          <strong>{state.unquantifiedCount} unquantified attempt(s)</strong>
          <p>
            Unknown variable amounts are kept unknown and are not represented as
            zero in any total.
          </p>
        </section>
      )}

      <nav className="notification-filters" aria-label="Savings record filter">
        <Link
          aria-current={!filter ? "page" : undefined}
          href={`/dashboard/savings?householdId=${encodeURIComponent(household.id)}`}
        >
          All
        </Link>
        {savingsStates.map((candidate) => (
          <Link
            aria-current={filter === candidate ? "page" : undefined}
            href={`/dashboard/savings?householdId=${encodeURIComponent(household.id)}&state=${candidate}`}
            key={candidate}
          >
            {shortStateLabel(candidate)}
          </Link>
        ))}
      </nav>

      <section className="savings-records" aria-labelledby="savings-records">
        <div>
          <p className="card-kicker">As of {formatInstant(state.asOf)}</p>
          <h2 id="savings-records">Attempt records</h2>
        </div>
        {state.items.length === 0 ? (
          <p className="savings-records-empty">
            No records match this current-state filter.
          </p>
        ) : (
          <ol>
            {state.items.map((item) => (
              <li key={item.attemptId}>
                <div>
                  <span
                    className={`savings-state savings-state--${item.state.toLowerCase()}`}
                  >
                    {stateLabel(item.state)}
                  </span>
                  <strong>{item.displayName}</strong>
                  <small>
                    {formatLocalDate(item.periodStart)} –{" "}
                    {formatLocalDate(item.periodEnd)}
                    {item.estimated ? " · Estimated" : ""}
                    {item.reversalReason
                      ? ` · ${reversalLabel(item.reversalReason)}`
                      : ""}
                  </small>
                </div>
                <div>
                  <strong>
                    {item.amountMinor === null
                      ? "Unquantified"
                      : `${item.estimated ? "≈ " : ""}${formatMinorMoney(
                          item.amountMinor,
                          item.currency,
                        )}`}
                  </strong>
                  <Link
                    href={`/commitments/${encodeURIComponent(item.commitmentId)}/cancellation/attempts/${encodeURIComponent(item.attemptId)}?householdId=${encodeURIComponent(household.id)}`}
                  >
                    Open attempt
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {loadMoreError && (
        <div className="form-alert" role="alert">
          <strong>Could not load more records</strong>
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

function SavingsCurrencySection({
  currency,
}: {
  currency: SavingsCurrencySummary;
}) {
  const totals = new Map(currency.totals.map((total) => [total.state, total]));
  return (
    <section
      className="savings-currency-section"
      aria-labelledby={`savings-${currency.currency}`}
    >
      <header>
        <p className="card-kicker">No currency conversion</p>
        <h2 id={`savings-${currency.currency}`}>{currency.currency}</h2>
      </header>
      <div className="savings-state-grid">
        {savingsStates.map((state) => {
          const total = totals.get(state);
          const exactAmountMinor = total?.exactAmountMinor ?? 0;
          const estimatedAmountMinor = total?.estimatedAmountMinor ?? 0;
          const exactAttemptCount = total?.exactAttemptCount ?? 0;
          const estimatedAttemptCount = total?.estimatedAttemptCount ?? 0;
          const hasExact = exactAmountMinor !== 0 || exactAttemptCount !== 0;
          const hasEstimated =
            estimatedAmountMinor !== 0 || estimatedAttemptCount !== 0;
          return (
            <article key={state}>
              <span
                className={`savings-state savings-state--${state.toLowerCase()}`}
              >
                {stateLabel(state)}
              </span>
              <div
                aria-label={`${stateLabel(state)} amount buckets`}
                className="savings-amount-breakdown"
              >
                {hasExact && (
                  <div className="savings-amount-bucket">
                    <span>Exact projection</span>
                    <strong>
                      {formatMinorMoney(exactAmountMinor, currency.currency)}
                    </strong>
                    <small>
                      {attemptCountLabel(exactAttemptCount, "exact")}
                    </small>
                  </div>
                )}
                {hasEstimated && (
                  <div className="savings-amount-bucket savings-amount-bucket--estimated">
                    <span>Estimated projection</span>
                    <strong>
                      ≈{" "}
                      {formatMinorMoney(
                        estimatedAmountMinor,
                        currency.currency,
                      )}
                    </strong>
                    <small>
                      {attemptCountLabel(estimatedAttemptCount, "estimated")}
                    </small>
                  </div>
                )}
                {!hasExact && !hasEstimated && (
                  <p className="savings-empty-state-total">
                    No current attempts
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="savings-no-total">
        These four states and their exact/estimated buckets are mutually
        separated and are not summed.
      </p>
    </section>
  );
}

function parseSavingsState(value: string | null): SavingsState | null {
  return savingsStates.includes(value as SavingsState)
    ? (value as SavingsState)
    : null;
}

function stateLabel(state: SavingsState) {
  return {
    POTENTIAL: "Potential only",
    SELF_REPORTED: "External steps self-reported",
    VERIFIED: "User-confirmed after due date",
    REVERSED: "Reversed",
  }[state];
}

function shortStateLabel(state: SavingsState) {
  return {
    POTENTIAL: "Potential",
    SELF_REPORTED: "Self-reported",
    VERIFIED: "User-confirmed",
    REVERSED: "Reversed",
  }[state];
}

function reversalLabel(reason: NonNullable<SavingsItem["reversalReason"]>) {
  return reason === "ABANDONED" ? "Attempt abandoned" : "Debit later reported";
}

function attemptCountLabel(count: number, qualifier: "exact" | "estimated") {
  return `${count} ${qualifier} current ${count === 1 ? "attempt" : "attempts"}`;
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
