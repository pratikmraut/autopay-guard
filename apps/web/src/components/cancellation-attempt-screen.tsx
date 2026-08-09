"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GuideTracks } from "@/components/cancellation-guide-screen";
import { useSelectedHousehold } from "@/components/household-scope";
import { Button } from "@/components/ui/button";
import {
  CancellationApi,
  type AttemptTrackStatus,
  type CancellationAttempt,
  type VerificationStatus,
} from "@/lib/cancellation-api";
import {
  cancellationLoadErrorMessage,
  cancellationMutationFailure,
} from "@/lib/cancellation-api-messages";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { formatLocalDate } from "@/lib/local-date";
import { formatMinorMoney } from "@/lib/money";

type AttemptState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      attempt: CancellationAttempt;
    };

export function CancellationAttemptScreen({
  commitmentId,
  attemptId,
}: {
  commitmentId: string;
  attemptId: string;
}) {
  const household = useSelectedHousehold();
  const searchParams = useSearchParams();
  const requestKey = `${household.id}:${commitmentId}:${attemptId}`;
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const [state, setState] = useState<AttemptState>({
    status: "loading",
    requestKey: null,
  });
  const [successMessage, setSuccessMessage] = useState<string | null>(
    searchParams.get("started") === "1"
      ? "Cancellation tracking attempt started."
      : null,
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const attempt = await api.getAttempt(attemptId, { signal });
        if (signal?.aborted) {
          return;
        }
        if (
          attempt.id !== attemptId ||
          attempt.commitmentId !== commitmentId ||
          attempt.householdId !== household.id ||
          attempt.guide.id !== attempt.guideId ||
          attempt.guide.version !== attempt.guideVersion ||
          attempt.guide.householdId !== household.id ||
          attempt.guide.commitmentId !== commitmentId
        ) {
          throw new Error("The API returned a different attempt scope.");
        }
        setState((current) =>
          current.requestKey === requestKey
            ? { status: "ready", requestKey, attempt }
            : current,
        );
      } catch (error) {
        if (!signal?.aborted) {
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  status: "error",
                  requestKey,
                  message: cancellationLoadErrorMessage(error),
                }
              : current,
          );
        }
      }
    },
    [api, attemptId, commitmentId, household.id, requestKey],
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
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, requestKey]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading cancellation attempt…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Cancellation attempt unavailable</strong>
        <p>{state.message}</p>
        <Link
          className="secondary-link"
          href={`/commitments/${encodeURIComponent(commitmentId)}/cancellation?householdId=${encodeURIComponent(household.id)}`}
        >
          Back to guide
        </Link>
      </div>
    );
  }

  const attempt = state.attempt;
  return (
    <div className="cancellation-attempt-page">
      <Link
        className="back-link"
        href={`/commitments/${encodeURIComponent(commitmentId)}/cancellation?householdId=${encodeURIComponent(household.id)}`}
      >
        ← Cancellation guide
      </Link>
      <header className="resource-heading">
        <div>
          <p className="eyebrow">
            Guide version {attempt.guideVersion} ·{" "}
            {attempt.abandoned
              ? "Abandoned"
              : verificationLabel(attempt.verificationStatus)}
          </p>
          <h1>Cancellation attempt</h1>
          <p>
            A private record of actions you take outside AutoPay Guard. Opening
            a target never completes a step, and this record never changes the
            provider or mandate.
          </p>
        </div>
        <Link
          className="secondary-link secondary-link--button"
          href={`/dashboard/savings?householdId=${encodeURIComponent(household.id)}`}
        >
          Savings records
        </Link>
      </header>

      {successMessage && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {successMessage}
        </div>
      )}

      <AttemptSummary attempt={attempt} />
      <GuideTracks guide={attempt.guide} />
      <AttemptTrackEditor
        attempt={attempt}
        key={`tracks:${attempt.version}`}
        onReload={reload}
        onUpdated={(updated, message) => {
          setState({ status: "ready", requestKey, attempt: updated });
          setSuccessMessage(message);
        }}
      />
      <VerificationPanel
        attempt={attempt}
        key={`verification:${attempt.version}`}
        onReload={reload}
        onUpdated={(updated, message) => {
          setState({ status: "ready", requestKey, attempt: updated });
          setSuccessMessage(message);
        }}
      />

      <aside className="tracking-continues-note">
        <strong>Tracking stays separate</strong>
        <p>
          Even a user-confirmed after-due-date outcome does not archive this
          commitment or change future occurrences. Use the existing commitment
          page if you independently choose to stop tracking it.
        </p>
        <Link
          className="secondary-link"
          href={`/commitments/${encodeURIComponent(commitmentId)}?householdId=${encodeURIComponent(household.id)}`}
        >
          Manage commitment
        </Link>
      </aside>
    </div>
  );
}

