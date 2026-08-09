"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import { Button } from "@/components/ui/button";
import { formatLocalDate } from "@/lib/local-date";
import { NotificationApi, type NotificationDto } from "@/lib/notification-api";
import {
  notificationLoadErrorMessage,
  notificationMutationFailure,
} from "@/lib/notification-api-messages";
import {
  formatNotificationInstant,
  notificationChannelLabel,
  notificationFailureLabel,
  notificationOffsetLabel,
  notificationStatusLabel,
  notificationStatusTone,
} from "@/lib/notification-display";

type DetailState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      notification: NotificationDto;
    };

export function NotificationDetailScreen({
  notificationId,
}: {
  notificationId: string;
}) {
  const household = useSelectedHousehold();
  const api = useMemo(() => new NotificationApi({ baseUrl: "/api/bff" }), []);
  const requestKey = `${household.id}:${notificationId}`;
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const [state, setState] = useState<DetailState>({
    status: "loading",
    requestKey: null,
  });
  const [updating, setUpdating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [updatedMessage, setUpdatedMessage] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const notification = await api.getNotification(notificationId, {
          signal,
        });
        if (signal?.aborted) {
          return;
        }
        if (
          notification.householdId !== household.id ||
          notification.id !== notificationId
        ) {
          throw new Error("The API returned a different workspace scope.");
        }
        setState((current) =>
          current.requestKey === requestKey
            ? { status: "ready", requestKey, notification }
            : current,
        );
        setUpdating(false);
        setMutationError(null);
        setConflict(false);
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
    [api, household.id, notificationId, requestKey],
  );

  const reload = useCallback(async () => {
    setState({ status: "loading", requestKey });
    setUpdatedMessage(null);
    await load();
  }, [load, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setState({ status: "loading", requestKey });
      setUpdatedMessage(null);
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, requestKey]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading notification…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Notification unavailable</strong>
        <p>{state.message}</p>
        <Link
          className="secondary-link"
          href={`/notifications?householdId=${encodeURIComponent(household.id)}`}
        >
          Back to inbox
        </Link>
      </div>
    );
  }

  const notification = state.notification;
  return (
    <div className="notification-detail-page">
      <Link
        className="back-link"
        href={`/notifications?householdId=${encodeURIComponent(household.id)}`}
      >
        ← Notification inbox
      </Link>
      <header className="resource-heading notification-detail-heading">
        <div>
          <p className="eyebrow">
            {notificationChannelLabel(notification.channel)}
          </p>
          <h1>Reminder details</h1>
          <p>
            A safe delivery record for the scheduled commitment date. No
            recipient or provider response is exposed.
          </p>
        </div>
        <div className="detail-actions">
          <span
            className={`notification-status notification-status--${notificationStatusTone(notification.status)}`}
          >
            {notificationStatusLabel(notification.status)}
          </span>
          <Button
            disabled={updating}
            onClick={() => void toggleRead()}
            variant="secondary"
          >
            {updating
              ? "Updating…"
              : notification.read
                ? "Mark unread"
                : "Mark read"}
          </Button>
        </div>
      </header>

      {updatedMessage && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {updatedMessage}
        </div>
      )}

      {mutationError && (
        <div
          className={`form-alert ${conflict ? "form-alert--conflict" : ""}`}
          role="alert"
        >
          <strong>
            {conflict
              ? "A newer version exists"
              : "Could not update notification"}
          </strong>
          <p>{mutationError}</p>
          {conflict && (
            <button onClick={() => void reload()} type="button">
              Reload latest version
            </button>
          )}
        </div>
      )}

      <section
        className="notification-detail-card"
        aria-label="Reminder record"
      >
        <dl>
          <div>
            <dt>Scheduled date</dt>
            <dd>{formatLocalDate(notification.scheduledDate)}</dd>
          </div>
          <div>
            <dt>Reminder offset</dt>
            <dd>{notificationOffsetLabel(notification.offsetDays)}</dd>
          </div>
          <div>
            <dt>Planned delivery</dt>
            <dd>{formatNotificationInstant(notification.plannedFor)}</dd>
          </div>
          <div>
            <dt>Channel</dt>
            <dd>{notificationChannelLabel(notification.channel)}</dd>
          </div>
          <div>
            <dt>Inbox state</dt>
            <dd>{notification.read ? "Read" : "Unread"}</dd>
          </div>
          <div>
            <dt>Delivery state</dt>
            <dd>{notificationStatusLabel(notification.status)}</dd>
          </div>
          {notification.deliveredAt && (
            <div>
              <dt>Delivered</dt>
              <dd>{formatNotificationInstant(notification.deliveredAt)}</dd>
            </div>
          )}
          {notification.nextAttemptAt && (
            <div>
              <dt>Next attempt</dt>
              <dd>{formatNotificationInstant(notification.nextAttemptAt)}</dd>
            </div>
          )}
          {notification.failureCategory !== "NONE" && (
            <div>
              <dt>Safe failure category</dt>
              <dd>{notificationFailureLabel(notification.failureCategory)}</dd>
            </div>
          )}
        </dl>
      </section>

      <div className="notification-detail-actions">
        <Link
          className="secondary-link secondary-link--button"
          href={`/commitments/${encodeURIComponent(notification.commitmentId)}?householdId=${encodeURIComponent(household.id)}`}
        >
          View commitment
        </Link>
        <Link
          className="secondary-link secondary-link--button"
          href={`/commitments/${encodeURIComponent(notification.commitmentId)}/reminders?householdId=${encodeURIComponent(household.id)}`}
        >
          Reminder rules
        </Link>
      </div>

      {notification.channel === "EMAIL" && (
        <p className="provider-action-note">
          Local test email is at-least-once. A worker crash after Mailpit
          accepts a message can make delivery status temporarily ambiguous.
        </p>
      )}
    </div>
  );

  async function toggleRead() {
    setUpdating(true);
    setMutationError(null);
    setConflict(false);
    setUpdatedMessage(null);
    try {
      const updated = await api.patchNotificationRead(
        notification.id,
        `"${notification.version}"`,
        !notification.read,
      );
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      if (
        updated.id !== notification.id ||
        updated.householdId !== household.id
      ) {
        throw new Error("The API returned a different workspace scope.");
      }
      setState((current) =>
        current.status === "ready" && current.requestKey === requestKey
          ? { ...current, notification: updated }
          : current,
      );
      setUpdating(false);
      setUpdatedMessage(
        updated.read
          ? "Notification marked read."
          : "Notification marked unread.",
      );
    } catch (error) {
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      const failure = notificationMutationFailure(error);
      setUpdating(false);
      setMutationError(failure.message);
      setConflict(failure.conflict);
    }
  }
}
