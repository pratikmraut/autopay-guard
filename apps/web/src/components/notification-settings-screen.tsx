"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import {
  NotificationPreferencesForm,
  type NotificationPreferenceValues,
} from "@/components/notification-preferences-form";
import {
  ReminderRuleEditor,
  type ReminderRuleEditorValue,
} from "@/components/reminder-rule-editor";
import {
  NotificationApi,
  type NotificationDiagnosticsDto,
  type NotificationPreferencesDto,
  type ReminderRulesDto,
} from "@/lib/notification-api";
import {
  notificationLoadErrorMessage,
  notificationMutationFailure,
} from "@/lib/notification-api-messages";

type SettingsState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      preferences: NotificationPreferencesDto;
      rules: ReminderRulesDto;
      diagnostics: NotificationDiagnosticsDto;
    };

interface MutationState {
  saving: boolean;
  error: string | null;
  conflict: boolean;
}

const idleMutation: MutationState = {
  saving: false,
  error: null,
  conflict: false,
};

export function NotificationSettingsScreen() {
  const household = useSelectedHousehold();
  const api = useMemo(() => new NotificationApi({ baseUrl: "/api/bff" }), []);
  const requestKey = household.id;
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const [state, setState] = useState<SettingsState>({
    status: "loading",
    requestKey: null,
  });
  const [preferenceMutation, setPreferenceMutation] =
    useState<MutationState>(idleMutation);
  const [ruleMutation, setRuleMutation] = useState<MutationState>(idleMutation);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [preferences, rules, diagnostics] = await Promise.all([
          api.getPreferences({ signal }),
          api.getHouseholdRules(household.id, { signal }),
          api.getDiagnostics(household.id, { signal }),
        ]);
        if (signal?.aborted) {
          return;
        }
        if (
          rules.householdId !== household.id ||
          rules.commitmentId !== null ||
          diagnostics.householdId !== household.id
        ) {
          throw new Error("The API returned a different workspace scope.");
        }
        setState((current) =>
          current.requestKey === requestKey
            ? {
                status: "ready",
                requestKey,
                preferences,
                rules,
                diagnostics,
              }
            : current,
        );
        setPreferenceMutation(idleMutation);
        setRuleMutation(idleMutation);
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
    [api, household.id, requestKey],
  );

  const reload = useCallback(async () => {
    setState({ status: "loading", requestKey });
    setSuccessMessage(null);
    await load();
  }, [load, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setState({ status: "loading", requestKey });
      setSuccessMessage(null);
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, requestKey]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading notification settings…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Notification settings unavailable</strong>
        <p>{state.message}</p>
        <button className="secondary-link" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    );
  }

  const { preferences, rules, diagnostics } = state;
  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Consent and delivery</p>
          <h1>Notification settings</h1>
          <p>
            Reminders stay off until you explicitly enable both global consent
            and a rule set. AutoPay Guard never acts on a payment.
          </p>
        </div>
        <Link
          className="secondary-link secondary-link--button"
          href={`/notifications?householdId=${encodeURIComponent(household.id)}`}
        >
          Open inbox
        </Link>
      </header>

      {successMessage && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {successMessage}
        </div>
      )}

      <div className="notification-settings-grid">
        <section
          aria-labelledby="preference-heading"
          className="notification-settings-card"
        >
          <div className="settings-card-heading">
            <p className="card-kicker">Global</p>
            <h2 id="preference-heading">Your delivery preferences</h2>
            <p>
              These choices apply to every owned workspace and use the signed-in
              local identity.
            </p>
          </div>
          <NotificationPreferencesForm
            conflict={preferenceMutation.conflict}
            error={preferenceMutation.error}
            initialValues={preferences}
            key={`${preferences.id ?? "synthetic"}:${preferences.version}`}
            onReload={reload}
            onSubmit={savePreferences}
            saving={preferenceMutation.saving}
            version={preferences.version}
          />
        </section>

        <section
          aria-labelledby="workspace-rule-heading"
          className="notification-settings-card"
        >
          <div className="settings-card-heading">
            <p className="card-kicker">{household.name}</p>
            <h2 id="workspace-rule-heading">Workspace defaults</h2>
            <p>
              Commitments set to inherit use this complete rule set. Missing
              defaults remain disabled.
            </p>
          </div>
          <ReminderRuleEditor
            conflict={ruleMutation.conflict}
            error={ruleMutation.error}
            initialValue={rules}
            key={`${rules.id ?? "synthetic"}:${rules.version}`}
            onReload={reload}
            onSubmit={saveRules}
            saving={ruleMutation.saving}
            scope="HOUSEHOLD"
            suggestedRules={rules.suggestedRules}
            version={rules.version}
          />
        </section>

        <NotificationDiagnostics diagnostics={diagnostics} />
      </div>
    </div>
  );

  async function savePreferences(values: NotificationPreferenceValues) {
    setPreferenceMutation({ saving: true, error: null, conflict: false });
    setSuccessMessage(null);
    try {
      const updated = await api.putPreferences(
        `"${preferences.version}"`,
        values,
      );
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      setState((current) =>
        current.status === "ready" && current.requestKey === requestKey
          ? { ...current, preferences: updated }
          : current,
      );
      setPreferenceMutation(idleMutation);
      setSuccessMessage("Notification preferences saved.");
    } catch (error) {
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      const failure = notificationMutationFailure(error);
      setPreferenceMutation({
        saving: false,
        error: failure.message,
        conflict: failure.conflict,
      });
    }
  }

  async function saveRules(value: ReminderRuleEditorValue) {
    setRuleMutation({ saving: true, error: null, conflict: false });
    setSuccessMessage(null);
    try {
      const updated = await api.putHouseholdRules(
        household.id,
        `"${rules.version}"`,
        value,
      );
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      if (
        updated.householdId !== household.id ||
        updated.commitmentId !== null
      ) {
        throw new Error("The API returned a different workspace scope.");
      }
      setState((current) =>
        current.status === "ready" && current.requestKey === requestKey
          ? { ...current, rules: updated }
          : current,
      );
      setRuleMutation(idleMutation);
      setSuccessMessage("Workspace reminder defaults saved.");
    } catch (error) {
      if (requestKeyRef.current !== requestKey) {
        return;
      }
      const failure = notificationMutationFailure(error);
      setRuleMutation({
        saving: false,
        error: failure.message,
        conflict: failure.conflict,
      });
    }
  }
}

