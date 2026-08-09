"use client";

import {
  ApiClientError,
  FoundationApi,
  type Commitment,
} from "@autopay-guard/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CommitmentForm } from "@/components/commitment-form";
import { useSelectedHousehold } from "@/components/household-scope";

type EditState =
  | { status: "loading"; requestKey: string | null }
  | { status: "error"; requestKey: string; message: string }
  | { status: "ready"; requestKey: string; commitment: Commitment };

export function CommitmentEditScreen({
  commitmentId,
}: {
  commitmentId: string;
}) {
  const household = useSelectedHousehold();
  const api = useMemo(() => new FoundationApi({ baseUrl: "/api/bff" }), []);
  const requestKey = `${household.id}:${commitmentId}`;
  const [state, setState] = useState<EditState>({
    status: "loading",
    requestKey: null,
  });

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
        if (commitment.householdId !== household.id) {
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
        } else if (commitment.status === "ARCHIVED") {
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  status: "error",
                  requestKey,
                  message: "Archived commitments cannot be edited.",
                }
              : current,
          );
        } else {
          setState((current) =>
            current.requestKey === requestKey
              ? { status: "ready", requestKey, commitment }
              : current,
          );
        }
      } catch (error) {
        if (!signal?.aborted) {
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  status: "error",
                  requestKey,
                  message:
                    error instanceof ApiClientError && error.status === 404
                      ? "This commitment was not found."
                      : "The API could not load the latest commitment.",
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
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, requestKey]);

  if (state.requestKey !== requestKey || state.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading the latest version…
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

  return (
    <div className="commitment-editor-page">
      <Link
        className="back-link"
        href={`/commitments/${encodeURIComponent(state.commitment.id)}?householdId=${encodeURIComponent(household.id)}`}
      >
        ← Commitment details
      </Link>
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Edit recurring commitment</p>
          <h1>{state.commitment.displayName}</h1>
          <p>
            Saving checks the version you opened, so a newer change is never
            silently overwritten.
          </p>
        </div>
      </header>
      <CommitmentForm
        household={household}
        initial={state.commitment}
        key={`${state.commitment.id}:${state.commitment.version}`}
        onReloadLatest={() => void load()}
      />
    </div>
  );
}
