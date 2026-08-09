"use client";

import { FoundationApi, type Commitment } from "@autopay-guard/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import {
  ReminderRuleEditor,
  type ReminderRuleEditorValue,
} from "@/components/reminder-rule-editor";
import { NotificationApi, type ReminderRulesDto } from "@/lib/notification-api";
import {
  notificationLoadErrorMessage,
  notificationMutationFailure,
} from "@/lib/notification-api-messages";

type ReminderState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      commitment: Commitment;
      rules: ReminderRulesDto;
    };

export function CommitmentReminderScreen({
  commitmentId,
}: {
  commitmentId: string;
}) {
  const household = useSelectedHousehold();
  const commitmentApi = useMemo(
    () => new FoundationApi({ baseUrl: "/api/bff" }),
    [],
  );
  const notificationApi = useMemo(
    () => new NotificationApi({ baseUrl: "/api/bff" }),
    [],
  );
  const requestKey = `${household.id}:${commitmentId}`;
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const [state, setState] = useState<ReminderState>({
    status: "loading",
    requestKey: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [commitment, rules] = await Promise.all([
          commitmentApi.getCommitment({ commitmentId }, { signal }),
          notificationApi.getCommitmentRules(commitmentId, { signal }),
        ]);
        if (signal?.aborted) {
          return;
        }
        if (
          commitment.householdId !== household.id ||
          rules.householdId !== household.id ||
          rules.commitmentId !== commitmentId
        ) {
          throw new Error("The API returned a different workspace scope.");
        }
        setState((current) =>
          current.requestKey === requestKey
            ? {
                status: "ready",
                requestKey,
                commitment,
                rules,
              }
            : current,
        );
        setSaving(false);
        setError(null);
        setConflict(false);
      } catch (loadError) {
        if (!signal?.aborted) {
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  status: "error",
                  requestKey,
                  message: notificationLoadErrorMessage(loadError),
                }
              : current,
          );
        }
      }
    },
    [commitmentApi, commitmentId, household.id, notificationApi, requestKey],
  );

  const reload = useCallback(async () => {
    setState({ status: "loading", requestKey });
    setSaved(false);
    await load();
  }, [load, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setState({ status: "loading", requestKey });
      setSaved(false);
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, requestKey]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading commitment reminder rules…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Reminder rules unavailable</strong>
        <p>{state.message}</p>
        <Link
          className="secondary-link"
          href={`/commitments?householdId=${encodeURIComponent(household.id)}`}
        >
          Back to commitments
        </Link>
      </div>
    );
  }

  const { commitment, rules } = state;
  return (
    <div className="commitment-reminder-page">
      <Link
        className="back-link"
        href={`/commitments/${encodeURIComponent(commitment.id)}?householdId=${encodeURIComponent(household.id)}`}
      >
        ← Commitment details
      </Link>
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Commitment override</p>
          <h1>{commitment.displayName} reminders</h1>
          <p>
            Inherit the workspace default, replace it completely, or disable
            reminders for this commitment.
          </p>
        </div>
        <Link
          className="secondary-link secondary-link--button"
          href={`/settings/notifications?householdId=${encodeURIComponent(household.id)}`}
        >
          Workspace defaults
        </Link>
      </header>

      {commitment.status !== "ACTIVE" && (
        <div className="reminder-safety-note" role="note">
          <strong>
            {commitment.status === "PAUSED" ? "Paused" : "Archived"}
          </strong>
          <p>
            No pending reminder can be delivered while this commitment is{" "}
            {commitment.status.toLowerCase()}.
          </p>
        </div>
      )}

      {saved && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          Commitment reminder rules saved.
        </div>
      )}

      <section
        aria-labelledby="commitment-rule-heading"
        className="notification-settings-card"
      >
        <div className="settings-card-heading">
          <p className="card-kicker">{household.name}</p>
          <h2 id="commitment-rule-heading">Reminder behavior</h2>
          <p>
            A custom set replaces the workspace rules; it does not merge with
            them.
          </p>
        </div>
        <ReminderRuleEditor
          conflict={conflict}
          error={error}
          initialValue={rules}
          key={`${rules.id ?? "synthetic"}:${rules.version}`}
          onReload={reload}
          onSubmit={saveRules}
          saving={saving}
          scope="COMMITMENT"
          suggestedRules={rules.suggestedRules}
          version={rules.version}
        />
      </section>
    </div>
  );

  async function saveRules(value: ReminderRuleEditorValue) {
    setSaving(true);
    setError(null);
    setConflict(false);
    setSaved(false);
    try {
      const updated = await notificationApi.putCommitmentRules(
        commitmentId,
        `"${rules.version}"`,
        value,
      );
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      if (
        updated.householdId !== household.id ||
        updated.commitmentId !== commitmentId
      ) {
        throw new Error("The API returned a different workspace scope.");
      }
      setState((current) =>
        current.status === "ready" && current.requestKey === requestKey
          ? { ...current, rules: updated }
          : current,
      );
      setSaving(false);
      setSaved(true);
    } catch (saveError) {
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      const failure = notificationMutationFailure(saveError);
      setSaving(false);
      setError(failure.message);
      setConflict(failure.conflict);
    }
  }
}
