"use client";

import { ApiClientError } from "@autopay-guard/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  HouseholdApi,
  type CreatedHouseholdInvitationDto,
  type HouseholdAccessDto,
  type HouseholdInvitationDto,
  type HouseholdMemberDto,
} from "@/lib/household-api";
import { createIdempotencyKey } from "@/lib/idempotency-key";

type HubState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      households: HouseholdAccessDto[];
      incoming: HouseholdInvitationDto[];
      nextHouseholdCursor: string | null;
      nextIncomingCursor: string | null;
    };

type HouseholdState =
  | { status: "idle" }
  | { status: "loading"; householdId: string }
  | { status: "error"; householdId: string; message: string }
  | {
      status: "ready";
      householdId: string;
      members: HouseholdMemberDto[];
      invitations: HouseholdInvitationDto[];
      nextMemberCursor: string | null;
      nextInvitationCursor: string | null;
    };

type PendingAction =
  | { kind: "remove"; member: HouseholdMemberDto }
  | { kind: "revoke"; invitation: HouseholdInvitationDto }
  | null;

type PageKind = "households" | "incoming" | "members" | "invitations";
type ActionResult = {
  kind: "success" | "error";
  message: string;
} | null;

const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FAKE_EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:autopayguard\.local|[a-z0-9-]+\.example\.test)$/i;

