"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import {
  SupportApi,
  SupportApiError,
  type CreatedSupportGrant,
} from "@/lib/support-api";

export function SupportCodeScreen() {
  const household = useSelectedHousehold();
  const api = useMemo(() => new SupportApi(), []);
  const [acknowledged, setAcknowledged] = useState(false);
  const [created, setCreated] = useState<CreatedSupportGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generatedPanelRef = useRef<HTMLElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (created) {
      generatedPanelRef.current?.focus();
    }
  }, [created]);

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Owner-authorized access</p>
          <h1>Redacted support diagnostics</h1>
          <p>
            Generate a short-lived code for {household.name}. It unlocks only
            bounded counts, states, versions, and timestamps for a separately
            authorized support user—never names, amounts, notes, targets,
            credentials, or impersonation.
          </p>
        </div>
      </header>

      {message && (
        <div
          className="success-toast"
          ref={messageRef}
          role="status"
          tabIndex={-1}
        >
          <span aria-hidden="true">✓</span>
          {message}
        </div>
      )}
      {error && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>Support access was not changed</strong>
          <p>{error}</p>
        </div>
      )}

      <section
        className="notification-settings-card max-w-3xl"
        ref={generatedPanelRef}
        tabIndex={created ? -1 : undefined}
      >
        {!created ? (
          <>
            <div className="settings-card-heading">
              <p className="card-kicker">Shown once</p>
              <h2>Create a support code</h2>
              <p>
                No email is sent. Transfer the code manually. AutoPay Guard
                stores only its digest and it expires within 15 minutes.
              </p>
            </div>
            <label className="mt-6 flex items-start gap-3 text-sm leading-6">
              <input
                checked={acknowledged}
                className="mt-1 size-5"
                onChange={(event) => setAcknowledged(event.target.checked)}
                type="checkbox"
              />
              I authorize temporary read-only redacted diagnostics for this
              workspace.
            </label>
            <button
              className="primary-action mt-5"
              disabled={!acknowledged || busy || !household.canManage}
              onClick={() => void create()}
              type="button"
            >
              {busy ? "Generating…" : "Generate one-time support code"}
            </button>
            {!household.canManage && (
              <p className="field-hint mt-3">
                Only the immutable workspace owner can generate a code.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="settings-card-heading">
              <p className="card-kicker">Copy now</p>
              <h2>Support code created locally</h2>
              <p>
                This plaintext is not persisted and will disappear when you
                leave or reload this page. No email was sent.
              </p>
            </div>
            <output className="mt-6 block break-all rounded-2xl border border-emerald-900/15 bg-emerald-50 p-5 font-mono text-lg font-black text-emerald-950">
              {created.supportCode}
            </output>
            <p className="mt-3 text-sm text-slate-600">
              Expires {formatInstant(created.grant.expiresAt)}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                className="secondary-link secondary-link--button"
                onClick={() => void copyCode()}
                type="button"
              >
                Copy code
              </button>
              <button
                className="secondary-link secondary-link--button border-red-300 text-red-900"
                disabled={busy}
                onClick={() => void revoke()}
                type="button"
              >
                {busy ? "Revoking…" : "Revoke now"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );

  async function create() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setCreated(await api.createCode(household.id, acknowledged));
      setMessage("Support code created. It is shown only on this page.");
    } catch (cause) {
      setError(supportError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!created) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.revokeCode(
        household.id,
        created.grant.id,
        created.grant.version,
      );
      setCreated(null);
      setAcknowledged(false);
      setMessage("Support code revoked.");
      requestAnimationFrame(() => messageRef.current?.focus());
    } catch (cause) {
      setError(supportError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!created) {
      return;
    }
    setError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable.");
      }
      await navigator.clipboard.writeText(created.supportCode);
      setMessage("Support code copied.");
    } catch {
      setMessage(null);
      setError(
        "Clipboard access was unavailable. Select and copy the displayed code manually.",
      );
    }
  }
}

function supportError(error: unknown) {
  if (error instanceof SupportApiError && error.status === 412) {
    return "This grant changed elsewhere. Reload before trying again.";
  }
  if (error instanceof SupportApiError && error.status === 409) {
    return "An active support code already exists. Wait for expiry or revoke it from its original page.";
  }
  return error instanceof Error
    ? error.message
    : "The support operation could not be completed.";
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
