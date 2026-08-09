"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createIdempotencyKey } from "@/lib/idempotency-key";
import {
  GuideAdminApi,
  GuideAdminApiError,
  type AdminGuideSummary,
  type AdminGuideVersion,
} from "@/lib/guide-admin-api";

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      guide: AdminGuideSummary;
      versions: AdminGuideVersion[];
      nextVersionCursor: string | null;
    };

export function AdminGuideDetailScreen({ guideId }: { guideId: string }) {
  const router = useRouter();
  const api = useMemo(() => new GuideAdminApi(), []);
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [retirePhrase, setRetirePhrase] = useState("");
  const [busy, setBusy] = useState<"draft" | "retire" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [versionPageError, setVersionPageError] = useState<string | null>(null);
  const [loadingMoreVersions, setLoadingMoreVersions] = useState(false);
  const createDraftKey = useRef<string | null>(null);
  const retireKey = useRef<{ version: number; key: string } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [guide, versionPage] = await Promise.all([
          api.getGuide(guideId, signal),
          api.versions(guideId, signal),
        ]);
        if (!signal?.aborted) {
          setState({
            status: "ready",
            guide,
            versions: versionPage.items,
            nextVersionCursor: versionPage.nextCursor,
          });
          setVersionPageError(null);
        }
      } catch (error) {
        if (!signal?.aborted) {
          setState({
            status: "error",
            message: detailError(
              error,
              "The fictional guide could not be loaded.",
            ),
          });
        }
      }
    },
    [api, guideId],
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

  if (state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading guide history…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Guide unavailable</strong>
        <p>{state.message}</p>
        <Link className="secondary-link" href="/admin/guides">
          Return to guide administration
        </Link>
      </div>
    );
  }

  const { guide, versions } = state;
  const existingDrafts = versions.filter(
    (version) => version.status === "DRAFT" && version.draftId,
  );
  const canCreateDraft =
    guide.state === "ACTIVE" &&
    guide.currentPublishedVersion !== null &&
    existingDrafts.length === 0;
  const expectedRetirePhrase = "RETIRE GUIDE";

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Fictional local catalog</p>
          <h1>{guide.merchantName}</h1>
          <p>
            Review immutable published history and server-cloned drafts for this{" "}
            {guide.merchantCategory.toLowerCase()} guide. Guide and merchant
            identity, structure, targets, versions, timestamps, and head history
            are not editable.
          </p>
        </div>
        <Link className="secondary-link" href="/admin/guides">
          Back to guide administration
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
          <strong>Guide operation was not completed</strong>
          <p>{mutationError}</p>
          {[409, 412, 428].some((status) =>
            mutationError.startsWith(`HTTP ${status}:`),
          ) && (
            <button
              className="secondary-link secondary-link--button"
              onClick={() => {
                setState({ status: "loading" });
                setMutationError(null);
                void load();
              }}
              type="button"
            >
              Reload latest guide state
            </button>
          )}
        </div>
      )}

      <section className="notification-settings-card">
        <div className="settings-card-heading">
          <p className="card-kicker">Server-controlled head</p>
          <h2>Catalog state</h2>
          <p>
            The quoted catalog ETag is used for conditional retirement. Earlier
            published versions and attempts pinned to them remain unchanged.
          </p>
        </div>
        <dl className="diagnostic-counts mt-6">
          <Metric label="State" value={guide.state} />
          <Metric
            label="Current published version"
            value={guide.currentPublishedVersion ?? "None"}
          />
          <Metric label="Catalog ETag version" value={guide.version} />
          <Metric
            label="Last head event"
            value={formatInstant(guide.updatedAt)}
          />
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="primary-action"
            disabled={!canCreateDraft || busy !== null}
            onClick={() => void createDraft()}
            type="button"
          >
            {busy === "draft"
              ? "Cloning published version…"
              : "Create server-cloned draft"}
          </button>
          {!canCreateDraft && guide.state === "ACTIVE" && (
            <p className="field-hint basis-full">
              {existingDrafts.length > 0
                ? "Open the existing draft below before creating another."
                : "A current published version is required before cloning a draft."}
            </p>
          )}
        </div>
      </section>

      <section
        className="notification-settings-card"
        aria-labelledby="guide-history-heading"
      >
        <div className="settings-card-heading">
          <p className="card-kicker">Immutable history</p>
          <h2 id="guide-history-heading">Versions</h2>
          <p>
            Publishing creates a new immutable version and matching structural
            locks. A draft is excluded from owner guide reads and cannot start a
            cancellation attempt.
          </p>
        </div>

        {versions.length === 0 ? (
          <div className="resource-state mt-6">
            <strong>No guide versions</strong>
            <p>No immutable or draft version is available.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {versions.map((version) => (
              <article
                className="rounded-3xl border border-emerald-950/10 bg-white p-5"
                key={`${version.status}:${version.guideVersion}:${version.draftId ?? "published"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="card-kicker">
                      Guide version {version.guideVersion}
                    </p>
                    <h3 className="mt-2 text-xl font-black text-emerald-950">
                      {version.status === "DRAFT"
                        ? "Editable draft text"
                        : "Immutable published version"}
                    </h3>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-900">
                    {version.status}
                  </span>
                </div>
                <dl className="diagnostic-timing mt-5">
                  <div>
                    <dt>Review interval</dt>
                    <dd>{version.reviewIntervalDays} days</dd>
                  </div>
                  <div>
                    <dt>Structural review</dt>
                    <dd>{formatInstant(version.structuralReviewedAt)}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatInstant(version.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Published</dt>
                    <dd>
                      {version.publishedAt
                        ? formatInstant(version.publishedAt)
                        : "Not published"}
                    </dd>
                  </div>
                  {version.draftVersion !== null && (
                    <div>
                      <dt>Draft ETag version</dt>
                      <dd>{version.draftVersion}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-5 rounded-2xl bg-emerald-50/70 p-4 text-sm leading-6 text-slate-700">
                  <strong className="text-emerald-950">Risk notice</strong>
                  <p className="mt-1 whitespace-pre-wrap">
                    {version.riskNotice}
                  </p>
                </div>
                {version.status === "DRAFT" && version.draftId && (
                  <Link
                    className="secondary-link mt-5 inline-flex"
                    href={`/admin/guides/drafts/${encodeURIComponent(version.draftId)}`}
                  >
                    Edit allowed draft fields
                  </Link>
                )}
              </article>
            ))}
          </div>
        )}
        {versionPageError && (
          <div
            className="resource-state resource-state--error mt-5"
            role="alert"
          >
            <strong>More guide history could not be loaded</strong>
            <p>{versionPageError}</p>
          </div>
        )}
        {state.nextVersionCursor && (
          <button
            className="secondary-link secondary-link--button mt-5"
            disabled={loadingMoreVersions}
            onClick={() => void loadMoreVersions(state.nextVersionCursor!)}
            type="button"
          >
            {loadingMoreVersions ? "Loading…" : "Load more guide versions"}
          </button>
        )}
      </section>

      {guide.state === "ACTIVE" && (
        <section
          className="notification-settings-card border-red-200"
          aria-labelledby="retire-guide-heading"
        >
          <div className="settings-card-heading">
            <p className="card-kicker">Conditional head operation</p>
            <h2 id="retire-guide-heading">Retire the current guide head</h2>
            <p>
              Retirement appends a head event and removes only the current-head
              pointer. It never changes an immutable published version or an
              existing pinned attempt.
            </p>
          </div>
          <label
            className="field-label mt-5"
            htmlFor="retire-guide-confirmation"
          >
            Type {expectedRetirePhrase}
          </label>
          <input
            autoComplete="off"
            className="form-input"
            id="retire-guide-confirmation"
            onChange={(event) => {
              setRetirePhrase(event.target.value);
              setMutationError(null);
            }}
            value={retirePhrase}
          />
          <button
            className="secondary-link secondary-link--button mt-4 border-red-300 text-red-900"
            disabled={retirePhrase !== expectedRetirePhrase || busy !== null}
            onClick={() => void retireGuide()}
            type="button"
          >
            {busy === "retire" ? "Retiring current head…" : "Retire guide head"}
          </button>
        </section>
      )}
    </div>
  );

  async function createDraft() {
    if (state.status !== "ready") {
      return;
    }
    setBusy("draft");
    setMessage(null);
    setMutationError(null);
    const key =
      createDraftKey.current ?? createIdempotencyKey("guide-draft-create");
    createDraftKey.current = key;
    try {
      const draft = await api.createDraft(state.guide.guideId, key);
      createDraftKey.current = null;
      router.push(`/admin/guides/drafts/${encodeURIComponent(draft.draftId)}`);
    } catch (error) {
      setMutationError(
        mutationErrorMessage(
          error,
          "The server-cloned draft could not be created.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function retireGuide() {
    if (state.status !== "ready") {
      return;
    }
    const version = state.guide.version;
    setBusy("retire");
    setMessage(null);
    setMutationError(null);
    const keyRecord =
      retireKey.current?.version === version
        ? retireKey.current
        : {
            version,
            key: createIdempotencyKey("guide-head-retire"),
          };
    retireKey.current = keyRecord;
    try {
      const retired = await api.retireGuide(
        state.guide.guideId,
        version,
        keyRecord.key,
      );
      retireKey.current = null;
      setState((current) =>
        current.status === "ready" ? { ...current, guide: retired } : current,
      );
      setRetirePhrase("");
      setMessage(
        "The current fictional local guide head was retired. Immutable history was preserved.",
      );
    } catch (error) {
      setMutationError(
        mutationErrorMessage(
          error,
          "The current guide head could not be retired.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreVersions(cursor: string) {
    setLoadingMoreVersions(true);
    setVersionPageError(null);
    try {
      const page = await api.versions(guideId, undefined, cursor);
      setState((current) => {
        if (current.status !== "ready") {
          return current;
        }
        const known = new Set(
          current.versions.map(
            (version) =>
              `${version.status}:${version.guideVersion}:${version.draftId ?? "published"}`,
          ),
        );
        return {
          ...current,
          versions: [
            ...current.versions,
            ...page.items.filter(
              (version) =>
                !known.has(
                  `${version.status}:${version.guideVersion}:${version.draftId ?? "published"}`,
                ),
            ),
          ],
          nextVersionCursor: page.nextCursor,
        };
      });
    } catch (error) {
      setVersionPageError(
        detailError(error, "The next guide-history page could not be loaded."),
      );
    } finally {
      setLoadingMoreVersions(false);
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

function detailError(error: unknown, fallback: string) {
  if (error instanceof GuideAdminApiError) {
    if (error.status === 401) {
      return "Your session expired. Sign in again before continuing.";
    }
    if (error.status === 403 || error.status === 404) {
      return "This guide-admin resource is unavailable to the current role.";
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function mutationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof GuideAdminApiError) {
    if (error.status === 409) {
      return `HTTP 409: The operation conflicts with the latest server state. Reload before deciding again.`;
    }
    if (error.status === 412) {
      return `HTTP 412: This guide changed in another session. Reload before retrying.`;
    }
    if (error.status === 428) {
      return `HTTP 428: The conditional record version was missing. Reload before retrying.`;
    }
    if (error.status === 401) {
      return "Your session expired. Sign in again before continuing.";
    }
    if (error.status === 403 || error.status === 404) {
      return "This guide-admin operation is unavailable to the current role.";
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