export function HouseholdHubScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = useMemo(() => new HouseholdApi({ baseUrl: "/api/bff" }), []);
  const [hub, setHub] = useState<HubState>({ status: "loading" });
  const [householdState, setHouseholdState] = useState<HouseholdState>({
    status: "idle",
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [creatingInvitation, setCreatingInvitation] = useState(false);
  const [createdInvitation, setCreatedInvitation] =
    useState<CreatedHouseholdInvitationDto | null>(null);
  const [invitationMessage, setInvitationMessage] = useState<string | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [invitationCode, setInvitationCode] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptanceMessage, setAcceptanceMessage] = useState<string | null>(
    null,
  );
  const [acceptedHouseholdId, setAcceptedHouseholdId] = useState<string | null>(
    null,
  );
  const acceptanceKey = useRef<{ code: string; key: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionResult, setActionResult] = useState<ActionResult>(null);
  const [pageBusy, setPageBusy] = useState<PageKind | null>(null);
  const [pageError, setPageError] = useState<{
    kind: PageKind;
    message: string;
  } | null>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionResultRef = useRef<HTMLDivElement>(null);

  const loadHub = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [householdResponse, incomingResponse] = await Promise.all([
          api.listHouseholds({ signal }),
          api.listIncomingInvitations({ signal }),
        ]);
        if (!signal?.aborted) {
          setHub({
            status: "ready",
            households: householdResponse.items,
            incoming: incomingResponse.items,
            nextHouseholdCursor: householdResponse.nextCursor,
            nextIncomingCursor: incomingResponse.nextCursor,
          });
          setPageError(null);
        }
        return { householdResponse, incomingResponse };
      } catch (error) {
        if (!signal?.aborted) {
          setHub({
            status: "error",
            message: householdErrorMessage(error, "load"),
          });
        }
        return null;
      }
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setHub({ status: "loading" });
        void loadHub(controller.signal);
      }
    });
    return () => controller.abort();
  }, [loadHub]);

  const requestedHouseholdId = searchParams.get("householdId");
  const selectedHousehold =
    hub.status === "ready"
      ? (hub.households.find(({ id }) => id === requestedHouseholdId) ??
        hub.households[0] ??
        null)
      : null;

  useEffect(() => {
    if (!selectedHousehold) {
      queueMicrotask(() => setHouseholdState({ status: "idle" }));
      return;
    }
    const household = selectedHousehold;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setHouseholdState({
        status: "loading",
        householdId: household.id,
      });
      Promise.all([
        api.listMembers(household.id, { signal: controller.signal }),
        household.canManage
          ? api.listHouseholdInvitations(household.id, {
              signal: controller.signal,
            })
          : Promise.resolve({ items: [], nextCursor: null }),
      ])
        .then(([members, invitations]) => {
          if (!controller.signal.aborted) {
            setHouseholdState({
              status: "ready",
              householdId: household.id,
              members: members.items,
              invitations: invitations.items,
              nextMemberCursor: members.nextCursor,
              nextInvitationCursor: invitations.nextCursor,
            });
            setPageError(null);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setHouseholdState({
              status: "error",
              householdId: household.id,
              message: householdErrorMessage(error, "load-members"),
            });
          }
        });
    });
    return () => controller.abort();
  }, [api, reloadToken, selectedHousehold]);

  useEffect(() => {
    if (pendingAction) {
      confirmationRef.current?.focus();
    }
  }, [pendingAction]);

  useEffect(() => {
    if (actionResult) {
      actionResultRef.current?.focus();
    }
  }, [actionResult]);

  if (hub.status === "loading") {
    return (
      <div className="resource-state resource-state--loading" role="status">
        <span className="loading-pulse" aria-hidden="true" />
        Loading household access…
      </div>
    );
  }

  if (hub.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Household access unavailable</strong>
        <p>{hub.message}</p>
        <button className="secondary-link" onClick={() => void loadHub()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="household-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Household access</p>
          <h1>Share only what you choose</h1>
          <p>
            Invitations and sharing stay inside this fake local workspace. No
            email is sent, and members cannot edit commitments or act on a
            payment or provider.
          </p>
        </div>
        <Link
          className="secondary-link secondary-link--button"
          href="/settings/privacy"
        >
          Privacy and consent
        </Link>
      </header>

      <section
        aria-labelledby="accept-invitation-heading"
        className="household-panel invitation-acceptance"
      >
        <div className="household-panel__heading">
          <div>
            <p className="card-kicker">Join a fake local household</p>
            <h2 id="accept-invitation-heading">Accept an invitation</h2>
            <p>
              Enter the one-time code transferred to you outside AutoPay Guard.
              The code is never placed in a URL or browser storage.
            </p>
          </div>
          <span className="status-chip">{hub.incoming.length} pending</span>
        </div>

        {hub.incoming.length > 0 && (
          <ul
            className="incoming-invitation-list"
            aria-label="Pending invitations"
          >
            {hub.incoming.map((invitation) => (
              <li key={invitation.id}>
                <div>
                  <strong>{invitation.householdName}</strong>
                  <small>Expires {formatInstant(invitation.expiresAt)}</small>
                </div>
                <span>{invitation.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
        {pageError?.kind === "incoming" && (
          <div className="resource-state resource-state--error" role="alert">
            <strong>More invitations could not be loaded</strong>
            <p>{pageError.message}</p>
          </div>
        )}
        {hub.nextIncomingCursor && (
          <button
            className="secondary-link secondary-link--button"
            disabled={pageBusy !== null}
            onClick={() =>
              void loadMoreHub("incoming", hub.nextIncomingCursor!)
            }
            type="button"
          >
            {pageBusy === "incoming"
              ? "Loading…"
              : "Load more pending invitations"}
          </button>
        )}

        <form
          className="invitation-code-form"
          onSubmit={(event) => {
            event.preventDefault();
            void acceptInvitation();
          }}
        >
          <label htmlFor="invitation-code">One-time invitation code</label>
          <div>
            <input
              aria-describedby="invitation-code-note"
              autoComplete="off"
              id="invitation-code"
              maxLength={43}
              minLength={43}
              onChange={(event) => {
                setInvitationCode(event.target.value.trim());
                setAcceptanceMessage(null);
                setAcceptedHouseholdId(null);
              }}
              pattern="[A-Za-z0-9_-]{43}"
              required
              spellCheck={false}
              type="text"
              value={invitationCode}
            />
            <Button disabled={accepting} type="submit">
              {accepting ? "Accepting…" : "Accept invitation"}
            </Button>
          </div>
          <small id="invitation-code-note">
            A current privacy-notice acknowledgement and household-sharing grant
            are required first.
          </small>
        </form>

        {acceptanceMessage && (
          <div
            className={
              acceptedHouseholdId
                ? "success-toast household-inline-message"
                : "form-alert form-alert--conflict"
            }
            role={acceptedHouseholdId ? "status" : "alert"}
          >
            <strong>
              {acceptedHouseholdId
                ? "Invitation accepted"
                : "Could not accept invitation"}
            </strong>
            <p>{acceptanceMessage}</p>
            {acceptedHouseholdId && (
              <Link
                className="secondary-link"
                href={`/dashboard?householdId=${encodeURIComponent(acceptedHouseholdId)}`}
              >
                Open shared dashboard
              </Link>
            )}
          </div>
        )}
      </section>

      {hub.households.length === 0 || !selectedHousehold ? (
        <section className="household-panel household-empty">
          <p className="card-kicker">No household membership yet</p>
          <h2>Accept a code or create your own workspace</h2>
          <p>
            Signing in does not grant access to another household. Membership
            begins only after a bound invitation is accepted.
          </p>
          <Link className="primary-link" href="/onboarding">
            Create a workspace
            <span aria-hidden="true">→</span>
          </Link>
        </section>
      ) : (
        <>
          <section
            aria-labelledby="household-selection-heading"
            className="household-selector"
          >
            <div>
              <p className="card-kicker">Current household</p>
              <h2 id="household-selection-heading">{selectedHousehold.name}</h2>
              <p>
                {selectedHousehold.accessRole === "OWNER"
                  ? "You are the immutable owner for this milestone."
                  : "You are a read-only member. Totals cover only records visible to you."}
              </p>
            </div>
            <div>
              {hub.households.length > 1 && (
                <label>
                  Choose household
                  <select
                    onChange={(event) => {
                      const next = new URLSearchParams(searchParams);
                      next.set("householdId", event.target.value);
                      router.replace(`/household?${next.toString()}`);
                      setCreatedInvitation(null);
                      setPendingAction(null);
                      setActionResult(null);
                    }}
                    value={selectedHousehold.id}
                  >
                    {hub.households.map((household) => (
                      <option key={household.id} value={household.id}>
                        {household.name} · {household.accessRole.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {pageError?.kind === "households" && (
                <div
                  className="resource-state resource-state--error"
                  role="alert"
                >
                  <strong>More households could not be loaded</strong>
                  <p>{pageError.message}</p>
                </div>
              )}
              {hub.nextHouseholdCursor && (
                <button
                  className="secondary-link secondary-link--button"
                  disabled={pageBusy !== null}
                  onClick={() =>
                    void loadMoreHub("households", hub.nextHouseholdCursor!)
                  }
                  type="button"
                >
                  {pageBusy === "households"
                    ? "Loading…"
                    : "Load more households"}
                </button>
              )}
            </div>
          </section>

          {householdState.status === "loading" ||
          householdState.status === "idle" ||
          householdState.householdId !== selectedHousehold.id ? (
            <div
              className="resource-state resource-state--loading"
              role="status"
            >
              <span className="loading-pulse" aria-hidden="true" />
              Loading members…
            </div>
          ) : householdState.status === "error" ? (
            <div className="resource-state resource-state--error" role="alert">
              <strong>Members unavailable</strong>
              <p>{householdState.message}</p>
              <button
                className="secondary-link"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="household-management-grid">
              <MembersPanel
                canManage={selectedHousehold.canManage}
                error={pageError?.kind === "members" ? pageError.message : null}
                loadingMore={pageBusy === "members"}
                members={householdState.members}
                nextCursor={householdState.nextMemberCursor}
                onLoadMore={(cursor) =>
                  void loadMoreHouseholdCollection("members", cursor)
                }
                onRemove={(member, trigger) => {
                  actionTriggerRef.current = trigger;
                  setPendingAction({ kind: "remove", member });
                  setActionResult(null);
                }}
              />

              {selectedHousehold.canManage ? (
                <section
                  aria-labelledby="invite-member-heading"
                  className="household-panel"
                >
                  <div className="household-panel__heading">
                    <div>
                      <p className="card-kicker">Owner action</p>
                      <h2 id="invite-member-heading">Invite a fake user</h2>
                      <p>
                        The plaintext code is shown once. Transfer it manually;
                        AutoPay Guard sends no email.
                      </p>
                    </div>
                  </div>

                  <form
                    className="member-invite-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createInvitation(selectedHousehold);
                    }}
                  >
                    <label htmlFor="invitee-email">Fake local email</label>
                    <input
                      autoComplete="off"
                      id="invitee-email"
                      maxLength={320}
                      onChange={(event) => {
                        setInviteeEmail(event.target.value);
                        setInvitationMessage(null);
                      }}
                      placeholder="member@autopayguard.local"
                      required
                      type="email"
                      value={inviteeEmail}
                    />
                    <small>
                      Only seeded <code>@autopayguard.local</code> or reserved{" "}
                      <code>.example.test</code> identities are accepted.
                    </small>
                    <Button disabled={creatingInvitation} type="submit">
                      {creatingInvitation
                        ? "Creating local invitation…"
                        : "Create invitation code"}
                    </Button>
                  </form>

                  {invitationMessage && !createdInvitation && (
                    <div
                      className="form-alert form-alert--conflict"
                      role="alert"
                    >
                      <strong>Could not create invitation</strong>
                      <p>{invitationMessage}</p>
                    </div>
                  )}

                  {createdInvitation && (
                    <div className="one-time-code">
                      <div>
                        <strong role="status">
                          Invitation created locally. No email was sent.
                        </strong>
                        <p>
                          Copy this code now. It expires{" "}
                          {formatInstant(
                            createdInvitation.invitation.expiresAt,
                          )}
                          .
                        </p>
                      </div>
                      <output aria-label="One-time invitation code">
                        {createdInvitation.invitationCode}
                      </output>
                      <div>
                        <button
                          className="secondary-link secondary-link--button"
                          onClick={() => void copyInvitationCode()}
                          type="button"
                        >
                          {copied ? "Copied" : "Copy code"}
                        </button>
                        <button
                          className="secondary-link"
                          onClick={() => {
                            setCreatedInvitation(null);
                            setCopied(false);
                          }}
                          type="button"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  <InvitationList
                    error={
                      pageError?.kind === "invitations"
                        ? pageError.message
                        : null
                    }
                    invitations={householdState.invitations}
                    loadingMore={pageBusy === "invitations"}
                    nextCursor={householdState.nextInvitationCursor}
                    onLoadMore={(cursor) =>
                      void loadMoreHouseholdCollection("invitations", cursor)
                    }
                    onRevoke={(invitation, trigger) => {
                      actionTriggerRef.current = trigger;
                      setPendingAction({ kind: "revoke", invitation });
                      setActionResult(null);
                    }}
                  />
                </section>
              ) : (
                <section className="household-panel read-only-panel">
                  <p className="card-kicker">Read-only member</p>
                  <h2>Owner controls stay with the founder</h2>
                  <p>
                    You can view commitments explicitly marked for the
                    household. You cannot invite or remove people, change
                    sharing, edit commitments, move money, or act with a
                    provider.
                  </p>
                </section>
              )}
            </div>
          )}

          {actionResult && (
            <div
              className={
                actionResult.kind === "success"
                  ? "success-toast household-inline-message"
                  : "form-alert form-alert--conflict"
              }
              ref={actionResultRef}
              role={actionResult.kind === "success" ? "status" : "alert"}
              tabIndex={-1}
            >
              <strong>
                {actionResult.kind === "success"
                  ? "Household change completed"
                  : "Household change not completed"}
              </strong>
              <p>{actionResult.message}</p>
            </div>
          )}

          {pendingAction && (
            <section
              aria-labelledby="household-confirmation-heading"
              className="archive-confirmation"
              ref={confirmationRef}
              role="alertdialog"
              tabIndex={-1}
            >
              <div>
                <h2 id="household-confirmation-heading">
                  {pendingAction.kind === "remove"
                    ? `Remove ${pendingAction.member.displayName}?`
                    : `Revoke invitation for ${pendingAction.invitation.inviteeEmail}?`}
                </h2>
                <p>
                  {pendingAction.kind === "remove"
                    ? "Shared access ends immediately and current responsibility labels for this member are cleared."
                    : "The one-time code will stop working immediately."}
                </p>
              </div>
              <div>
                <Button
                  disabled={actionBusy}
                  onClick={() =>
                    void confirmHouseholdAction(selectedHousehold.id)
                  }
                  type="button"
                >
                  {actionBusy
                    ? "Saving…"
                    : pendingAction.kind === "remove"
                      ? "Remove member"
                      : "Revoke invitation"}
                </Button>
                <button
                  className="secondary-link"
                  disabled={actionBusy}
                  onClick={() => {
                    setPendingAction(null);
                    queueMicrotask(() => actionTriggerRef.current?.focus());
                  }}
                  type="button"
                >
                  Keep unchanged
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );

  async function createInvitation(household: HouseholdAccessDto) {
    const email = inviteeEmail.trim().toLowerCase();
    setCreatedInvitation(null);
    setCopied(false);
    setInvitationMessage(null);
    if (!FAKE_EMAIL_PATTERN.test(email)) {
      setInvitationMessage(
        "Use a seeded fake local identity. Real email addresses are not accepted.",
      );
      return;
    }
    setCreatingInvitation(true);
    try {
      const created = await api.createInvitation(household.id, email);
      if (
        created.emailSent !== false ||
        !CODE_PATTERN.test(created.invitationCode) ||
        created.invitation.householdId !== household.id
      ) {
        throw new Error("The API returned an unsafe invitation response.");
      }
      setCreatedInvitation(created);
      setInviteeEmail("");
      setReloadToken((value) => value + 1);
    } catch (error) {
      setInvitationMessage(householdErrorMessage(error, "invite"));
    } finally {
      setCreatingInvitation(false);
    }
  }

  async function copyInvitationCode() {
    if (!createdInvitation) {
      return;
    }
    try {
      await navigator.clipboard.writeText(createdInvitation.invitationCode);
      setCopied(true);
    } catch {
      setCopied(false);
      setInvitationMessage(
        "Clipboard access was unavailable. Select and copy the displayed code manually.",
      );
    }
  }

  async function acceptInvitation() {
    const code = invitationCode.trim();
    setAcceptanceMessage(null);
    setAcceptedHouseholdId(null);
    if (!CODE_PATTERN.test(code)) {
      setAcceptanceMessage(
        "Enter the complete 43-character one-time invitation code.",
      );
      return;
    }
    if (!acceptanceKey.current || acceptanceKey.current.code !== code) {
      acceptanceKey.current = {
        code,
        key: createIdempotencyKey("m5-invitation-accept"),
      };
    }
    setAccepting(true);
    try {
      const before = new Set(
        (hub.status === "ready" ? hub.households : []).map(({ id }) => id),
      );
      await api.acceptInvitation(code, acceptanceKey.current.key);
      const refreshed = await Promise.all([
        api.listHouseholds(),
        api.listIncomingInvitations(),
      ]);
      const [households, incoming] = refreshed;
      const joined =
        households.items.find(({ id }) => !before.has(id)) ??
        households.items.find(({ accessRole }) => accessRole === "MEMBER") ??
        null;
      setHub({
        status: "ready",
        households: households.items,
        incoming: incoming.items,
        nextHouseholdCursor: households.nextCursor,
        nextIncomingCursor: incoming.nextCursor,
      });
      setInvitationCode("");
      acceptanceKey.current = null;
      setAcceptedHouseholdId(joined?.id ?? null);
      setAcceptanceMessage(
        "Shared commitments are now visible read-only. Private records and owner-only controls remain unavailable.",
      );
      if (joined) {
        const next = new URLSearchParams(searchParams);
        next.set("householdId", joined.id);
        router.replace(`/household?${next.toString()}`);
      }
    } catch (error) {
      setAcceptanceMessage(householdErrorMessage(error, "accept"));
    } finally {
      setAccepting(false);
    }
  }

  async function confirmHouseholdAction(householdId: string) {
    if (!pendingAction) {
      return;
    }
    setActionBusy(true);
    setActionResult(null);
    const completedKind = pendingAction.kind;
    try {
      if (pendingAction.kind === "remove") {
        await api.removeMember(
          householdId,
          pendingAction.member.id,
          `"${pendingAction.member.version}"`,
        );
      } else {
        await api.revokeInvitation(
          householdId,
          pendingAction.invitation.id,
          `"${pendingAction.invitation.version}"`,
        );
      }
      setPendingAction(null);
      setActionResult({
        kind: "success",
        message:
          completedKind === "remove"
            ? "The member was removed and shared access ended."
            : "The invitation was revoked and its one-time code no longer works.",
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setPendingAction(null);
      setActionResult({
        kind: "error",
        message: householdErrorMessage(error, "mutate"),
      });
    } finally {
      setActionBusy(false);
    }
  }

  async function loadMoreHub(kind: "households" | "incoming", cursor: string) {
    setPageBusy(kind);
    setPageError(null);
    try {
      if (kind === "households") {
        const page = await api.listHouseholds({ cursor });
        setHub((current) => {
          if (current.status !== "ready") {
            return current;
          }
          return {
            ...current,
            households: mergeById(current.households, page.items),
            nextHouseholdCursor: page.nextCursor,
          };
        });
      } else {
        const page = await api.listIncomingInvitations({ cursor });
        setHub((current) => {
          if (current.status !== "ready") {
            return current;
          }
          return {
            ...current,
            incoming: mergeById(current.incoming, page.items),
            nextIncomingCursor: page.nextCursor,
          };
        });
      }
    } catch (error) {
      setPageError({
        kind,
        message: householdErrorMessage(error, "load"),
      });
    } finally {
      setPageBusy(null);
    }
  }

  async function loadMoreHouseholdCollection(
    kind: "members" | "invitations",
    cursor: string,
  ) {
    if (!selectedHousehold) {
      return;
    }
    const householdId = selectedHousehold.id;
    setPageBusy(kind);
    setPageError(null);
    try {
      const page =
        kind === "members"
          ? await api.listMembers(householdId, { cursor })
          : await api.listHouseholdInvitations(householdId, { cursor });
      setHouseholdState((current) => {
        if (current.status !== "ready" || current.householdId !== householdId) {
          return current;
        }
        if (kind === "members") {
          return {
            ...current,
            members: mergeById(
              current.members,
              page.items as HouseholdMemberDto[],
            ),
            nextMemberCursor: page.nextCursor,
          };
        }
        return {
          ...current,
          invitations: mergeById(
            current.invitations,
            page.items as HouseholdInvitationDto[],
          ),
          nextInvitationCursor: page.nextCursor,
        };
      });
    } catch (error) {
      setPageError({
        kind,
        message: householdErrorMessage(error, "load-members"),
      });
    } finally {
      setPageBusy(null);
    }
  }
}

function MembersPanel({
  canManage,
  error,
  loadingMore,
  members,
  nextCursor,
  onLoadMore,
  onRemove,
}: {
  canManage: boolean;
  error: string | null;
  loadingMore: boolean;
  members: HouseholdMemberDto[];
  nextCursor: string | null;
  onLoadMore: (cursor: string) => void;
  onRemove: (member: HouseholdMemberDto, trigger: HTMLButtonElement) => void;
}) {
  return (
    <section aria-labelledby="members-heading" className="household-panel">
      <div className="household-panel__heading">
        <div>
          <p className="card-kicker">Membership</p>
          <h2 id="members-heading">People with household access</h2>
          <p>
            The founder remains owner. Members receive read-only access only to
            commitments explicitly shared with the household.
          </p>
        </div>
        <span className="status-chip">
          {members.filter(({ status }) => status === "ACTIVE").length} active
        </span>
      </div>
      <ul className="household-member-list">
        {members.map((member) => (
          <li key={member.id}>
            <div className="member-avatar" aria-hidden="true">
              {member.displayName.trim().charAt(0).toUpperCase() || "M"}
            </div>
            <div>
              <strong>{member.displayName}</strong>
              <small>
                {member.role === "OWNER"
                  ? "Immutable owner"
                  : "Read-only member"}{" "}
                · {member.status.toLowerCase()}
              </small>
            </div>
            {canManage &&
              member.role === "MEMBER" &&
              member.status === "ACTIVE" && (
                <button
                  className="danger-link household-compact-action"
                  onClick={(event) => onRemove(member, event.currentTarget)}
                  type="button"
                >
                  Remove
                </button>
              )}
          </li>
        ))}
      </ul>
      {error && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>More members could not be loaded</strong>
          <p>{error}</p>
        </div>
      )}
      {nextCursor && (
        <button
          className="secondary-link secondary-link--button"
          disabled={loadingMore}
          onClick={() => onLoadMore(nextCursor)}
          type="button"
        >
          {loadingMore ? "Loading…" : "Load more household members"}
        </button>
      )}
    </section>
  );
}

function InvitationList({
  error,
  invitations,
  loadingMore,
  nextCursor,
  onLoadMore,
  onRevoke,
}: {
  error: string | null;
  invitations: HouseholdInvitationDto[];
  loadingMore: boolean;
  nextCursor: string | null;
  onLoadMore: (cursor: string) => void;
  onRevoke: (
    invitation: HouseholdInvitationDto,
    trigger: HTMLButtonElement,
  ) => void;
}) {
  return (
    <div className="outgoing-invitations">
      <h3>Invitation history</h3>
      {invitations.length === 0 ? (
        <p>No invitation has been created for this household.</p>
      ) : (
        <ul>
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <div>
                <strong>{invitation.inviteeEmail}</strong>
                <small>
                  {invitation.status.toLowerCase()} · expires{" "}
                  {formatInstant(invitation.expiresAt)}
                </small>
              </div>
              {invitation.status === "PENDING" && (
                <button
                  className="danger-link household-compact-action"
                  onClick={(event) => onRevoke(invitation, event.currentTarget)}
                  type="button"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="resource-state resource-state--error" role="alert">
          <strong>More invitation history could not be loaded</strong>
          <p>{error}</p>
        </div>
      )}
      {nextCursor && (
        <button
          className="secondary-link secondary-link--button"
          disabled={loadingMore}
          onClick={() => onLoadMore(nextCursor)}
          type="button"
        >
          {loadingMore ? "Loading…" : "Load more invitation history"}
        </button>
      )}
    </div>
  );
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const known = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !known.has(item.id))];
}

function householdErrorMessage(
  error: unknown,
  operation: "load" | "load-members" | "invite" | "accept" | "mutate",
) {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "Your secure session expired. Sign in again.";
    }
    if (error.status === 403) {
      return "This signed-in account is not allowed to perform that action.";
    }
    if (error.status === 404) {
      return operation === "accept"
        ? "The code is invalid, expired, revoked, already used, or belongs to another fake account."
        : "This household item is no longer available.";
    }
    if (error.status === 409) {
      return operation === "accept" || operation === "invite"
        ? "A current privacy-notice acknowledgement and household-sharing grant are required, or an active invitation or membership already exists."
        : "The household changed before this action could complete. Reload and review the latest state.";
    }
    if (error.status === 412 || error.status === 428) {
      return "The household changed in another tab. Reload and review the latest version.";
    }
    if (error.status === 429) {
      return "Too many attempts were made. Wait briefly before trying again.";
    }
  }
  if (operation === "load" || operation === "load-members") {
    return "The API could not return household access right now.";
  }
  return "The API could not complete this household action.";
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
