"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  SupportApi,
  SupportApiError,
  type SupportDiagnostics,
} from "@/lib/support-api";

export function SupportDiagnosticsScreen() {
  const api = useMemo(() => new SupportApi(), []);
  const [code, setCode] = useState("");
  const [diagnostics, setDiagnostics] = useState<SupportDiagnostics | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const diagnosticsRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (diagnostics) {
      diagnosticsRef.current?.focus();
    } else if (error) {
      errorRef.current?.focus();
    }
  }, [diagnostics, error]);

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">SUPPORT_READ + owner code</p>
          <h1>Redacted local diagnostics</h1>
          <p>
            This view is read-only and code-scoped. It offers no account search,
            impersonation, raw logs, message retry, resend, or household
            mutation, and it is not proof of incident resolution.
          </p>
        </div>
      </header>

      <section className="notification-settings-card max-w-3xl">
        <label className="field-label" htmlFor="support-code">
          Owner-provided support code
        </label>
        <input
          autoComplete="off"
          className="form-input font-mono"
          id="support-code"
          maxLength={43}
          onChange={(event) => setCode(event.target.value.trim())}
          spellCheck={false}
          value={code}
        />
        <button
          className="primary-action mt-4"
          disabled={!/^[A-Za-z0-9_-]{43}$/.test(code) || busy}
          onClick={() => void resolve()}
          type="button"
        >
          {busy ? "Checking…" : "Open redacted diagnostics"}
        </button>
        {error && (
          <p
            className="field-error mt-3"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        )}
      </section>

      {announcement && (
        <p className="sr-only" role="status">
          {announcement}
        </p>
      )}

      {diagnostics && (
        <section
          aria-labelledby="support-diagnostics-heading"
          className="notification-settings-card max-w-3xl"
          ref={diagnosticsRef}
          tabIndex={-1}
        >
          <div className="settings-card-heading">
            <p className="card-kicker">{diagnostics.schemaVersion}</p>
            <h2 id="support-diagnostics-heading">Bounded workspace state</h2>
            <p>
              Generated {formatInstant(diagnostics.generatedAt)}. Authorization
              expires {formatInstant(diagnostics.grantExpiresAt)}.
            </p>
          </div>
          <dl className="diagnostic-counts mt-6">
            <Metric label="Status" value={diagnostics.status} />
            <Metric
              label="Active commitments"
              value={diagnostics.activeCommitmentCount}
            />
            <Metric
              label="Failed notifications"
              value={diagnostics.failedNotificationCount}
            />
            <Metric
              label="Pending privacy requests"
              value={diagnostics.pendingPrivacyRequestCount}
            />
            <Metric
              label="Latest commitment version"
              value={diagnostics.latestCommitmentVersion}
            />
          </dl>
        </section>
      )}
    </div>
  );

  async function resolve() {
    setBusy(true);
    setError(null);
    setAnnouncement(null);
    setDiagnostics(null);
    try {
      setDiagnostics(await api.resolve(code));
      setCode("");
      setAnnouncement("Redacted read-only diagnostics loaded.");
    } catch (cause) {
      setError(
        cause instanceof SupportApiError &&
          [403, 404, 410].includes(cause.status)
          ? "The role/code pair is invalid, revoked, expired, or unavailable."
          : cause instanceof Error
            ? cause.message
            : "Diagnostics could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
