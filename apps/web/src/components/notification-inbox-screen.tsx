"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import { Button } from "@/components/ui/button";
import { formatLocalDate } from "@/lib/local-date";
import {
  NotificationApi,
  type NotificationDto,
  type NotificationFilter,
} from "@/lib/notification-api";
import { notificationLoadErrorMessage } from "@/lib/notification-api-messages";
import {
  formatNotificationInstant,
  notificationChannelLabel,
  notificationFailureLabel,
  notificationOffsetLabel,
  notificationStatusLabel,
  notificationStatusTone,
} from "@/lib/notification-display";

type InboxState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      items: NotificationDto[];
      nextCursor: string | null;
    };

const filters: Array<{ value: NotificationFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "UNREAD", label: "Unread" },
  { value: "FAILED", label: "Failed" },
];

export function NotificationInboxScreen() {
  const household = useSelectedHousehold();
  const searchParams = useSearchParams();
  const api = useMemo(() => new NotificationApi({ baseUrl: "/api/bff" }), []);
  const filter = parseFilter(searchParams.get("filter"));
  const requestKey = `${household.id}:${filter}`;
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const [state, setState] = useState<InboxState>({
    status: "loading",
    requestKey: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await api.listNotifications(
          { householdId: household.id, filter, limit: 25 },
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        assertInboxScope(
          page.householdId,
          page.filter,
          page.items,
          household.id,
          filter,
        );
        setState((current) =>
          current.requestKey === requestKey
            ? {
                status: "ready",
                requestKey,
                items: page.items,
                nextCursor: page.nextCursor,
              }
            : current,
        );
      } catch (error) {
        if (!signal?.aborted) {
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  status: "error",
                  requestKey,
                  message: notificationLoadErrorMessage(error),
                }
              : current,
          );
        }
      }
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
      setLoadingMore(false);
      setLoadMoreError(null);
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, requestKey]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading notifications…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Inbox unavailable</strong>
        <p>{state.message}</p>
        <button
          className="secondary-link"
          onClick={() => {
            setState({ status: "loading", requestKey });
            void load();
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  const nextCursor = state.nextCursor;
  return (
    <div className="notification-inbox-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Owned workspace inbox</p>
          <h1>Notifications</h1>
          <p>
            See planned and delivered reminder states without exposing provider
            diagnostics or recipient details.
          </p>
        </div>
        <div className="detail-actions">
          <Link
            className="secondary-link secondary-link--button"
            href={`/upcoming/decisions?householdId=${encodeURIComponent(household.id)}`}
          >
            Decision inbox
          </Link>
          <Link
            className="secondary-link secondary-link--button"
            href={`/settings/notifications?householdId=${encodeURIComponent(household.id)}`}
          >
            Notification settings
          </Link>
        </div>
      </header>

      <nav aria-label="Notification filters" className="notification-filters">
        {filters.map((candidate) => (
          <Link
            aria-current={candidate.value === filter ? "page" : undefined}
            href={filterHref(household.id, candidate.value)}
            key={candidate.value}
          >
            {candidate.label}
          </Link>
        ))}
      </nav>

      {state.items.length === 0 ? (
        <section className="notification-empty">
          <span aria-hidden="true">○</span>
          <h2>
            No {filter === "ALL" ? "" : filter.toLowerCase()} notifications
          </h2>
          <p>
            Reminders are disabled by default. When eligible local reminders
            exist, their safe delivery state appears here.
          </p>
          <Link
            className="primary-link"
            href={`/settings/notifications?householdId=${encodeURIComponent(household.id)}`}
          >
            Review notification settings
            <span aria-hidden="true">→</span>
          </Link>
        </section>
      ) : (
        <ol className="notification-list">
          {state.items.map((notification) => (
            <li
              className={notification.read ? undefined : "is-unread"}
              key={notification.id}
            >
              <Link
                href={`/notifications/${encodeURIComponent(notification.id)}?householdId=${encodeURIComponent(household.id)}`}
              >
                <span aria-hidden="true" className="notification-unread-dot" />
                <span className="notification-list__body">
                  <span className="sr-only">
                    {notification.read ? "Read." : "Unread."}
                  </span>
                  <span className="notification-list__eyebrow">
                    {notificationChannelLabel(notification.channel)} ·{" "}
                    {notificationOffsetLabel(notification.offsetDays)}
                  </span>
                  <strong>
                    Reminder for {formatLocalDate(notification.scheduledDate)}
                  </strong>
                  <small>
                    Planned {formatNotificationInstant(notification.plannedFor)}
                  </small>
                  {notification.failureCategory !== "NONE" && (
                    <small className="notification-list__failure">
                      {notificationFailureLabel(notification.failureCategory)}
                    </small>
                  )}
                </span>
                <span
                  className={`notification-status notification-status--${notificationStatusTone(notification.status)}`}
                >
                  {notificationStatusLabel(notification.status)}
                </span>
                <span aria-hidden="true" className="notification-list__arrow">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {loadMoreError && (
        <div className="form-alert" role="alert">
          <strong>Could not load more notifications</strong>
          <p>{loadMoreError}</p>
        </div>
      )}

      {nextCursor && (
        <div className="notification-load-more">
          <Button
            disabled={loadingMore}
            onClick={() => void loadMore(nextCursor)}
            variant="secondary"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );

  async function loadMore(cursor: string) {
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await api.listNotifications({
        householdId: household.id,
        filter,
        cursor,
        limit: 25,
      });
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      assertInboxScope(
        page.householdId,
        page.filter,
        page.items,
        household.id,
        filter,
      );
      setState((current) =>
        current.status === "ready" && current.requestKey === requestKey
          ? {
              ...current,
              items: appendUnique(current.items, page.items),
              nextCursor: page.nextCursor,
            }
          : current,
      );
    } catch (error) {
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      setLoadMoreError(notificationLoadErrorMessage(error));
    } finally {
      if (requestKeyRef.current === requestKey) {
        setLoadingMore(false);
      }
    }
  }
}

function parseFilter(value: string | null): NotificationFilter {
  if (value === "UNREAD" || value === "FAILED") {
    return value;
  }
  return "ALL";
}

function filterHref(householdId: string, filter: NotificationFilter) {
  const query = new URLSearchParams({ householdId });
  if (filter !== "ALL") {
    query.set("filter", filter);
  }
  return `/notifications?${query.toString()}`;
}

function appendUnique(current: NotificationDto[], incoming: NotificationDto[]) {
  const ids = new Set(current.map(({ id }) => id));
  return [...current, ...incoming.filter(({ id }) => !ids.has(id))];
}

function assertInboxScope(
  householdId: string,
  responseFilter: NotificationFilter,
  items: NotificationDto[],
  expectedHouseholdId: string,
  expectedFilter: NotificationFilter,
) {
  if (
    householdId !== expectedHouseholdId ||
    responseFilter !== expectedFilter ||
    items.some((item) => item.householdId !== expectedHouseholdId)
  ) {
    throw new Error("The API returned a different workspace scope.");
  }
}