function AttemptSummary({ attempt }: { attempt: CancellationAttempt }) {
  return (
    <section className="attempt-summary-grid" aria-label="Attempt snapshot">
      <article>
        <p className="card-kicker">Scheduled occurrence snapshot</p>
        <strong>{formatLocalDate(attempt.scheduledDate)}</strong>
        <small>
          This immutable occurrence and date snapshot is preserved for this
          attempt.
        </small>
      </article>
      <article>
        <p className="card-kicker">12-month potential</p>
        <strong>
          {attempt.projectedSavingsMinor === null
            ? "Unquantified"
            : formatMinorMoney(attempt.projectedSavingsMinor, attempt.currency)}
        </strong>
        <small>
          {attempt.projectedSavingsMinor === null
            ? "Unknown variable amount is never treated as zero."
            : attempt.estimated
              ? "Estimated from saved variable amounts."
              : "Exact fixed recurrence dates in the pinned period."}
        </small>
      </article>
      <article>
        <p className="card-kicker">Savings period</p>
        <strong>
          {formatLocalDate(attempt.savingsPeriodStart)} –{" "}
          {formatLocalDate(attempt.savingsPeriodEnd)}
        </strong>
        <small>No frequency multiplier, rounding, FX, or browser math.</small>
      </article>
    </section>
  );
}

