"use client";

import {
  ApiClientError,
  FoundationApi,
  type DashboardCalendar,
  type UpcomingItem,
  type UpcomingList,
} from "@autopay-guard/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ReviewActionChips } from "@/components/category-guidance";
import { useSelectedHousehold } from "@/components/household-scope";
import { ProjectionBreakdown } from "@/components/projection-breakdown";
import { upcomingAmountLabel } from "@/lib/commitment-display";
import { commitmentCategories, labelForOption } from "@/lib/commitment-options";
import type { HouseholdAccessDto } from "@/lib/household-api";
import {
  addLocalMonths,
  calendarWeeks,
  formatYearMonth,
  monthRange,
  todayInTimeZone,
} from "@/lib/local-date";

type UpcomingState =
  | { status: "loading" }
  | { status: "error"; key: string; message: string }
  | {
      status: "ready";
      key: string;
      upcoming: UpcomingList;
      calendar: DashboardCalendar;
    };

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function UpcomingScreen() {
  const household = useSelectedHousehold();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedMonth = searchParams.get("month");
  const month =
    requestedMonth && YEAR_MONTH.test(requestedMonth)
      ? requestedMonth
      : todayInTimeZone(household.timezone).slice(0, 7);
  const view = searchParams.get("view") === "calendar" ? "calendar" : "list";
  const range = useMemo(() => monthRange(month), [month]);
  const api = useMemo(() => new FoundationApi({ baseUrl: "/api/bff" }), []);
  const [state, setState] = useState<UpcomingState>({ status: "loading" });
  const requestKey = `${household.id}:${range.from}:${range.to}`;
  const canManage =
    (household as typeof household & Partial<HouseholdAccessDto>).canManage ===
    true;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [upcoming, calendar] = await Promise.all([
          api.listUpcomingCommitments(
            {
              householdId: household.id,
              from: range.from,
              to: range.to,
            },
            { signal },
          ),
          api.getDashboardCalendar(
            {
              householdId: household.id,
              from: range.from,
              to: range.to,
            },
            { signal },
          ),
        ]);
        if (
          upcoming.householdId !== household.id ||
          calendar.householdId !== household.id ||
          upcoming.from !== range.from ||
          upcoming.to !== range.to ||
          calendar.from !== range.from ||
          calendar.to !== range.to
        ) {
          throw new Error("The API returned a mismatched upcoming scope.");
        }
        setState({
          status: "ready",
          key: requestKey,
          upcoming,
          calendar,
        });
      } catch (error) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            key: requestKey,
            message:
              error instanceof ApiClientError && error.status === 401
                ? "Your session expired. Sign in again."
                : "The API could not return this month's upcoming schedule.",
          });
        }
      }
    },
    [api, household.id, range.from, range.to, requestKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const updateQuery = (nextMonth: string, nextView = view) => {
    const next = new URLSearchParams(searchParams);
    next.set("month", nextMonth);
    if (nextView === "calendar") {
      next.set("view", "calendar");
    } else {
      next.delete("view");
    }
    router.replace(`/upcoming?${next.toString()}`);
  };
  const visibleState =
    state.status === "loading" || state.key === requestKey
      ? state
      : ({ status: "loading" } satisfies UpcomingState);

  return (
    <div className="upcoming-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Upcoming commitments</p>
          <h1>Know what is expected, and when</h1>
          <p>
            A deterministic schedule for {household.name}. This is tracking
            only—no payment or provider action happens here.
            {!canManage &&
              " Dates and totals cover only records visible to you."}
          </p>
        </div>
        {canManage && (
          <Link
            className="secondary-link secondary-link--button"
            href={`/upcoming/decisions?householdId=${encodeURIComponent(household.id)}&month=${encodeURIComponent(month)}`}
          >
            Open decision inbox
          </Link>
        )}
      </header>

      <div className="upcoming-controls">
        <div className="month-switcher" aria-label="Upcoming month">
          <button
            aria-label="Previous month"
            onClick={() => updateQuery(addLocalMonths(month, -1))}
            type="button"
          >
            ←
          </button>
          <strong>{formatYearMonth(month)}</strong>
          <button
            aria-label="Next month"
            onClick={() => updateQuery(addLocalMonths(month, 1))}
            type="button"
          >
            →
          </button>
        </div>
        <div className="view-switcher" aria-label="Upcoming view">
          <button
            aria-pressed={view === "list"}
            onClick={() => updateQuery(month, "list")}
            type="button"
          >
            List
          </button>
          <button
            aria-pressed={view === "calendar"}
            onClick={() => updateQuery(month, "calendar")}
            type="button"
          >
            Calendar
          </button>
        </div>
      </div>

      {visibleState.status === "loading" && (
        <div className="resource-state resource-state--loading" role="status">
          <span className="loading-pulse" aria-hidden="true" />
          Loading the upcoming schedule…
        </div>
      )}
      {visibleState.status === "error" && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>Upcoming schedule unavailable</strong>
          <p>{visibleState.message}</p>
          <button onClick={() => void load()} type="button">
            Try again
          </button>
        </div>
      )}
      {visibleState.status === "ready" &&
        (view === "list" ? (
          <UpcomingListView
            householdId={household.id}
            items={visibleState.upcoming.items}
          />
        ) : (
          <UpcomingCalendarView
            calendar={visibleState.calendar}
            householdId={household.id}
            month={month}
          />
        ))}
    </div>
  );
}

