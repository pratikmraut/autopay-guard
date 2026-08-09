"use client";

import {
  ApiClientError,
  FoundationApi,
  type DashboardSummary,
} from "@autopay-guard/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import { ProjectionBreakdown } from "@/components/projection-breakdown";
import type { HouseholdAccessDto } from "@/lib/household-api";
import {
  addLocalMonths,
  formatYearMonth,
  todayInTimeZone,
} from "@/lib/local-date";

type DashboardState =
  | { status: "loading" }
  | { status: "error"; key: string; message: string }
  | { status: "ready"; key: string; summary: DashboardSummary };

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function DashboardScreen({
  firstName,
  onboarded,
}: {
  firstName: string;
  onboarded: boolean;
}) {
  const household = useSelectedHousehold();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedMonth = searchParams.get("month");
  const month =
    requestedMonth && YEAR_MONTH.test(requestedMonth)
      ? requestedMonth
      : todayInTimeZone(household.timezone).slice(0, 7);
  const api = useMemo(() => new FoundationApi({ baseUrl: "/api/bff" }), []);
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const requestKey = `${household.id}:${month}`;
  const canManage =
    (household as typeof household & Partial<HouseholdAccessDto>).canManage ===
    true;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const summary = await api.getDashboardSummary(
          { householdId: household.id, month },
          { signal },
        );
        if (summary.householdId !== household.id || summary.month !== month) {
          throw new Error("The API returned a mismatched dashboard scope.");
        }
        setState({ status: "ready", key: requestKey, summary });
      } catch (error) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            key: requestKey,
            message:
              error instanceof ApiClientError && error.status === 401
                ? "Your session expired. Sign in again."
                : "The API could not calculate this workspace summary.",
          });
        }
      }
    },
    [api, household.id, month, requestKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const chooseMonth = (offset: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("month", addLocalMonths(month, offset));
    router.replace(`/dashboard?${next.toString()}`);
  };
  const visibleState =
    state.status === "loading" || state.key === requestKey
      ? state
      : ({ status: "loading" } satisfies DashboardState);

  return (
    <div className="dashboard-page">
      {onboarded && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          Your private workspace is ready.
        </div>
      )}

      <header className="dashboard-heading">
        <div>
          <p className="eyebrow">Your dashboard</p>
          <h1>Good to see you, {firstName}.</h1>
          <p>
            Exact recurring projections for {household.name}, without a bank
            connection or currency conversion.
            {!canManage &&
              " Counts and totals cover only records visible to you."}
          </p>
        </div>
        <div className="month-switcher" aria-label="Dashboard month">
          <button
            aria-label="Previous month"
            onClick={() => chooseMonth(-1)}
            type="button"
          >
            ←
          </button>
          <strong>{formatYearMonth(month)}</strong>
          <button
            aria-label="Next month"
            onClick={() => chooseMonth(1)}
            type="button"
          >
            →
          </button>
        </div>
      </header>

      {visibleState.status === "loading" && (
        <div className="resource-state resource-state--loading" role="status">
          <span className="loading-pulse" aria-hidden="true" />
          Calculating exact projections…
        </div>
      )}
      {visibleState.status === "error" && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>Summary unavailable</strong>
          <p>{visibleState.message}</p>
          <button onClick={() => void load()} type="button">
            Try again
          </button>
        </div>
      )}
      {visibleState.status === "ready" && (
        <DashboardSummaryContent
          canManage={canManage}
          householdId={household.id}
          summary={visibleState.summary}
        />
      )}
    </div>
  );
}

export function DashboardSummaryContent({
  canManage = true,
  householdId,
  summary,
}: {
  canManage?: boolean;
  householdId: string;
  summary: DashboardSummary;
}) {
  return (
    <>
      <section className="summary-grid" aria-label="Commitment counts">
        <article className="summary-card">
          <p>Active commitments</p>
          <strong>{summary.activeCommitmentCount}</strong>
          <span>Included in projections</span>
        </article>
        <article className="summary-card">
          <p>Variable commitments</p>
          <strong>{summary.variableCommitmentCount}</strong>
          <span>Estimates stay marked</span>
        </article>
        <article className="summary-card">
          <p>Unknown variable amounts</p>
          <strong>{summary.unknownVariableCommitmentCount}</strong>
          <span>Excluded from known totals</span>
        </article>
      </section>

      {summary.activeCommitmentCount === 0 ? (
        <section className="commitment-empty" aria-labelledby="empty-title">
          <div aria-hidden="true">₹</div>
          <p className="card-kicker">A clean start</p>
          <h2 id="empty-title">No recurring commitments yet</h2>
          <p>
            Add a fictional commitment manually. Never enter a PIN, OTP,
            password, or full payment identifier.
          </p>
          {canManage && (
            <Link
              className="primary-link mt-5"
              href={`/commitments/new?householdId=${encodeURIComponent(householdId)}`}
            >
              Add a commitment
            </Link>
          )}
        </section>
      ) : (
        <section
          className="dashboard-projections"
          aria-label="Exact projections"
        >
          <article className="projection-panel">
            <header>
              <div>
                <p className="card-kicker">Calendar month</p>
                <h2>{formatYearMonth(summary.month)}</h2>
              </div>
              <span>Not prorated</span>
            </header>
            <ProjectionBreakdown period={summary.monthlyProjection} />
          </article>
          <article className="projection-panel">
            <header>
              <div>
                <p className="card-kicker">12-month projection</p>
                <h2>Forward schedule</h2>
              </div>
              <span>No FX conversion</span>
            </header>
            <ProjectionBreakdown period={summary.annualizedProjection} />
          </article>
        </section>
      )}

      <section className="dashboard-next">
        <div>
          <p className="card-kicker">See every date</p>
          <h2>Upcoming list and calendar</h2>
          <p>
            Fixed, estimated, and unknown variable amounts remain visibly
            distinct on every occurrence.
          </p>
        </div>
        <Link
          className="primary-link"
          href={`/upcoming?householdId=${encodeURIComponent(householdId)}&month=${encodeURIComponent(summary.month)}`}
        >
          Open upcoming
          <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="dashboard-next">
        <div>
          <p className="card-kicker">Keep every state honest</p>
          <h2>Cancellation and savings records</h2>
          <p>
            Potential, self-reported, user-confirmed-after-due-date, and
            reversed amounts remain separate by currency.
          </p>
        </div>
        <Link
          className="secondary-link secondary-link--button"
          href={`/dashboard/savings?householdId=${encodeURIComponent(householdId)}`}
        >
          Open savings records
          <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}