function AttemptTrackEditor({
  attempt,
  onUpdated,
  onReload,
}: {
  attempt: CancellationAttempt;
  onUpdated: (attempt: CancellationAttempt, message: string) => void;
  onReload: () => Promise<void>;
}) {
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const [serviceStatus, setServiceStatus] = useState(attempt.serviceStatus);
  const [paymentMandateStatus, setPaymentMandateStatus] = useState(
    attempt.paymentMandateStatus,
  );
  const [saving, setSaving] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const terminal =
    attempt.abandoned ||
    attempt.verificationStatus === "VERIFIED" ||
    attempt.verificationStatus === "DISPUTED";

  return (
    <section className="attempt-editor-card" aria-labelledby="track-progress">
      <div>
        <p className="card-kicker">Explicit status only</p>
        <h2 id="track-progress">Track external progress separately</h2>
        <p>
          Change a status only after you perform or observe that action
          yourself. Target clicks never update these fields.
        </p>
      </div>
      {error && (
        <div
          className={`form-alert ${conflict ? "form-alert--conflict" : ""}`}
          role="alert"
        >
          <strong>
            {conflict ? "A newer version exists" : "Could not update attempt"}
          </strong>
          <p>{error}</p>
          {conflict && (
            <button onClick={() => void onReload()} type="button">
              Reload latest version
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await save(false);
        }}
      >
        <fieldset
          className="attempt-track-fields"
          disabled={saving || terminal}
        >
          <legend className="sr-only">External track status</legend>
          <TrackStatusField
            id="service-track-status"
            label="Merchant-service track"
            onChange={setServiceStatus}
            value={serviceStatus}
          />
          <TrackStatusField
            id="mandate-track-status"
            label="Payment-mandate track"
            onChange={setPaymentMandateStatus}
            value={paymentMandateStatus}
          />
        </fieldset>
        {!terminal && (
          <div className="form-actions">
            <Button disabled={saving} type="submit">
              {saving ? "Saving…" : "Save track progress"}
            </Button>
            <span aria-live="polite" className="form-version">
              Version {attempt.version}
            </span>
          </div>
        )}
      </form>

      {!terminal && !confirmAbandon && (
        <button
          className="danger-link"
          disabled={saving}
          onClick={() => setConfirmAbandon(true)}
          type="button"
        >
          Abandon this attempt
        </button>
      )}
      {confirmAbandon && (
        <div className="archive-confirmation">
          <div>
            <h2>Abandon this tracking attempt?</h2>
            <p>
              This is terminal, preserves its history, and reverses its current
              savings state. It does not change the commitment or provider.
            </p>
          </div>
          <div>
            <Button
              disabled={saving}
              onClick={() => void save(true)}
              type="button"
            >
              {saving ? "Abandoning…" : "Abandon attempt"}
            </Button>
            <button
              className="secondary-link"
              disabled={saving}
              onClick={() => setConfirmAbandon(false)}
              type="button"
            >
              Keep attempt
            </button>
          </div>
        </div>
      )}
    </section>
  );

  async function save(abandoned: boolean) {
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      const updated = await api.updateAttempt(
        attempt.id,
        `"${attempt.version}"`,
        { serviceStatus, paymentMandateStatus, abandoned },
      );
      if (!hasSameAttemptIdentity(updated, attempt)) {
        throw new Error("The API returned a different attempt scope.");
      }
      onUpdated(
        updated,
        abandoned
          ? "Attempt abandoned. Commitment tracking is unchanged."
          : "Track progress saved.",
      );
      setConfirmAbandon(false);
    } catch (caught) {
      const failure = cancellationMutationFailure(caught);
      setError(failure.message);
      setConflict(failure.conflict);
    } finally {
      setSaving(false);
    }
  }
}

function TrackStatusField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: AttemptTrackStatus;
  onChange: (value: AttemptTrackStatus) => void;
}) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <select
        className="field-input"
        id={id}
        onChange={(event) => onChange(event.target.value as AttemptTrackStatus)}
        value={value}
      >
        {allowedTrackStatuses(value).map((status) => (
          <option key={status} value={status}>
            {trackStatusLabel(status)}
          </option>
        ))}
      </select>
      <p>{trackStatusDescription(value)}</p>
    </div>
  );
}

function VerificationPanel({
  attempt,
  onUpdated,
  onReload,
}: {
  attempt: CancellationAttempt;
  onUpdated: (attempt: CancellationAttempt, message: string) => void;
  onReload: () => Promise<void>;
}) {
  const options = verificationOptions(attempt);
  const tracksComplete =
    attempt.serviceStatus === "CONFIRMED" &&
    ["CONFIRMED", "NOT_REQUIRED"].includes(attempt.paymentMandateStatus);

  return (
    <section
      className="verification-card"
      aria-labelledby="verification-heading"
    >
      <div>
        <p className="card-kicker">User-attested follow-up</p>
        <h2 id="verification-heading">Record what happened</h2>
        <p>
          The follow-up date is {formatLocalDate(attempt.verificationDueDate)}.
          AutoPay Guard has no bank feed, provider callback, or independent
          evidence source.
        </p>
      </div>
      {!attempt.verificationDueReached &&
        !attempt.abandoned &&
        attempt.verificationStatus !== "DISPUTED" && (
          <div className="form-alert">
            <strong>After-date eligibility comes from the server</strong>
            <p>
              The server has not marked this follow-up date as reached. If this
              page stays open past the displayed date, reload it so the server
              can reevaluate eligibility in your household timezone.
            </p>
            <button onClick={() => void onReload()} type="button">
              Reload after-date eligibility
            </button>
          </div>
        )}
      {!tracksComplete && !attempt.abandoned && options.length === 0 ? (
        <div className="form-alert">
          Confirm every required external track before recording an outcome.
        </div>
      ) : !tracksComplete &&
        options.length === 1 &&
        options[0] === "DISPUTED" ? (
        <>
          <div className="form-alert">
            Required tracks are incomplete. You can still report an observed
            debit after the due date; self-reported completion and
            user-confirmed no-debit outcomes remain unavailable.
          </div>
          <VerificationForm
            attempt={attempt}
            onReload={onReload}
            onUpdated={onUpdated}
            options={options}
          />
        </>
      ) : options.length === 0 ? (
        <div className="verification-current">
          <strong>{verificationLabel(attempt.verificationStatus)}</strong>
          <p>
            {attempt.verificationStatus === "DISPUTED"
              ? "This terminal record says you later observed a debit. AutoPay Guard does not claim or request a refund."
              : attempt.abandoned
                ? "This attempt was abandoned and its history remains read only."
                : attempt.verificationStatus === "SELF_REPORTED" &&
                    !attempt.verificationDueReached
                  ? `Further user-attested follow-up becomes available on ${formatLocalDate(attempt.verificationDueDate)}. This is not yet user-confirmed after the due date.`
                  : "No further verification transition is available."}
          </p>
        </div>
      ) : (
        <VerificationForm
          attempt={attempt}
          onReload={onReload}
          onUpdated={onUpdated}
          options={options}
        />
      )}
    </section>
  );
}

