"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createIdempotencyKey } from "@/lib/idempotency-key";
import {
  GuideAdminApi,
  GuideAdminApiError,
  type AdminGuideDraft,
  type AdminGuideDraftStep,
  type AdminGuidePublication,
  type UpdateAdminGuideDraft,
} from "@/lib/guide-admin-api";

interface DraftForm {
  riskNotice: string;
  reviewIntervalDays: string;
  steps: Array<{
    track: AdminGuideDraftStep["track"];
    sequenceNumber: AdminGuideDraftStep["sequenceNumber"];
    title: string;
    instruction: string;
  }>;
}

type DraftState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      draft: AdminGuideDraft;
      form: DraftForm;
      savedForm: DraftForm;
    };

interface MutationError {
  message: string;
  reloadLatest: boolean;
}

export function AdminGuideDraftScreen({ draftId }: { draftId: string }) {
  const api = useMemo(() => new GuideAdminApi(), []);
  const [state, setState] = useState<DraftState>({ status: "loading" });
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [publishPhrase, setPublishPhrase] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<MutationError | null>(
    null,
  );
  const [publication, setPublication] = useState<AdminGuidePublication | null>(
    null,
  );
  const publishKey = useRef<{ version: number; key: string } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const draft = await api.getDraft(draftId, signal);
        if (!signal?.aborted) {
          const form = formFromDraft(draft);
          setState({ status: "ready", draft, form, savedForm: form });
        }
      } catch (error) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            message: draftLoadError(
              error,
              "The fictional guide draft could not be loaded.",
            ),
          });
        }
      }
    },
    [api, draftId],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void load(controller.signal);
      }
    });
    return () => controller.abort();
  }, [load]);

  if (publication) {
    return (
      <div className="notification-settings-page">
        <header className="resource-heading">
          <div>
            <p className="eyebrow">Publication complete</p>
            <h1>Fictional guide published</h1>
            <p>
              Version {publication.publishedVersion} is now the current
              fictional local guide. This does not verify a merchant or link,
              and no provider was contacted.
            </p>
          </div>
        </header>
        <section className="notification-settings-card max-w-3xl">
          <dl className="diagnostic-counts">
            <Metric label="Guide ID" value={publication.guideId} />
            <Metric
              label="Published version"
              value={publication.publishedVersion}
            />
            <Metric
              label="Catalog ETag version"
              value={publication.catalogVersion}
            />
            <Metric
              label="Published locally"
              value={formatInstant(publication.publishedAt)}
            />
          </dl>
          <Link
            className="primary-action mt-6 inline-flex"
            href={`/admin/guides/${encodeURIComponent(publication.guideId)}`}
          >
            Review immutable published history
          </Link>
        </section>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading guide draft…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Draft unavailable</strong>
        <p>{state.message}</p>
        <Link className="secondary-link" href="/admin/guides">
          Return to guide administration
        </Link>
      </div>
    );
  }

  const { draft, form, savedForm } = state;
  const validation = validateDraft(form, draft);
  const dirty = !sameForm(form, savedForm);
  const expectedPublishPhrase = `PUBLISH VERSION ${draft.guideVersion}`;

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Server-cloned draft</p>
          <h1>Edit fictional guide text</h1>
          <p>
            Only the risk notice, the 30–90 day review interval, and existing
            step title and instruction text are editable. All identifiers,
            merchant data, versions, status, timestamps, tracks, sequence,
            action types, targets, allowlists, and catalog-head state remain
            immutable and server controlled.
          </p>
        </div>
        <Link
          className="secondary-link"
          href={`/admin/guides/${encodeURIComponent(draft.guideId)}`}
        >
          Back to immutable history
        </Link>
      </header>

      {message && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {message}
        </div>
      )}
      {mutationError && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>Draft operation was not completed</strong>
          <p>{mutationError.message}</p>
          {mutationError.reloadLatest && (
            <button
              className="secondary-link secondary-link--button"
              onClick={() => {
                setState({ status: "loading" });
                setMutationError(null);
                setMessage(null);
                publishKey.current = null;
                void load();
              }}
              type="button"
            >
              Reload latest draft
            </button>
          )}
        </div>
      )}

      <section className="notification-settings-card">
        <div className="settings-card-heading">
          <p className="card-kicker">Immutable draft identity</p>
          <h2>Server-controlled fields</h2>
          <p>
            These values are displayed for review and are never submitted by
            this editor.
          </p>
        </div>
        <dl className="diagnostic-counts mt-6">
          <Metric label="Draft ID" value={draft.draftId} />
          <Metric label="Guide ID" value={draft.guideId} />
          <Metric label="Guide version" value={draft.guideVersion} />
          <Metric label="Status" value={draft.status} />
          <Metric label="Draft ETag version" value={draft.version} />
          <Metric
            label="Structural review"
            value={formatInstant(draft.structuralReviewedAt)}
          />
          <Metric label="Created" value={formatInstant(draft.createdAt)} />
          <Metric label="Updated" value={formatInstant(draft.updatedAt)} />
        </dl>
      </section>

      <form
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void saveDraft();
        }}
      >
        <section
          className="notification-settings-card"
          aria-labelledby="draft-copy-heading"
        >
          <div className="settings-card-heading">
            <p className="card-kicker">Editable review copy</p>
            <h2 id="draft-copy-heading">Risk and review interval</h2>
          </div>

          <label className="field-label mt-6" htmlFor="draft-risk-notice">
            Risk notice
          </label>
          <textarea
            aria-describedby="draft-risk-notice-hint"
            aria-invalid={Boolean(validation.riskNotice)}
            className="form-input min-h-32 resize-y"
            id="draft-risk-notice"
            maxLength={1000}
            onChange={(event) =>
              updateForm((current) => ({
                ...current,
                riskNotice: event.target.value,
              }))
            }
            value={form.riskNotice}
          />
          <p
            className={
              validation.riskNotice ? "field-error mt-2" : "field-hint mt-2"
            }
            id="draft-risk-notice-hint"
          >
            {validation.riskNotice ??
              `${form.riskNotice.length.toLocaleString()} of 1,000 characters`}
          </p>

          <label className="field-label mt-5" htmlFor="draft-review-interval">
            Review interval in days
          </label>
          <input
            aria-describedby="draft-review-interval-hint"
            aria-invalid={Boolean(validation.reviewIntervalDays)}
            className="form-input"
            id="draft-review-interval"
            inputMode="numeric"
            max={90}
            min={30}
            onChange={(event) =>
              updateForm((current) => ({
                ...current,
                reviewIntervalDays: event.target.value,
              }))
            }
            step={1}
            type="number"
            value={form.reviewIntervalDays}
          />
          <p
            className={
              validation.reviewIntervalDays
                ? "field-error mt-2"
                : "field-hint mt-2"
            }
            id="draft-review-interval-hint"
          >
            {validation.reviewIntervalDays ??
              "Enter a whole number from 30 through 90."}
          </p>
        </section>

        <section
          className="notification-settings-card"
          aria-labelledby="draft-steps-heading"
        >
          <div className="settings-card-heading">
            <p className="card-kicker">Existing structure only</p>
            <h2 id="draft-steps-heading">Step title and instruction text</h2>
            <p>
              Track, sequence, action type, target key, and target URI are
              immutable. The editor cannot add, remove, or reorder steps.
            </p>
          </div>

          {validation.structure && (
            <div
              className="resource-state resource-state--error mt-6"
              role="alert"
            >
              <strong>Draft structure is invalid</strong>
              <p>{validation.structure}</p>
            </div>
          )}

          <div className="mt-6 grid gap-5">
            {draft.steps.map((step, index) => {
              const editableStep = form.steps[index];
              const stepKey = `${step.track}:${step.sequenceNumber}`;
              const titleError = validation.stepTitles[stepKey];
              const instructionError = validation.stepInstructions[stepKey];
              if (!editableStep) {
                return null;
              }
              return (
                <fieldset
                  className="rounded-3xl border border-emerald-950/10 bg-white p-5"
                  key={stepKey}
                >
                  <legend className="px-2 text-lg font-black text-emerald-950">
                    {formatTrack(step.track)} · step {step.sequenceNumber}
                  </legend>

                  <dl className="diagnostic-timing mt-3">
                    <div>
                      <dt>Track</dt>
                      <dd>{step.track}</dd>
                    </div>
                    <div>
                      <dt>Sequence</dt>
                      <dd>{step.sequenceNumber}</dd>
                    </div>
                    <div>
                      <dt>Action type</dt>
                      <dd>{step.actionType}</dd>
                    </div>
                    <div>
                      <dt>Target key</dt>
                      <dd className="break-all">{step.targetKey ?? "None"}</dd>
                    </div>
                    <div>
                      <dt>Target URI</dt>
                      <dd className="break-all">{step.targetUri ?? "None"}</dd>
                    </div>
                  </dl>

                  <label
                    className="field-label mt-5"
                    htmlFor={`draft-step-title-${index}`}
                  >
                    Step title
                  </label>
                  <input
                    aria-describedby={`draft-step-title-hint-${index}`}
                    aria-invalid={Boolean(titleError)}
                    className="form-input"
                    id={`draft-step-title-${index}`}
                    maxLength={160}
                    onChange={(event) =>
                      updateStep(index, {
                        title: event.target.value,
                      })
                    }
                    value={editableStep.title}
                  />
                  <p
                    className={
                      titleError ? "field-error mt-2" : "field-hint mt-2"
                    }
                    id={`draft-step-title-hint-${index}`}
                  >
                    {titleError ??
                      `${editableStep.title.length.toLocaleString()} of 160 characters`}
                  </p>

                  <label
                    className="field-label mt-5"
                    htmlFor={`draft-step-instruction-${index}`}
                  >
                    Step instruction
                  </label>
                  <textarea
                    aria-describedby={`draft-step-instruction-hint-${index}`}
                    aria-invalid={Boolean(instructionError)}
                    className="form-input min-h-32 resize-y"
                    id={`draft-step-instruction-${index}`}
                    maxLength={1000}
                    onChange={(event) =>
                      updateStep(index, {
                        instruction: event.target.value,
                      })
                    }
                    value={editableStep.instruction}
                  />
                  <p
                    className={
                      instructionError ? "field-error mt-2" : "field-hint mt-2"
                    }
                    id={`draft-step-instruction-hint-${index}`}
                  >
                    {instructionError ??
                      `${editableStep.instruction.length.toLocaleString()} of 1,000 characters`}
                  </p>
                </fieldset>
              );
            })}
          </div>
        </section>

        <section className="notification-settings-card">
          <div className="settings-card-heading">
            <p className="card-kicker">Conditional draft write</p>
            <h2>Save allowed fields</h2>
            <p>
              Saving sends only risk notice, review interval, and existing step
              identity plus title and instruction, using the current quoted
              draft ETag.
            </p>
          </div>
          <button
            className="primary-action mt-5"
            disabled={!dirty || !validation.valid || busy !== null}
            type="submit"
          >
            {busy === "save" ? "Saving draft…" : "Save draft text"}
          </button>
          {!dirty && (
            <p className="field-hint mt-3">
              No editable draft fields have changed.
            </p>
          )}
        </section>
      </form>

      <section
        className="notification-settings-card"
        aria-labelledby="publish-guide-heading"
      >
        <div className="settings-card-heading">
          <p className="card-kicker">Explicit publication</p>
          <h2 id="publish-guide-heading">Publish this fictional local guide</h2>
          <p>
            Publication revalidates all structural and safe-target rules,
            creates immutable lock snapshots, and advances the catalog head in
            one transaction. It never means a merchant or link was verified, and
            it does not contact a provider.
          </p>
        </div>
        {dirty && (
          <p className="field-error mt-5" role="alert">
            Save or discard editable changes before publishing.
          </p>
        )}
        <label
          className="field-label mt-5"
          htmlFor="publish-guide-confirmation"
        >
          Type {expectedPublishPhrase}
        </label>
        <input
          autoComplete="off"
          className="form-input"
          id="publish-guide-confirmation"
          onChange={(event) => {
            setPublishPhrase(event.target.value);
            setMutationError(null);
          }}
          value={publishPhrase}
        />
        <button
          className="primary-action mt-4"
          disabled={
            publishPhrase !== expectedPublishPhrase ||
            dirty ||
            !validation.valid ||
            busy !== null
          }
          onClick={() => void publishDraft()}
          type="button"
        >
          {busy === "publish"
            ? "Publishing fictional guide…"
            : "Publish fictional guide"}
        </button>
      </section>
    </div>
  );

  function updateForm(transform: (current: DraftForm) => DraftForm) {
    setState((current) =>
      current.status === "ready"
        ? { ...current, form: transform(current.form) }
        : current,
    );
    setPublishPhrase("");
    setMessage(null);
    setMutationError(null);
  }

  function updateStep(
    index: number,
    patch: Partial<Pick<DraftForm["steps"][number], "title" | "instruction">>,
  ) {
    updateForm((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    }));
  }

  async function saveDraft() {
    if (state.status !== "ready") {
      return;
    }
    const validationResult = validateDraft(state.form, state.draft);
    if (!validationResult.valid) {
      setMutationError({
        message: "Correct the highlighted editable fields before saving.",
        reloadLatest: false,
      });
      return;
    }
    setBusy("save");
    setMessage(null);
    setMutationError(null);
    try {
      const updated = await api.updateDraft(
        state.draft.draftId,
        state.draft.version,
        payloadFromForm(state.form),
      );
      const form = formFromDraft(updated);
      setState({
        status: "ready",
        draft: updated,
        form,
        savedForm: form,
      });
      publishKey.current = null;
      setPublishPhrase("");
      setMessage(
        `Draft text saved with conditional version ${updated.version}.`,
      );
    } catch (error) {
      setMutationError(
        draftMutationError(error, "The draft could not be saved."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function publishDraft() {
    if (state.status !== "ready") {
      return;
    }
    if (!sameForm(state.form, state.savedForm)) {
      setMutationError({
        message: "Save or discard editable changes before publishing.",
        reloadLatest: false,
      });
      return;
    }
    const version = state.draft.version;
    setBusy("publish");
    setMessage(null);
    setMutationError(null);
    const keyRecord =
      publishKey.current?.version === version
        ? publishKey.current
        : {
            version,
            key: createIdempotencyKey("guide-draft-publish"),
          };
    publishKey.current = keyRecord;
    try {
      const published = await api.publishDraft(
        state.draft.draftId,
        version,
        keyRecord.key,
      );
      publishKey.current = null;
      setPublication(published);
    } catch (error) {
      setMutationError(
        draftMutationError(
          error,
          "The fictional guide could not be published.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }
}

function formFromDraft(draft: AdminGuideDraft): DraftForm {
  return {
    riskNotice: draft.riskNotice,
    reviewIntervalDays: String(draft.reviewIntervalDays),
    steps: draft.steps.map((step) => ({
      track: step.track,
      sequenceNumber: step.sequenceNumber,
      title: step.title,
      instruction: step.instruction,
    })),
  };
}

function payloadFromForm(form: DraftForm): UpdateAdminGuideDraft {
  return {
    riskNotice: form.riskNotice.trim(),
    reviewIntervalDays: Number(form.reviewIntervalDays),
    steps: form.steps.map((step) => ({
      track: step.track,
      sequenceNumber: step.sequenceNumber,
      title: step.title.trim(),
      instruction: step.instruction.trim(),
    })),
  };
}

function sameForm(left: DraftForm, right: DraftForm) {
  return (
    left.riskNotice === right.riskNotice &&
    left.reviewIntervalDays === right.reviewIntervalDays &&
    left.steps.length === right.steps.length &&
    left.steps.every((step, index) => {
      const other = right.steps[index];
      return (
        other !== undefined &&
        step.track === other.track &&
        step.sequenceNumber === other.sequenceNumber &&
        step.title === other.title &&
        step.instruction === other.instruction
      );
    })
  );
}

function validateDraft(form: DraftForm, draft: AdminGuideDraft) {
  const stepTitles: Record<string, string> = {};
  const stepInstructions: Record<string, string> = {};
  const structure =
    form.steps.length === 4 &&
    draft.steps.length === 4 &&
    form.steps.every((step, index) => {
      const immutable = draft.steps[index];
      return (
        immutable !== undefined &&
        step.track === immutable.track &&
        step.sequenceNumber === immutable.sequenceNumber
      );
    })
      ? null
      : "A draft must retain the server-provided four-step structure and order.";

  for (const step of form.steps) {
    const key = `${step.track}:${step.sequenceNumber}`;
    const title = step.title.trim();
    const instruction = step.instruction.trim();
    if (title.length < 1 || title.length > 160) {
      stepTitles[key] = "Enter 1 through 160 non-blank characters.";
    }
    if (instruction.length < 1 || instruction.length > 1000) {
      stepInstructions[key] = "Enter 1 through 1,000 non-blank characters.";
    }
  }

  const riskNotice =
    form.riskNotice.trim().length < 1 || form.riskNotice.trim().length > 1000
      ? "Enter 1 through 1,000 non-blank characters."
      : null;
  const parsedInterval = Number(form.reviewIntervalDays);
  const reviewIntervalDays =
    !Number.isInteger(parsedInterval) ||
    parsedInterval < 30 ||
    parsedInterval > 90
      ? "Enter a whole number from 30 through 90."
      : null;
  const valid =
    !riskNotice &&
    !reviewIntervalDays &&
    !structure &&
    Object.keys(stepTitles).length === 0 &&
    Object.keys(stepInstructions).length === 0;

  return {
    valid,
    riskNotice,
    reviewIntervalDays,
    structure,
    stepTitles,
    stepInstructions,
  };
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}

function draftLoadError(error: unknown, fallback: string) {
  if (error instanceof GuideAdminApiError) {
    if (error.status === 401) {
      return "Your session expired. Sign in again before continuing.";
    }
    if (error.status === 403 || error.status === 404) {
      return "This guide draft is unavailable to the current role or no longer exists.";
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function draftMutationError(error: unknown, fallback: string): MutationError {
  if (error instanceof GuideAdminApiError) {
    if (error.status === 409) {
      return {
        message:
          "This operation conflicts with the latest server state or an earlier idempotent request. Reload before deciding again.",
        reloadLatest: true,
      };
    }
    if (error.status === 412) {
      return {
        message:
          "This draft changed in another session. Your unsaved text remains on screen; reload only when you are ready to replace it.",
        reloadLatest: true,
      };
    }
    if (error.status === 428) {
      return {
        message:
          "The conditional draft version was missing. Reload before retrying.",
        reloadLatest: true,
      };
    }
    if (error.status === 400) {
      return {
        message:
          "The server rejected an editable field. Review the risk notice, 30–90 day interval, and existing step text.",
        reloadLatest: false,
      };
    }
    if (error.status === 401) {
      return {
        message: "Your session expired. Sign in again before continuing.",
        reloadLatest: false,
      };
    }
    if (error.status === 403 || error.status === 404) {
      return {
        message:
          "This guide-admin operation is unavailable to the current role or draft.",
        reloadLatest: false,
      };
    }
  }
  return {
    message: error instanceof Error ? error.message : fallback,
    reloadLatest: false,
  };
}

function formatTrack(track: AdminGuideDraftStep["track"]) {
  return track === "SERVICE" ? "Merchant service" : "Payment mandate";
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
