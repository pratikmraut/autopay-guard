"use client";

import {
  ApiClientError,
  FoundationApi,
  type Commitment,
} from "@autopay-guard/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CategoryGuidance } from "@/components/category-guidance";
import { AmountLabel } from "@/components/commitment-list-screen";
import { CommitmentSharingPanel } from "@/components/commitment-sharing-panel";
import { useSelectedHousehold } from "@/components/household-scope";
import { Button } from "@/components/ui/button";
import { archiveCommitmentErrorMessage } from "@/lib/commitment-api-messages";
import { formatRecurrence } from "@/lib/commitment-display";
import {
  commitmentCategories,
  labelForOption,
  paymentRails,
} from "@/lib/commitment-options";
import type { HouseholdCommitmentDto } from "@/lib/household-api";
import { formatLocalDate } from "@/lib/local-date";

type DetailState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | {
      status: "ready";
      requestKey: string;
      commitment: HouseholdCommitmentDto;
    };

export function CommitmentDetailScreen({
  commitmentId,
}: {
  commitmentId: string;
}) {
  const household = useSelectedHousehold();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = useMemo(() => new FoundationApi({ baseUrl: "/api/bff" }), []);
  const requestKey = `${household.id}:${commitmentId}`;
  const [state, setState] = useState<DetailState>({
    status: "loading",
    requestKey: null,
  });
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const archiveDialogRef = useRef<HTMLElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const commitment = await api.getCommitment(
          { commitmentId },
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        const householdCommitment = asHouseholdCommitment(commitment);
        if (householdCommitment.householdId !== household.id) {
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  status: "error",
                  requestKey,
                  message:
                    "This commitment does not belong to the selected workspace.",
                }
              : current,
          );
          return;
        }
        setState((current) =>
          current.requestKey === requestKey
            ? {
                status: "ready",
                requestKey,
                commitment: householdCommitment,
              }
            : current,
        );
        setArchiveError(null);
        setConfirmArchive(false);
      } catch (error) {
        if (!signal?.aborted) {
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  status: "error",
                  requestKey,
                  message: safeDetailMessage(error),
                }
              : current,
          );
        }
      }
    },
    [api, commitmentId, household.id, requestKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setState({ status: "loading", requestKey });
      setArchiveError(null);
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, requestKey]);

  useEffect(() => {
    if (confirmArchive) {
      archiveDialogRef.current?.focus();
    }
  }, [confirmArchive]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading commitment details…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Commitment unavailable</strong>
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

  const commitment = state.commitment;
  const category = labelForOption(commitmentCategories, commitment.category);
  const rail = labelForOption(paymentRails, commitment.paymentRail);

  return (
    <div className="commitment-detail-page">
      {searchParams.get("saved") === "1" && (
        <div className="success-toast" role="status">
          <span aria-hidden="true">✓</span>
          Commitment saved.
        </div>
      )}
      <Link
        className="back-link"
        href={`/commitments?householdId=${encodeURIComponent(household.id)}`}
      >
        ← All commitments
      </Link>

      <header className="resource-heading commitment-detail-heading">
        <div>
          <p className="eyebrow">{category}</p>
          <h1>{commitment.displayName}</h1>
          <p>
            {commitment.merchantCanonicalName
              ? `Matched to ${commitment.merchantCanonicalName}.`
              : commitment.visibility === "HOUSEHOLD"
                ? "Manually named and shared read-only with this household."
                : "Manually named and private to the household owner."}
          </p>
          {!commitment.canManage && (
            <span className="status-chip commitment-read-only-chip">
              Read-only household view
            </span>
          )}
        </div>
        <div className="detail-actions">
          {commitment.canManage &&
            commitment.reviewActions.includes("CANCEL_WITH_PROVIDER") && (
              <Link
                className="secondary-link secondary-link--button"
                data-testid="cancellation-guide-link"
                href={`/commitments/${encodeURIComponent(commitment.id)}/cancellation?householdId=${encodeURIComponent(household.id)}`}
              >
                Cancellation guide
              </Link>
            )}
          {commitment.canManage && (
            <Link
              className="secondary-link secondary-link--button"
              data-testid="commitment-reminders-link"
              href={`/commitments/${encodeURIComponent(commitment.id)}/reminders?householdId=${encodeURIComponent(household.id)}`}
            >
              Reminders
            </Link>
          )}
          {commitment.canManage && commitment.status !== "ARCHIVED" && (
            <>
              <Link
                className="secondary-link secondary-link--button"
                data-testid="edit-commitment-link"
                href={`/commitments/${encodeURIComponent(commitment.id)}/edit?householdId=${encodeURIComponent(household.id)}`}
              >
                Edit
              </Link>
              <button
                className="danger-link"
                data-testid="archive-commitment-button"
                onClick={() => {
                  setConfirmArchive(true);
                  setArchiveError(null);
                }}
                ref={archiveButtonRef}
                type="button"
              >
                Archive
              </button>
            </>
          )}
        </div>
      </header>

      {archiveError && (
        <div className="form-alert form-alert--conflict" role="alert">
          <strong>Could not archive</strong>
          <p>{archiveError}</p>
          <button onClick={() => void load()} type="button">
            Reload latest version
          </button>
        </div>
      )}

      {confirmArchive && (
        <section
          aria-describedby="archive-confirmation-description"
          aria-labelledby="archive-confirmation-title"
          className="archive-confirmation"
          ref={archiveDialogRef}
          role="alertdialog"
          tabIndex={-1}
        >
          <div>
            <h2 id="archive-confirmation-title">
              Archive {commitment.displayName}?
            </h2>
            <p id="archive-confirmation-description">
              It will leave active lists and projections. This does not cancel
              anything with the provider.
            </p>
          </div>
          <div>
            <Button
              disabled={archiving}
              onClick={async () => {
                setArchiving(true);
                setArchiveError(null);
                try {
                  await api.archiveCommitment({
                    commitmentId: commitment.id,
                    ifMatch: `"${commitment.version}"`,
                  });
                  router.push(
                    `/commitments?householdId=${encodeURIComponent(household.id)}&archived=1`,
                  );
                  router.refresh();
                } catch (error) {
                  setConfirmArchive(false);
                  setArchiveError(archiveCommitmentErrorMessage(error));
                } finally {
                  setArchiving(false);
                }
              }}
              type="button"
            >
              {archiving ? "Archiving…" : "Archive commitment"}
            </Button>
            <button
              className="secondary-link"
              disabled={archiving}
              onClick={() => {
                setConfirmArchive(false);
                requestAnimationFrame(() => archiveButtonRef.current?.focus());
              }}
              type="button"
            >
              Keep it
            </button>
          </div>
        </section>
      )}

      <section className="detail-card-grid" aria-label="Commitment details">
        <article className="detail-card detail-card--amount">
          <p className="card-kicker">Expected amount</p>
          <AmountLabel commitment={commitment} />
          <small>
            {commitment.variableAmount
              ? "Variable entries stay visibly estimated or unknown."
              : "Stored as an exact fixed amount."}
          </small>
        </article>
        <article className="detail-card">
          <p className="card-kicker">Next due</p>
          <strong>
            {commitment.nextDueDate
              ? formatLocalDate(commitment.nextDueDate)
              : "No upcoming date"}
          </strong>
          <small>{formatRecurrence(commitment)}</small>
        </article>
        <article className="detail-card">
          <p className="card-kicker">Tracking status</p>
          <strong>
            {commitment.status === "PAUSED"
              ? "Paused"
              : commitment.status === "ARCHIVED"
                ? "Archived"
                : "Active"}
          </strong>
          <small>Version {commitment.version}</small>
        </article>
      </section>

      <section className="detail-facts" aria-labelledby="details-heading">
        <div className="detail-facts__heading">
          <p className="card-kicker">Schedule and payment</p>
          <h2 id="details-heading">What you chose to track</h2>
        </div>
        <dl>
          <div>
            <dt>Category</dt>
            <dd>{category}</dd>
          </div>
          <div>
            <dt>Payment rail</dt>
            <dd>{rail}</dd>
          </div>
          <div>
            <dt>Recurrence</dt>
            <dd>{formatRecurrence(commitment)}</dd>
          </div>
          <div>
            <dt>Anchor date</dt>
            <dd>{formatLocalDate(commitment.anchorDate)}</dd>
          </div>
          <div>
            <dt>Month-day handling</dt>
            <dd>
              {commitment.monthDayPolicy === "LAST_DAY"
                ? "Always month end"
                : "Keep the anchor day"}
            </dd>
          </div>
          <div>
            <dt>Masked payment label</dt>
            <dd>{commitment.maskedPaymentLabel ?? "Not provided"}</dd>
          </div>
        </dl>
      </section>

      <CommitmentSharingPanel
        commitment={commitment}
        onReload={async () => load()}
        onUpdated={(updated) => {
          setState({
            status: "ready",
            requestKey,
            commitment: updated,
          });
        }}
      />

      <CategoryGuidance
        category={commitment.category}
        reviewActions={commitment.reviewActions}
      />
      <p className="provider-action-note">
        Review actions are guidance only. AutoPay Guard cannot execute, cancel,
        switch, or change a provider service.
      </p>
    </div>
  );
}

function safeDetailMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return "This commitment was not found in your owned workspaces.";
    }
    if (error.status === 401) {
      return "Your secure session expired. Sign in again.";
    }
  }
  return "The API could not return this commitment.";
}

function asHouseholdCommitment(commitment: Commitment): HouseholdCommitmentDto {
  const candidate = commitment as Commitment & Partial<HouseholdCommitmentDto>;
  if (
    typeof candidate.dataOwnerUserId !== "string" ||
    typeof candidate.canManage !== "boolean" ||
    (candidate.responsibleMemberId !== null &&
      typeof candidate.responsibleMemberId !== "string") ||
    (candidate.visibility !== "PRIVATE" && candidate.visibility !== "HOUSEHOLD")
  ) {
    throw new Error("The API returned an incomplete household commitment.");
  }
  return candidate as HouseholdCommitmentDto;
}
