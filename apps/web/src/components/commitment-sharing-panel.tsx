"use client";

import { ApiClientError } from "@autopay-guard/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  HouseholdApi,
  type CommitmentVisibility,
  type HouseholdCommitmentDto,
  type HouseholdMemberDto,
} from "@/lib/household-api";

type MemberState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      members: HouseholdMemberDto[];
      nextCursor: string | null;
    };

export function CommitmentSharingPanel({
  commitment,
  onReload,
  onUpdated,
}: {
  commitment: HouseholdCommitmentDto;
  onReload: () => Promise<void>;
  onUpdated: (commitment: HouseholdCommitmentDto) => void;
}) {
  const api = useMemo(() => new HouseholdApi({ baseUrl: "/api/bff" }), []);
  const [members, setMembers] = useState<MemberState>({ status: "loading" });
  const [visibility, setVisibility] = useState<CommitmentVisibility>(
    commitment.visibility,
  );
  const [responsibleMemberId, setResponsibleMemberId] = useState(
    commitment.responsibleMemberId ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loadingMoreMembers, setLoadingMoreMembers] = useState(false);
  const [memberPageError, setMemberPageError] = useState<string | null>(null);
  const locallyUpdatedVersion = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setMembers({ status: "loading" });
      api
        .listMembers(commitment.householdId, { signal: controller.signal })
        .then(({ items, nextCursor }) => {
          if (!controller.signal.aborted) {
            if (!Array.isArray(items)) {
              throw new Error("The API returned an invalid member collection.");
            }
            setMembers({ status: "ready", members: items, nextCursor });
            setMemberPageError(null);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setMembers({
              status: "error",
              message: sharingLoadErrorMessage(error),
            });
          }
        });
    });
    return () => controller.abort();
  }, [api, commitment.householdId]);

  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) {
        return;
      }
      setVisibility(commitment.visibility);
      setResponsibleMemberId(commitment.responsibleMemberId ?? "");
      if (locallyUpdatedVersion.current === commitment.version) {
        locallyUpdatedVersion.current = null;
      } else {
        setMessage(null);
        setConflict(false);
      }
    });
    return () => {
      current = false;
    };
  }, [
    commitment.responsibleMemberId,
    commitment.version,
    commitment.visibility,
  ]);

  const activeMembers =
    members.status === "ready"
      ? members.members.filter(
          ({ role, status }) => role === "MEMBER" && status === "ACTIVE",
        )
      : [];
  const responsible =
    members.status === "ready" && commitment.responsibleMemberId
      ? (members.members.find(
          ({ id }) => id === commitment.responsibleMemberId,
        ) ?? null)
      : null;
  const changed =
    visibility !== commitment.visibility ||
    (visibility === "HOUSEHOLD"
      ? (responsibleMemberId || null) !== commitment.responsibleMemberId
      : commitment.responsibleMemberId !== null);

  return (
    <section
      aria-labelledby="commitment-sharing-heading"
      className="detail-facts commitment-sharing-panel"
    >
      <div className="detail-facts__heading">
        <p className="card-kicker">Household visibility</p>
        <h2 id="commitment-sharing-heading">Who can see this commitment</h2>
        <p>
          Responsibility is a planning label only. It does not grant ownership,
          editing, payment authority, provider access, or notification
          subscription.
        </p>
      </div>

      {!commitment.canManage ? (
        <div className="sharing-read-only">
          <span className="status-chip">Read only</span>
          <div>
            <strong>
              {commitment.visibility === "HOUSEHOLD"
                ? "Shared with this household"
                : "Private to the owner"}
            </strong>
            <p>
              {commitment.visibility === "HOUSEHOLD"
                ? "You can view this record, but only the household owner can change it."
                : "This visibility state is controlled by the household owner."}
            </p>
            {commitment.responsibleMemberId && (
              <small>
                Planning responsibility:{" "}
                {responsible?.displayName ?? "Current household member"}
              </small>
            )}
          </div>
        </div>
      ) : commitment.status === "ARCHIVED" ? (
        <div className="sharing-read-only">
          <span className="status-chip status-chip--archived">Archived</span>
          <div>
            <strong>
              {commitment.visibility === "HOUSEHOLD"
                ? "Shared with this household"
                : "Private to the owner"}
            </strong>
            <p>Archived commitments cannot change household visibility.</p>
          </div>
        </div>
      ) : members.status === "loading" ? (
        <div className="sharing-panel-state" role="status">
          <span className="loading-pulse" aria-hidden="true" />
          Loading active household members…
        </div>
      ) : members.status === "error" ? (
        <div className="form-alert form-alert--conflict" role="alert">
          <strong>Sharing controls unavailable</strong>
          <p>{members.message}</p>
        </div>
      ) : (
        <form
          className="sharing-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSharing();
          }}
        >
          <fieldset>
            <legend>Visibility</legend>
            <label
              className={
                visibility === "PRIVATE"
                  ? "sharing-choice sharing-choice--selected"
                  : "sharing-choice"
              }
            >
              <input
                checked={visibility === "PRIVATE"}
                name="visibility"
                onChange={() => {
                  setVisibility("PRIVATE");
                  setResponsibleMemberId("");
                  setMessage(null);
                  setConflict(false);
                }}
                type="radio"
                value="PRIVATE"
              />
              <span>
                <strong>Private</strong>
                <small>Visible only to the immutable household owner.</small>
              </span>
            </label>
            <label
              className={
                visibility === "HOUSEHOLD"
                  ? "sharing-choice sharing-choice--selected"
                  : "sharing-choice"
              }
            >
              <input
                checked={visibility === "HOUSEHOLD"}
                name="visibility"
                onChange={() => {
                  setVisibility("HOUSEHOLD");
                  setMessage(null);
                  setConflict(false);
                }}
                type="radio"
                value="HOUSEHOLD"
              />
              <span>
                <strong>Household</strong>
                <small>
                  Visible read-only to active members with current consent.
                </small>
              </span>
            </label>
          </fieldset>

          <label className="sharing-responsibility">
            Optional planning responsibility
            <select
              disabled={visibility !== "HOUSEHOLD"}
              onChange={(event) => {
                setResponsibleMemberId(event.target.value);
                setMessage(null);
                setConflict(false);
              }}
              value={visibility === "HOUSEHOLD" ? responsibleMemberId : ""}
            >
              <option value="">No member label</option>
              {activeMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
            <small>
              A label never creates an edit right or sends a notification.
            </small>
          </label>

          {memberPageError && (
            <div className="form-alert form-alert--conflict" role="alert">
              <strong>More household members could not be loaded</strong>
              <p>{memberPageError}</p>
            </div>
          )}
          {members.nextCursor && (
            <button
              className="secondary-link secondary-link--button"
              disabled={loadingMoreMembers}
              onClick={() => void loadMoreMembers(members.nextCursor!)}
              type="button"
            >
              {loadingMoreMembers ? "Loading…" : "Load more household members"}
            </button>
          )}

          {message && (
            <div
              className={
                conflict
                  ? "form-alert form-alert--conflict"
                  : "form-alert form-alert--success"
              }
              role={conflict ? "alert" : "status"}
            >
              <strong>
                {conflict ? "Sharing not changed" : "Sharing updated"}
              </strong>
              <p>{message}</p>
              {conflict && (
                <button onClick={() => void onReload()} type="button">
                  Reload latest version
                </button>
              )}
            </div>
          )}

          <div className="sharing-form__actions">
            <Button disabled={!changed || saving} type="submit">
              {saving ? "Saving visibility…" : "Save visibility"}
            </Button>
            <span>Version {commitment.version} · owner-controlled</span>
          </div>
        </form>
      )}
    </section>
  );

  async function saveSharing() {
    setSaving(true);
    setMessage(null);
    setConflict(false);
    try {
      const updated = await api.updateCommitmentSharing(
        commitment.id,
        `"${commitment.version}"`,
        {
          visibility,
          responsibleMemberId:
            visibility === "HOUSEHOLD" ? responsibleMemberId || null : null,
        },
      );
      if (
        updated.id !== commitment.id ||
        updated.householdId !== commitment.householdId
      ) {
        throw new Error("The API returned a different commitment scope.");
      }
      locallyUpdatedVersion.current = updated.version;
      setMessage(
        updated.visibility === "HOUSEHOLD"
          ? "This commitment is now visible read-only to currently consented household members."
          : "This commitment is now private to the household owner.",
      );
      onUpdated(updated);
    } catch (error) {
      const failure = sharingSaveErrorMessage(error);
      setMessage(failure.message);
      setConflict(failure.conflict);
    } finally {
      setSaving(false);
    }
  }

  async function loadMoreMembers(cursor: string) {
    setLoadingMoreMembers(true);
    setMemberPageError(null);
    try {
      const page = await api.listMembers(commitment.householdId, { cursor });
      setMembers((current) => {
        if (current.status !== "ready") {
          return current;
        }
        const known = new Set(current.members.map((member) => member.id));
        return {
          status: "ready",
          members: [
            ...current.members,
            ...page.items.filter((member) => !known.has(member.id)),
          ],
          nextCursor: page.nextCursor,
        };
      });
    } catch (error) {
      setMemberPageError(sharingLoadErrorMessage(error));
    } finally {
      setLoadingMoreMembers(false);
    }
  }
}

function sharingLoadErrorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 401) {
    return "Your secure session expired. Sign in again.";
  }
  return "The API could not return active household members.";
}

function sharingSaveErrorMessage(error: unknown): {
  message: string;
  conflict: boolean;
} {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return {
        message: "Your secure session expired. Sign in again.",
        conflict: true,
      };
    }
    if (error.status === 403 || error.status === 404) {
      return {
        message:
          "Only the household owner can change visibility, and the selected member must remain active.",
        conflict: true,
      };
    }
    if (error.status === 409) {
      return {
        message:
          "Current household-sharing consent is required before a commitment can be shared.",
        conflict: true,
      };
    }
    if (error.status === 412 || error.status === 428) {
      return {
        message:
          "This commitment changed in another tab. Reload before choosing visibility again.",
        conflict: true,
      };
    }
  }
  return {
    message: "The API could not update household visibility.",
    conflict: true,
  };
}