function NotificationDiagnostics({
  diagnostics,
}: {
  diagnostics: NotificationDiagnosticsDto;
}) {
  const counts = [
    ["Pending", diagnostics.pendingCount],
    ["Processing", diagnostics.processingCount],
    ["Retry scheduled", diagnostics.retryScheduledCount],
    ["Delivered", diagnostics.deliveredCount],
    ["Dead", diagnostics.deadCount],
    ["Suppressed", diagnostics.suppressedCount],
  ] as const;

  return (
    <section
      aria-labelledby="diagnostics-heading"
      className="notification-settings-card notification-diagnostics"
    >
      <div className="settings-card-heading">
        <p className="card-kicker">Read only</p>
        <h2 id="diagnostics-heading">Delivery diagnostics</h2>
        <p>
          Safe owner-scoped states only. Provider responses and raw errors are
          never exposed here.
        </p>
      </div>
      <dl className="diagnostic-counts">
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <dl className="diagnostic-timing">
        <div>
          <dt>Oldest pending age</dt>
          <dd>
            {diagnostics.oldestPendingAgeSeconds === null
              ? "None pending"
              : formatAge(diagnostics.oldestPendingAgeSeconds)}
          </dd>
        </div>
        <div>
          <dt>Next retry</dt>
          <dd>
            {diagnostics.nextRetryAt
              ? formatInstant(diagnostics.nextRetryAt)
              : "None scheduled"}
          </dd>
        </div>
      </dl>
      {diagnostics.failures.length > 0 && (
        <div className="diagnostic-failures">
          <h3>Failure categories</h3>
          <ul>
            {diagnostics.failures.map((failure) => (
              <li key={failure.category}>
                <span>{failureLabel(failure.category)}</span>
                <strong>{failure.count}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function formatAge(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds} seconds`;
  }
  if (totalSeconds < 3600) {
    return `${Math.floor(totalSeconds / 60)} minutes`;
  }
  return `${Math.floor(totalSeconds / 3600)} hours`;
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function failureLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
