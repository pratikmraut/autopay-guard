"use client";

import {
  ApiClientError,
  FoundationApi,
  type Commitment,
} from "@autopay-guard/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import { commitmentCategories, labelForOption } from "@/lib/commitment-options";
import type { HouseholdAccessDto } from "@/lib/household-api";
import { formatLocalDate } from "@/lib/local-date";
import { formatMinorMoney } from "@/lib/money";

type ListState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      items: Commitment[];
      nextCursor: string | null;
    };

export function CommitmentListScreen() {
  const household = useSelectedHousehold();
  const searchParams = useSearchParams();
  const api = useMemo(() => new FoundationApi({ baseUrl: "/api/bff" }), []);
  const requestKey = household.id;
  const [state, setState] = useState<ListState>({
    status: "loading",
    requestKey: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const canManage =
    (household as typeof household & Partial<HouseholdAccessDto>).canManage ===
    true;

  const load = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      const page = await api.listCommitments(
        {
          householdId: requestKey,
          limit: 50,
          includeArchived: false,
          ...(cursor ? { cursor } : {}),
        },
        { signal },
      );
      if (page.items.some((item) => item.householdId !== requestKey)) {
        throw new Error("The API returned a mismatched commitment scope.");
      }
      if (signal?.aborted) {
        return;
      }
      setState((current) => ({
        ...(current.requestKey === requestKey
          ? {
              status: "ready" as const,
              requestKey,
              items:
                cursor && current.status === "ready"
                  ? [...current.items, ...page.items]
                  : page.items,
              nextCursor: page.nextCursor,
            }
          : current),
      }));
    },
    [api, requestKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setState({ status: "loading", requestKey });
      setLoadingMore(false);
      setLoadMoreError(null);
      load(undefined, controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  status: "error",
                  requestKey,
                  message: safeLoadMessage(error),
                }
              : current,
          );
        }
      });
    });
    return () => controller.abort();
  }, [load, requestKey]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading recurring commitments…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Commitments unavailable</strong>
        <p>{state.message}</p>
        <button onClick={() => window.location.reload()} type="button">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="commitments-page">
      {searchParams.get("archived") === "1" && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          Commitment archived from tracking. No provider action was taken.
        </div>
      )}
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Recurring commitments</p>
          <h1>Everything you choose to track</h1>
          <p>
            Amounts, schedules, and payment rails for {household.name}. No bank
            connection is used.
            {!canManage &&
              " This list and its totals cover only records visible to you."}
          </p>
        </div>
        {canManage && (
          <div className="resource-heading__actions">
            <Link
              className="secondary-link"
              data-testid="import-commitments-link"
              href={`/imports?householdId=${encodeURIComponent(household.id)}`}
            >
              Import CSV
            </Link>
            <Link
              className="primary-link"
              data-testid="add-commitment-link"
              href={`/commitments/new?householdId=${encodeURIComponent(household.id)}`}
            >
              Add commitment
              <span aria-hidden="true">＋</span>
            </Link>
          </div>
        )}
      </header>

      {state.items.length === 0 ? (
        <section
          className="commitment-empty"
          aria-labelledby="empty-commitments"
        >
          <div aria-hidden="true">₹</div>
          <p className="card-kicker">A clean list</p>
          <h2 id="empty-commitments">
            {canManage
              ? "No recurring commitments yet"
              : "No shared commitments yet"}
          </h2>
          <p>
            {canManage
              ? "Add a fictional local commitment manually. Never enter a PIN, OTP, password, or full payment identifier."
              : "The household owner has not shared a commitment visible to your currently consented membership."}
          </p>
          {canManage && (
            <Link
              className="primary-link mt-5"
              href={`/commitments/new?householdId=${encodeURIComponent(household.id)}`}
            >
              Add the first commitment
            </Link>
          )}
        </section>
      ) : (
        <>
          <div className="commitment-table-wrap">
            <table className="commitment-table">
              <caption className="sr-only">
                Active and paused recurring commitments in {household.name}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Commitment</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Next due</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Open details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((commitment) => (
                  <tr key={commitment.id}>
                    <td>
                      <Link
                        href={`/commitments/${encodeURIComponent(commitment.id)}?householdId=${encodeURIComponent(household.id)}`}
                      >
                        <strong>{commitment.displayName}</strong>
                        <small>
                          {labelForOption(
                            commitmentCategories,
                            commitment.category,
                          )}
                          {commitment.merchantCanonicalName
                            ? ` · ${commitment.merchantCanonicalName}`
                            : ""}
                        </small>
                      </Link>
                    </td>
                    <td>
                      <AmountLabel commitment={commitment} />
                    </td>
                    <td>
                      {commitment.nextDueDate
                        ? formatLocalDate(commitment.nextDueDate)
                        : "No upcoming date"}
                    </td>
                    <td>
                      <span
                        className={`status-chip status-chip--${commitment.status.toLowerCase()}`}
                      >
                        {commitment.status === "PAUSED" ? "Paused" : "Active"}
                      </span>
                    </td>
                    <td>
                      <Link
                        aria-label={`Open ${commitment.displayName}`}
                        className="row-open-link"
                        href={`/commitments/${encodeURIComponent(commitment.id)}?householdId=${encodeURIComponent(household.id)}`}
                      >
                        →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.nextCursor && (
            <>
              {loadMoreError && (
                <div className="pagination-error" role="alert">
                  <strong>More commitments unavailable</strong>
                  <p>{loadMoreError}</p>
                </div>
              )}
              <button
                className="load-more-button"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  setLoadMoreError(null);
                  try {
                    await load(state.nextCursor ?? undefined);
                  } catch (error) {
                    setLoadMoreError(safeLoadMoreMessage(error));
                  } finally {
                    setLoadingMore(false);
                  }
                }}
                type="button"
              >
                {loadingMore
                  ? "Loading more…"
                  : loadMoreError
                    ? "Try loading more commitments"
                    : "Load more commitments"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function AmountLabel({
  commitment,
}: {
  commitment: Pick<
    Commitment,
    "variableAmount" | "amountMinor" | "estimatedAmountMinor" | "currency"
  >;
}) {
  if (!commitment.variableAmount && commitment.amountMinor !== null) {
    return (
      <span className="amount-label">
        <strong>
          {formatMinorMoney(commitment.amountMinor, commitment.currency)}
        </strong>
        <small>Fixed</small>
      </span>
    );
  }
  if (commitment.variableAmount && commitment.estimatedAmountMinor !== null) {
    return (
      <span className="amount-label amount-label--estimated">
        <strong>
          ≈{" "}
          {formatMinorMoney(
            commitment.estimatedAmountMinor,
            commitment.currency,
          )}
        </strong>
        <small>Estimated variable</small>
      </span>
    );
  }
  return (
    <span className="amount-label amount-label--unknown">
      <strong>Unknown</strong>
      <small>Variable amount</small>
    </span>
  );
}

function safeLoadMessage(error: unknown) {
  return error instanceof ApiClientError && error.status === 401
    ? "Your session expired. Sign in again."
    : "The API could not return this workspace's commitments.";
}

function safeLoadMoreMessage(error: unknown) {
  return error instanceof ApiClientError && error.status === 401
    ? "Your session expired. Sign in again."
    : "The next page could not be loaded. The commitments already shown are unchanged.";
}