function VerificationForm({
  attempt,
  options,
  onUpdated,
  onReload,
}: {
  attempt: CancellationAttempt;
  options: Array<Exclude<VerificationStatus, "PENDING">>;
  onUpdated: (attempt: CancellationAttempt, message: string) => void;
  onReload: () => Promise<void>;
}) {
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const [selected, setSelected] = useState<Exclude<
    VerificationStatus,
    "PENDING"
  > | null>(options[0] ?? null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const submissionRef = useRef<{
    status: Exclude<VerificationStatus, "PENDING">;
    key: string;
  } | null>(null);

  return (
    <>
      {error && (
        <div
          className={`form-alert ${conflict ? "form-alert--conflict" : ""}`}
          role="alert"
        >
          <strong>
            {conflict ? "A newer version exists" : "Could not record outcome"}
          </strong>
          <p>{error}</p>
          {conflict && (
            <button onClick={() => void onReload()} type="button">
              Reload latest version
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setConfirming(true);
        }}
      >
        <fieldset className="verification-options" disabled={saving}>
          <legend>Outcome to record</legend>
          {options.map((status) => (
            <label key={status}>
              <input
                checked={selected === status}
                name="verification-status"
                onChange={() => {
                  setSelected(status);
                  setConfirming(false);
                  submissionRef.current = null;
                }}
                type="radio"
                value={status}
              />
              <span>
                <strong>{verificationLabel(status)}</strong>
                <small>{verificationDescription(status)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {confirming && selected ? (
          <div className="decision-confirmation">
            <p>
              Record <strong>{verificationLabel(selected)}</strong>? This is
              your attestation only and does not change commitment tracking.
            </p>
            <div>
              <Button
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setError(null);
                  setConflict(false);
                  const submission =
                    submissionRef.current?.status === selected
                      ? submissionRef.current
                      : {
                          status: selected,
                          key: createIdempotencyKey("verification"),
                        };
                  submissionRef.current = submission;
                  try {
                    const updated = await api.verifyAttempt(
                      attempt.id,
                      `"${attempt.version}"`,
                      submission.key,
                      selected,
                    );
                    if (!hasSameAttemptIdentity(updated, attempt)) {
                      throw new Error(
                        "The API returned a different verification scope.",
                      );
                    }
                    submissionRef.current = null;
                    setConfirming(false);
                    onUpdated(
                      updated,
                      selected === "VERIFIED"
                        ? "Outcome recorded as user-confirmed after the due date—not independently verified."
                        : selected === "DISPUTED"
                          ? "Debit reported. Current savings state reversed; no refund action was taken."
                          : "External steps recorded as self-reported, not verified.",
                    );
                  } catch (caught) {
                    const failure = cancellationMutationFailure(caught, {
                      replayProtected: true,
                    });
                    setError(failure.message);
                    setConflict(failure.conflict);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Recording…" : "Record outcome"}
              </Button>
              <button
                className="secondary-link"
                disabled={saving}
                onClick={() => setConfirming(false)}
                type="button"
              >
                Go back
              </button>
            </div>
          </div>
        ) : (
          <Button disabled={!selected || saving} type="submit">
            Review outcome
          </Button>
        )}
      </form>
    </>
  );
}

function allowedTrackStatuses(
  current: AttemptTrackStatus,
): AttemptTrackStatus[] {
  if (current === "NOT_REQUIRED" || current === "CONFIRMED") {
    return [current];
  }
  if (current === "NOT_STARTED") {
    return ["NOT_STARTED", "REQUESTED", "CONFIRMED"];
  }
  if (current === "REQUESTED") {
    return ["REQUESTED", "CONFIRMED", "FAILED"];
  }
  return ["FAILED", "REQUESTED", "CONFIRMED"];
}

function trackStatusLabel(status: AttemptTrackStatus) {
  return {
    NOT_REQUIRED: "Not required",
    NOT_STARTED: "Not started",
    REQUESTED: "Requested externally",
    CONFIRMED: "You marked complete",
    FAILED: "External step did not complete",
  }[status];
}

function trackStatusDescription(status: AttemptTrackStatus) {
  if (status === "CONFIRMED") {
    return "This is your record of completion, not provider verification.";
  }
  if (status === "NOT_REQUIRED") {
    return "The server determined this track does not apply to the saved payment rail.";
  }
  return "Only your explicit save changes this status.";
}

function verificationOptions(
  attempt: CancellationAttempt,
): Array<Exclude<VerificationStatus, "PENDING">> {
  const due = attempt.verificationDueReached;
  if (attempt.abandoned || attempt.verificationStatus === "DISPUTED") {
    return [];
  }
  const complete =
    attempt.serviceStatus === "CONFIRMED" &&
    ["CONFIRMED", "NOT_REQUIRED"].includes(attempt.paymentMandateStatus);
  if (attempt.verificationStatus === "VERIFIED") {
    return due ? ["DISPUTED"] : [];
  }
  if (!complete) {
    return due ? ["DISPUTED"] : [];
  }
  if (attempt.verificationStatus === "SELF_REPORTED") {
    return due ? ["VERIFIED", "DISPUTED"] : [];
  }
  return due ? ["SELF_REPORTED", "VERIFIED", "DISPUTED"] : ["SELF_REPORTED"];
}

function verificationLabel(status: VerificationStatus) {
  return {
    PENDING: "Pending follow-up",
    SELF_REPORTED: "External steps self-reported",
    VERIFIED: "User-confirmed after the due date",
    DISPUTED: "Debit reported after the due date",
  }[status];
}

function verificationDescription(
  status: Exclude<VerificationStatus, "PENDING">,
) {
  if (status === "SELF_REPORTED") {
    return "You report finishing the external steps; a future debit has not been checked.";
  }
  if (status === "VERIFIED") {
    return "You report no debit after the due date. This is not bank, merchant, provider, or independent verification.";
  }
  return "You report that a debit occurred. Savings will be reversed without claiming or initiating a refund.";
}

function hasSameAttemptIdentity(
  candidate: CancellationAttempt,
  expected: CancellationAttempt,
) {
  return (
    candidate.id === expected.id &&
    candidate.householdId === expected.householdId &&
    candidate.commitmentId === expected.commitmentId &&
    candidate.decisionId === expected.decisionId &&
    candidate.guideId === expected.guideId &&
    candidate.guideVersion === expected.guideVersion &&
    candidate.guide.id === expected.guideId &&
    candidate.guide.version === expected.guideVersion &&
    candidate.scheduledDate === expected.scheduledDate
  );
}
