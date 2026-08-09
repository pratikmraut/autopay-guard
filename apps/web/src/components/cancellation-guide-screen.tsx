"use client";

import {
  ApiClientError,
  FoundationApi,
  type Commitment,
} from "@autopay-guard/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import { Button } from "@/components/ui/button";
import {
  CancellationApi,
  type CancellationAttempt,
  type CancellationGuide,
  type FeedbackOutcome,
  type GuideStep,
  type GuideTrackKind,
} from "@/lib/cancellation-api";
import {
  cancellationLoadErrorMessage,
  cancellationMutationFailure,
} from "@/lib/cancellation-api-messages";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { formatLocalDate } from "@/lib/local-date";
import { parseSafeGuideTarget } from "@/lib/safe-guide-target";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GuideState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      commitment: Commitment;
      guide: CancellationGuide | null;
      attempts: CancellationAttempt[];
    };

export function CancellationGuideScreen({
  commitmentId,
}: {
  commitmentId: string;
}) {
  const household = useSelectedHousehold();
  const searchParams = useSearchParams();
  const occurrenceId = safeUuid(searchParams.get("occurrenceId"));
  const decisionId = safeUuid(searchParams.get("decisionId"));
  const requestKey = `${household.id}:${commitmentId}`;
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const foundationApi = useMemo(
    () => new FoundationApi({ baseUrl: "/api/bff" }),
    [],
  );
  const [state, setState] = useState<GuideState>({
    status: "loading",
    requestKey: null,
  });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const guidePromise = api
          .getGuide(commitmentId, { signal })
          .catch((error: unknown) => {
            if (error instanceof ApiClientError && error.status === 404) {
              return null;
            }
            throw error;
          });
        const [commitment, guide, attempts] = await Promise.all([
          foundationApi.getCommitment({ commitmentId }, { signal }),
          guidePromise,
          api.listAttempts(
            commitmentId,
            { householdId: household.id, limit: 25 },
            { signal },
          ),
        ]);
        if (signal?.aborted) {
          return;
        }
        if (
          commitment.id !== commitmentId ||
          commitment.householdId !== household.id ||
          attempts.householdId !== household.id ||
          attempts.commitmentId !== commitmentId ||
          attempts.items.some(
            (attempt) =>
              attempt.householdId !== household.id ||
              attempt.commitmentId !== commitmentId,
          ) ||
          (guide &&
            (guide.householdId !== household.id ||
              guide.commitmentId !== commitmentId))
        ) {
          throw new Error("The API returned a different cancellation scope.");
        }
        setState((current) =>
          current.requestKey === requestKey
            ? {
                status: "ready",
                requestKey,
                commitment,
                guide,
                attempts: attempts.items,
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
                  message: cancellationLoadErrorMessage(error),
                }
              : current,
          );
        }
      }
    },
    [api, commitmentId, foundationApi, household.id, requestKey],
  );

  const reload = useCallback(async () => {
    setState({ status: "loading", requestKey });
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
        Loading fictional cancellation guidance…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Cancellation guidance unavailable</strong>
        <p>{state.message}</p>
        <button onClick={() => void reload()} type="button">
          Try again
        </button>
      </div>
    );
  }

  const activeAttempt = state.attempts.find(
    (attempt) =>
      !attempt.abandoned &&
      (attempt.verificationStatus === "PENDING" ||
        attempt.verificationStatus === "SELF_REPORTED"),
  );
  return (
    <div className="cancellation-guide-page">
      <Link
        className="back-link"
        href={`/commitments/${encodeURIComponent(commitmentId)}?householdId=${encodeURIComponent(household.id)}`}
      >
        ← Commitment details
      </Link>
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Fictional local guidance</p>
          <h1>{state.commitment.displayName} cancellation guide</h1>
          <p>
            You perform every external step yourself. AutoPay Guard does not
            contact a merchant, cancel a service, revoke a mandate, or move
            money.
          </p>
        </div>
        <Link
          className="secondary-link secondary-link--button"
          href={`/upcoming/decisions?householdId=${encodeURIComponent(household.id)}`}
        >
          Decision inbox
        </Link>
      </header>

      {!state.guide ? (
        <section className="notification-empty" aria-labelledby="no-guide">
          <span aria-hidden="true">i</span>
          <h2 id="no-guide">No current fictional guide is available</h2>
          <p>
            AutoPay Guard will not invent a target or use the merchant host as a
            fallback. Continue tracking this commitment or use your own trusted
            provider channel outside the app.
          </p>
        </section>
      ) : (
        <>
          <GuideOverview guide={state.guide} />
          <GuideTracks guide={state.guide} />

          {activeAttempt ? (
            <section className="cancellation-action-card">
              <div>
                <p className="card-kicker">Attempt in progress</p>
                <h2>Resume your private tracking record</h2>
                <p>
                  Opening or completing a guide target never changes this record
                  automatically.
                </p>
              </div>
              <Link
                className="primary-link"
                href={`/commitments/${encodeURIComponent(commitmentId)}/cancellation/attempts/${encodeURIComponent(activeAttempt.id)}?householdId=${encodeURIComponent(household.id)}`}
              >
                Resume attempt
                <span aria-hidden="true">→</span>
              </Link>
            </section>
          ) : (
            <StartAttemptPanel
              commitment={state.commitment}
              decisionId={decisionId}
              guide={state.guide}
              householdId={household.id}
              occurrenceId={occurrenceId}
            />
          )}
          <GuideFeedbackForm
            commitmentId={commitmentId}
            guide={state.guide}
            onUnsafeReported={reload}
          />
        </>
      )}

      {state.attempts.length > 0 && (
        <section className="attempt-history" aria-labelledby="attempt-history">
          <div>
            <p className="card-kicker">History stays explainable</p>
            <h2 id="attempt-history">Cancellation attempts</h2>
          </div>
          <ol>
            {state.attempts.map((attempt) => (
              <li key={attempt.id}>
                <div>
                  <strong>
                    Guide version {attempt.guideVersion} ·{" "}
                    {attempt.abandoned
                      ? "Abandoned"
                      : verificationLabel(attempt.verificationStatus)}
                  </strong>
                  <small>
                    Started {formatInstant(attempt.createdAt)} · Scheduled{" "}
                    {formatLocalDate(attempt.scheduledDate)}
                  </small>
                </div>
                <Link
                  href={`/commitments/${encodeURIComponent(commitmentId)}/cancellation/attempts/${encodeURIComponent(attempt.id)}?householdId=${encodeURIComponent(household.id)}`}
                >
                  Open record
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function GuideOverview({ guide }: { guide: CancellationGuide }) {
  return (
    <section className="guide-overview" aria-labelledby="guide-overview">
      <div>
        <p className="card-kicker">{guide.merchantName}</p>
        <h2 id="guide-overview">Guide version {guide.version}</h2>
        <p>
          Structurally reviewed as a fictional fixture{" "}
          {formatInstant(guide.structuralReviewedAt)}. This is not merchant,
          bank, provider, or independent verification.
        </p>
      </div>
      <dl>
        <div>
          <dt>Freshness</dt>
          <dd>
            {guide.freshness === "CURRENT" ? "Current fixture" : "Review due"}
          </dd>
        </div>
        <div>
          <dt>Review due</dt>
          <dd>{formatInstant(guide.reviewDueAt)}</dd>
        </div>
      </dl>
      <aside className="guide-risk-notice" aria-label="Guide risk notice">
        <strong>Before opening a target</strong>
        <p>{guide.riskNotice}</p>
      </aside>
      {guide.targetsSuppressed && (
        <div className="form-alert form-alert--conflict" role="status">
          <strong>Guide targets withheld</strong>
          <p>
            {guide.targetSuppressionReason === "REVIEW_DUE"
              ? "This fixture is due for structural review. Read-only steps remain visible, but targets and new attempts are disabled."
              : "You reported this guide version as unsafe. Targets and new attempts are disabled for your account."}
          </p>
        </div>
      )}
    </section>
  );
}

export function GuideTracks({ guide }: { guide: CancellationGuide }) {
  return (
    <div className="guide-track-grid">
      {(["SERVICE", "PAYMENT_MANDATE"] as const).map((trackKind) => {
        const track = guide.tracks.find(
          (candidate) => candidate.track === trackKind,
        );
        return (
          <section
            aria-labelledby={`guide-track-${trackKind}`}
            className="guide-track"
            key={trackKind}
          >
            <p className="card-kicker">
              {trackKind === "SERVICE" ? "Track 1" : "Track 2"}
            </p>
            <h2 id={`guide-track-${trackKind}`}>
              {track?.title ?? trackLabel(trackKind)}
            </h2>
            <p>
              {trackKind === "SERVICE"
                ? "Merchant-service cancellation is separate from any payment instruction."
                : "A payment-mandate action does not itself cancel the merchant service."}
            </p>
            {track ? (
              <ol>
                {[...track.steps]
                  .sort((left, right) => left.sequence - right.sequence)
                  .map((step) => (
                    <GuideStepView
                      key={`${trackKind}:${step.sequence}`}
                      step={step}
                      targetsSuppressed={guide.targetsSuppressed}
                    />
                  ))}
              </ol>
            ) : (
              <div className="form-alert" role="alert">
                The guide did not return this required track.
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GuideStepView({
  step,
  targetsSuppressed,
}: {
  step: GuideStep;
  targetsSuppressed: boolean;
}) {
  return (
    <li>
      <span aria-hidden="true">{step.sequence}</span>
      <div>
        <strong>{step.title}</strong>
        <p>{step.instruction}</p>
        {step.kind !== "INFORMATION" &&
          (targetsSuppressed || !step.target ? (
            <small className="guide-target-withheld">
              External demo target withheld
            </small>
          ) : (
            <GuideTargetLink step={step} />
          ))}
      </div>
    </li>
  );
}

function GuideTargetLink({ step }: { step: GuideStep }) {
  const parsed = step.target ? parseSafeGuideTarget(step.target.uri) : null;
  if (!parsed) {
    return (
      <small className="guide-target-withheld" role="alert">
        Unsafe target withheld by this browser
      </small>
    );
  }
  return (
    <a
      aria-label={`${step.target?.label ?? "Open demo target"} — fictional external demo guidance${parsed.kind === "HTTPS" ? ", opens in a new tab" : ""}`}
      className="guide-target-link"
      href={parsed.href}
      rel={parsed.kind === "HTTPS" ? "noopener noreferrer" : undefined}
      target={parsed.kind === "HTTPS" ? "_blank" : undefined}
    >
      {step.target?.label ?? "Open demo target"}
      <small>{parsed.displayHost} · explicit external gesture</small>
    </a>
  );
}

function StartAttemptPanel({
  commitment,
  guide,
  householdId,
  occurrenceId,
  decisionId,
}: {
  commitment: Commitment;
  guide: CancellationGuide;
  householdId: string;
  occurrenceId: string | null;
  decisionId: string | null;
}) {
  const router = useRouter();
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionRef = useRef<string | null>(null);
  const canStart =
    commitment.status !== "ARCHIVED" &&
    guide.freshness === "CURRENT" &&
    !guide.targetsSuppressed &&
    occurrenceId !== null &&
    decisionId !== null;

  return (
    <section
      className="cancellation-action-card"
      aria-labelledby="start-attempt"
    >
      <div>
        <p className="card-kicker">Optional private record</p>
        <h2 id="start-attempt">Start a cancellation attempt</h2>
        <p>
          This pins guide version {guide.version} and records your progress. It
          does not open a target, contact a provider, or stop commitment
          tracking.
        </p>
      </div>
      {!occurrenceId || !decisionId ? (
        <div className="form-alert">
          <strong>Record a cancel decision first</strong>
          <p>
            Choose “Plan to cancel with provider” for an eligible occurrence in
            the decision inbox before starting an attempt.
          </p>
          <Link
            className="secondary-link"
            href={`/upcoming/decisions?householdId=${encodeURIComponent(householdId)}`}
          >
            Open decision inbox
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div className="form-alert" role="alert">
              <strong>Could not start attempt</strong>
              <p>{error}</p>
            </div>
          )}
          <div className="form-field">
            <label htmlFor="attempt-note">Private note (optional)</label>
            <textarea
              className="field-input"
              disabled={saving}
              id="attempt-note"
              maxLength={500}
              onChange={(event) => {
                setNote(event.target.value);
                submissionRef.current = null;
              }}
              rows={3}
              value={note}
            />
            <p>
              Never enter a PIN, OTP, password, full account/card number, or UPI
              ID.
            </p>
          </div>
          {confirming ? (
            <div className="decision-confirmation">
              <p>
                Start this tracking record with the structurally reviewed
                fictional guide version {guide.version}?
              </p>
              <div>
                <Button
                  disabled={!canStart || saving}
                  onClick={async () => {
                    setSaving(true);
                    setError(null);
                    const key =
                      submissionRef.current ??
                      createIdempotencyKey("cancellation-attempt");
                    submissionRef.current = key;
                    try {
                      const attempt = await api.createAttempt(
                        commitment.id,
                        key,
                        {
                          occurrenceId,
                          decisionId,
                          guideId: guide.id,
                          guideVersion: guide.version,
                          note: note.trim() || null,
                        },
                      );
                      if (
                        attempt.commitmentId !== commitment.id ||
                        attempt.householdId !== householdId ||
                        attempt.occurrenceId !== occurrenceId ||
                        attempt.decisionId !== decisionId ||
                        attempt.guideId !== guide.id ||
                        attempt.guideVersion !== guide.version ||
                        attempt.guide.id !== guide.id ||
                        attempt.guide.version !== guide.version
                      ) {
                        throw new Error(
                          "The API returned a different attempt scope.",
                        );
                      }
                      submissionRef.current = null;
                      router.push(
                        `/commitments/${encodeURIComponent(commitment.id)}/cancellation/attempts/${encodeURIComponent(attempt.id)}?householdId=${encodeURIComponent(householdId)}&started=1`,
                      );
                    } catch (caught) {
                      setError(
                        cancellationMutationFailure(caught, {
                          replayProtected: true,
                        }).message,
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? "Starting…" : "Start tracking attempt"}
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
            <Button
              disabled={!canStart}
              onClick={() => setConfirming(true)}
              type="button"
            >
              Start attempt
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function GuideFeedbackForm({
  commitmentId,
  guide,
  onUnsafeReported,
}: {
  commitmentId: string;
  guide: CancellationGuide;
  onUnsafeReported: () => Promise<void>;
}) {
  const api = useMemo(() => new CancellationApi({ baseUrl: "/api/bff" }), []);
  const [outcome, setOutcome] = useState<FeedbackOutcome>("WORKED");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submissionRef = useRef<{
    payload: string;
    key: string;
  } | null>(null);

  return (
    <section className="guide-feedback-card" aria-labelledby="guide-feedback">
      <div>
        <p className="card-kicker">Owner feedback</p>
        <h2 id="guide-feedback">How was this fictional guide?</h2>
        <p>
          Feedback cannot edit the guide. Reporting an unsafe link immediately
          suppresses this version’s targets for your account.
        </p>
      </div>
      {message && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {message}
        </div>
      )}
      {error && (
        <div className="form-alert" role="alert">
          <strong>Could not save feedback</strong>
          <p>{error}</p>
        </div>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError(null);
          setMessage(null);
          const body = {
            commitmentId,
            guideVersion: guide.version,
            outcome,
            note: note.trim() || null,
          };
          const payload = JSON.stringify(body);
          const submission =
            submissionRef.current?.payload === payload
              ? submissionRef.current
              : {
                  payload,
                  key: createIdempotencyKey("guide-feedback"),
                };
          submissionRef.current = submission;
          try {
            await api.submitFeedback(guide.id, submission.key, body);
            submissionRef.current = null;
            setMessage(
              outcome === "UNSAFE_LINK"
                ? "Unsafe-link report saved. Targets are now withheld."
                : "Guide feedback saved.",
            );
            if (outcome === "UNSAFE_LINK") {
              await onUnsafeReported();
            }
          } catch (caught) {
            setError(
              cancellationMutationFailure(caught, {
                replayProtected: true,
              }).message,
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="form-grid form-grid--two">
          <div className="form-field">
            <label htmlFor="feedback-outcome">Feedback</label>
            <select
              className="field-input"
              disabled={saving}
              id="feedback-outcome"
              onChange={(event) => {
                setOutcome(event.target.value as FeedbackOutcome);
                submissionRef.current = null;
              }}
              value={outcome}
            >
              <option value="WORKED">Steps worked for this demo</option>
              <option value="OUTDATED">Steps appear outdated</option>
              <option value="MERCHANT_CHANGED_FLOW">
                Fictional merchant flow changed
              </option>
              <option value="UNSAFE_LINK">Report unsafe link</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="feedback-note">Safe note (optional)</label>
            <textarea
              className="field-input"
              disabled={saving}
              id="feedback-note"
              maxLength={500}
              onChange={(event) => {
                setNote(event.target.value);
                submissionRef.current = null;
              }}
              rows={3}
              value={note}
            />
            <p>No credentials, account identifiers, addresses, or real data.</p>
          </div>
        </div>
        <Button disabled={saving} type="submit" variant="secondary">
          {saving ? "Saving…" : "Submit guide feedback"}
        </Button>
      </form>
    </section>
  );
}

function safeUuid(value: string | null) {
  return value && UUID.test(value) ? value : null;
}

function trackLabel(track: GuideTrackKind) {
  return track === "SERVICE"
    ? "Merchant-service cancellation"
    : "Payment-mandate action";
}

function verificationLabel(value: CancellationAttempt["verificationStatus"]) {
  if (value === "SELF_REPORTED") {
    return "External steps self-reported";
  }
  if (value === "VERIFIED") {
    return "User-confirmed after due date";
  }
  if (value === "DISPUTED") {
    return "Debit reported";
  }
  return "Pending";
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