function UpcomingListView({
  items,
  householdId,
}: {
  items: UpcomingItem[];
  householdId: string;
}) {
  if (items.length === 0) {
    return <UpcomingEmpty householdId={householdId} />;
  }
  return (
    <ol className="upcoming-list" aria-label="Upcoming recurring occurrences">
      {items.map((item) => {
        const amount = upcomingAmountLabel(item);
        return (
          <li key={item.id}>
            <time dateTime={item.scheduledDate}>
              <span>
                {new Date(`${item.scheduledDate}T00:00:00Z`).toLocaleDateString(
                  "en-IN",
                  { day: "2-digit", timeZone: "UTC" },
                )}
              </span>
              <small>
                {new Date(`${item.scheduledDate}T00:00:00Z`).toLocaleDateString(
                  "en-IN",
                  { month: "short", timeZone: "UTC" },
                )}
              </small>
            </time>
            <div className="upcoming-list__main">
              <Link
                href={`/commitments/${encodeURIComponent(item.commitmentId)}?householdId=${encodeURIComponent(householdId)}`}
              >
                <strong>{item.displayName}</strong>
              </Link>
              <span>
                {labelForOption(commitmentCategories, item.category)}
                {item.maskedPaymentLabel ? ` · ${item.maskedPaymentLabel}` : ""}
              </span>
              <ReviewActionChips reviewActions={item.reviewActions} />
            </div>
            <div
              className={`upcoming-amount upcoming-amount--${item.amountKind.toLowerCase()}`}
            >
              <strong>{amount.value}</strong>
              <small>{amount.note}</small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function UpcomingCalendarView({
  calendar,
  householdId,
  month,
}: {
  calendar: DashboardCalendar;
  householdId: string;
  month: string;
}) {
  const byDate = new Map(calendar.days.map((day) => [day.date, day]));
  return (
    <div className="calendar-wrap">
      <table className="upcoming-calendar">
        <caption className="sr-only">
          Recurring commitment calendar for {formatYearMonth(month)}
        </caption>
        <thead>
          <tr>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <th key={day} scope="col">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendarWeeks(month).map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((date, dayIndex) => {
                const day = date ? byDate.get(date) : undefined;
                return (
                  <td
                    className={!date ? "calendar-outside" : undefined}
                    key={`${weekIndex}-${dayIndex}`}
                  >
                    {date && (
                      <>
                        <time dateTime={date}>{Number(date.slice(-2))}</time>
                        {day?.items.map((item) => {
                          const amount = upcomingAmountLabel(item);
                          return (
                            <Link
                              href={`/commitments/${encodeURIComponent(item.commitmentId)}?householdId=${encodeURIComponent(householdId)}`}
                              key={item.id}
                            >
                              <strong>{item.displayName}</strong>
                              <small>
                                {amount.value} · {amount.note}
                              </small>
                            </Link>
                          );
                        })}
                        {day && day.totals.length > 0 && (
                          <ProjectionBreakdown
                            compact
                            period={{
                              from: date,
                              to: date,
                              occurrenceCount: day.items.length,
                              unknownVariableOccurrenceCount: day.totals.reduce(
                                (count, total) =>
                                  count + total.unknownVariableOccurrenceCount,
                                0,
                              ),
                              totals: day.totals,
                            }}
                          />
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="calendar-note">
        Calendar totals never combine currencies and exclude unknown variable
        amounts.
      </p>
    </div>
  );
}

function UpcomingEmpty({ householdId }: { householdId: string }) {
  return (
    <section className="commitment-empty" aria-labelledby="empty-upcoming">
      <div aria-hidden="true">□</div>
      <p className="card-kicker">No dates this month</p>
      <h2 id="empty-upcoming">Nothing is scheduled in this period</h2>
      <p>Change the month or review active commitments in this workspace.</p>
      <Link
        className="secondary-link mt-5"
        href={`/commitments?householdId=${encodeURIComponent(householdId)}`}
      >
        View commitments
      </Link>
    </section>
  );
}
