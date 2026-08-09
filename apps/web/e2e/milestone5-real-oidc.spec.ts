import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";

import {
  acquireRealUiLock,
  api,
  apiJson,
  auditEventIds,
  assertDisposableDeletionState,
  assertLocalFixtureAdministration,
  attemptDeletedIdentitySignIn,
  backdateExport,
  backdateInvitation,
  backdateSupportGrant,
  canonicalBaseUrl,
  canonicalNames,
  cleanupNewAuditEvents,
  cleanupNewConsentEventsForEmail,
  cleanupNewGuideFeedback,
  cleanupNewM5IdempotencyRecords,
  cleanupNewNoticeAcknowledgementsForEmail,
  cleanupNewPrivacyRequestsForEmail,
  cleanupNewSupportGrants,
  consentEventIdsForEmail,
  createRealSession,
  disposableGuideId,
  etag,
  expectBrowserStorageEmpty,
  expectRealUiQuality,
  getCommitment,
  guideFeedbackIds,
  idempotencyKey,
  listCommitments,
  m5IdempotencyRecordKeys,
  noticeAcknowledgementIdsForEmail,
  privacyRequestIdsForEmail,
  realUiEnabled,
  resetDisposableDeletionFixture,
  resetDisposableGuideFixture,
  resetMemberPrivacyFixture,
  resetPrivacyFixtureForEmail,
  resetRateEventsForIdentities,
  resolveCanonicalHousehold,
  responseJson,
  restoreCanonicalHousehold,
  restoreMemberTimezone,
  signInRealIdentity,
  signOutAndProtect,
  supportGrantIdsForHousehold,
  uniqueCommitment,
  validateRealUiEnvironment,
  type HouseholdSummary,
  type RealIdentity,
  type RealSession,
} from "./milestone5-real-support";

test.describe.configure({ mode: "serial" });
test.setTimeout(1_200_000);
test.skip(
  !realUiEnabled(),
  "Set M5_REAL_OIDC_UI=true and the guarded fake-local acknowledgement to run mutating real-OIDC journeys.",
);

test("M5 real-OIDC privacy quality smoke", async ({ page }, testInfo) => {
  const baseUrl = String(testInfo.project.use.baseURL ?? canonicalBaseUrl);
  validateRealUiEnvironment(baseUrl);
  await signInRealIdentity(page, "owner", "/settings/privacy");
  await expectRealUiQuality(page, testInfo, "owner privacy quality smoke");
  await expectBrowserStorageEmpty(page);
});

interface JourneyState {
  household: HouseholdSummary;
  sharedCommitmentId: string;
  privateCanaryId: string;
  memberId: string;
  invitationIds: string[];
  invitationCode: string;
  acceptanceKey: string;
  memberOriginalTimezone: string;
  privacyRequestIds: string[];
  ownerPrivacyRequestIds: string[];
  supportGrantIds: string[];
  feedbackId: string | null;
  deletionExportRequestId: string | null;
  deletionRequestId: string | null;
  deletionExecuted: boolean;
  deletionSignedOut: boolean;
  deletionRestored: boolean;
  baselineOwnerPrivacyRequestIds: string[];
  baselineOwnerConsentEventIds: string[];
  baselineOwnerNoticeAcknowledgementIds: string[];
  baselineGuideFeedbackIds: string[];
  baselineSupportGrantIds: string[];
  baselineAuditEventIds: string[];
  baselineM5IdempotencyRecordKeys: string[];
}

interface PrivacyRequest {
  id: string;
  requestType: "EXPORT" | "CORRECTION" | "DELETION";
  status: "REQUESTED" | "READY" | "EXECUTED" | "BLOCKED" | "EXPIRED" | "FAILED";
  correctionValue: string | null;
  version: number;
  export: {
    schemaVersion: string;
    sha256: string;
    byteCount: number;
    expiresAt: string;
  } | null;
}

interface CreatedInvitation {
  invitation: {
    id: string;
    status: string;
    inviteeEmail: string;
    version: number;
  };
  invitationCode: string;
  emailSent: boolean;
}

interface CreatedSupportGrant {
  grant: {
    id: string;
    status: string;
    version: number;
  };
  supportCode: string;
}

const sessionOrder: RealIdentity[] = [
  "owner",
  "member",
  "foreign",
  "guideAdmin",
  "privacyAdmin",
  "auditRead",
  "supportRead",
  "deletion",
];

test("M5 real-OIDC browser acceptance drives unmocked UI/BFF journeys", async ({
  browser,
  page,
}, testInfo) => {
  const baseUrl = String(testInfo.project.use.baseURL ?? canonicalBaseUrl);
  validateRealUiEnvironment(baseUrl);
  const releaseLock = await acquireRealUiLock();
  const sessions = {} as Record<RealIdentity, RealSession>;
  const signedOutIdentities = new Set<RealIdentity>();
  let state: JourneyState | null = null;
  let primaryFailure: unknown = null;
  let cleanupCompleted = false;

  try {
    await assertLocalFixtureAdministration();
    await resetDisposableGuideFixture();
    await resetDisposableDeletionFixture();

    await signInRealIdentity(page, "owner", "/settings/privacy");
    sessions.owner = { context: page.context(), page };
    sessions.member = await createRealSession(
      browser,
      "member",
      testInfo,
      initialPath("member"),
    );

    const household = await resolveCanonicalHousehold(page);
    await restoreCanonicalHousehold(page, household);
    await resetMemberPrivacyFixture();
    await resetPrivacyFixtureForEmail("foreign@autopayguard.local");
    await resetPrivacyFixtureForEmail("deletion@autopayguard.local");
    await resetRateEventsForIdentities(sessionOrder);

    const memberMe = await apiJson<{ timezone: string }>(
      sessions.member.page,
      "GET",
      "/v1/me",
    );
    state = {
      household,
      sharedCommitmentId: "",
      privateCanaryId: "",
      memberId: "",
      invitationIds: [],
      invitationCode: "",
      acceptanceKey: "",
      memberOriginalTimezone: memberMe.timezone,
      privacyRequestIds: [],
      ownerPrivacyRequestIds: [],
      supportGrantIds: [],
      feedbackId: null,
      deletionExportRequestId: null,
      deletionRequestId: null,
      deletionExecuted: false,
      deletionSignedOut: false,
      deletionRestored: false,
      baselineOwnerPrivacyRequestIds: await privacyRequestIdsForEmail(
        "demo@autopayguard.local",
      ),
      baselineOwnerConsentEventIds: await consentEventIdsForEmail(
        "demo@autopayguard.local",
      ),
      baselineOwnerNoticeAcknowledgementIds:
        await noticeAcknowledgementIdsForEmail("demo@autopayguard.local"),
      baselineGuideFeedbackIds: await guideFeedbackIds(),
      baselineSupportGrantIds: await supportGrantIdsForHousehold(household.id),
      baselineAuditEventIds: await auditEventIds(),
      baselineM5IdempotencyRecordKeys: await m5IdempotencyRecordKeys(),
    };

    await test.step("Household owner/member consent, manual invitation, stale sharing, and isolation", async () => {
      await householdSetup(sessions, state!);
    });

    for (const identity of ["foreign", "guideAdmin", "privacyAdmin"] as const) {
      sessions[identity] = await createRealSession(
        browser,
        identity,
        testInfo,
        initialPath(identity),
      );
    }

    await test.step("Subject privacy lifecycle, canonical export, correction, and multi-member deletion block", async () => {
      await privacyJourney(sessions, state!);
    });

    await Promise.all([
      sessions.foreign.context.close(),
      sessions.guideAdmin.context.close(),
      sessions.privacyAdmin.context.close(),
    ]);
    sessions.foreign = await createRealSession(
      browser,
      "foreign",
      testInfo,
      initialPath("foreign"),
    );

    await test.step("Invitation revoke/expiry, consent suspension, replay, and member removal", async () => {
      await finishHouseholdJourney(sessions, state!);
    });
    await signOutAndProtect(sessions.member.page, "/settings/privacy");
    await sessions.member.context.close();
    signedOutIdentities.add("member");

    sessions.privacyAdmin = await createRealSession(
      browser,
      "privacyAdmin",
      testInfo,
      initialPath("privacyAdmin"),
    );
    sessions.deletion = await createRealSession(
      browser,
      "deletion",
      testInfo,
      initialPath("deletion"),
    );
    await test.step("Disposable deletion and canonical-demo protection", async () => {
      await deletionJourney(browser, sessions, state!, testInfo);
    });
    await sessions.deletion.context.close();

    sessions.guideAdmin = await createRealSession(
      browser,
      "guideAdmin",
      testInfo,
      initialPath("guideAdmin"),
    );
    await test.step("Guide draft conflict, publish, redacted feedback, retirement, and role isolation", async () => {
      await guideJourney(sessions, state!);
    });
    await signOutIdentityNow(sessions, "guideAdmin", "/admin/guides");
    signedOutIdentities.add("guideAdmin");
    await signOutIdentityNow(sessions, "privacyAdmin", "/admin/privacy");

    sessions.supportRead = await createRealSession(
      browser,
      "supportRead",
      testInfo,
      initialPath("supportRead"),
    );
    await test.step("Owner/support manual code, bounded diagnostics, revoke, and exact expiry", async () => {
      await supportJourney(sessions, state!);
    });
    await signOutIdentityNow(sessions, "foreign", "/household");
    signedOutIdentities.add("foreign");

    sessions.privacyAdmin = await createRealSession(
      browser,
      "privacyAdmin",
      testInfo,
      initialPath("privacyAdmin"),
    );
    sessions.auditRead = await createRealSession(
      browser,
      "auditRead",
      testInfo,
      initialPath("auditRead"),
    );
    await test.step("Redacted application audit and cross-role navigation denial", async () => {
      await auditJourney(sessions, state!);
    });
    await signOutIdentityNow(sessions, "privacyAdmin", "/admin/privacy");
    signedOutIdentities.add("privacyAdmin");
    await signOutIdentityNow(sessions, "auditRead", "/admin/audit");
    signedOutIdentities.add("auditRead");
    await signOutIdentityNow(sessions, "supportRead", "/support/diagnostics");
    signedOutIdentities.add("supportRead");

    await test.step("Deterministic cleanup, sign-out, storage, and protected returns", async () => {
      await cleanupJourneyFixtures(sessions, state!);
      await restoreDisposableDeletionIdentity(browser, state!, testInfo);
      await cleanupRunMetadata(state!);
      cleanupCompleted = true;
      const refreshedOwner = await createRealSession(
        browser,
        "owner",
        testInfo,
        initialPath("owner"),
      );
      await sessions.owner.context.close();
      sessions.owner = refreshedOwner;
      await signOutAll(sessions, state!, signedOutIdentities);
    });
  } catch (error) {
    primaryFailure = error;
  } finally {
    const cleanupFailures: unknown[] = [];
    if (state && !cleanupCompleted) {
      await cleanupJourneyFixtures(sessions, state).catch((error) =>
        cleanupFailures.push(error),
      );
      await restoreDisposableDeletionIdentity(browser, state, testInfo).catch(
        (error) => cleanupFailures.push(error),
      );
    }
    for (const session of Object.values(sessions)) {
      await session.context
        .close()
        .catch((error) => cleanupFailures.push(error));
    }
    if (state && !cleanupCompleted) {
      await cleanupRunMetadata(state).catch((error) =>
        cleanupFailures.push(error),
      );
    }
    await releaseLock().catch((error) => cleanupFailures.push(error));
    if (primaryFailure || cleanupFailures.length > 0) {
      throw new AggregateError(
        [primaryFailure, ...cleanupFailures].filter(Boolean),
        "Milestone 5 real-OIDC browser acceptance failed.",
      );
    }
  }
});

async function householdSetup(
  sessions: Record<RealIdentity, RealSession>,
  state: JourneyState,
) {
  const owner = sessions.owner.page;
  const member = sessions.member.page;

  await ensurePrivacyReady(owner, false);
  await expect(
    owner.getByText("Acknowledged", { exact: true }).first(),
  ).toBeVisible();
  await member.goto("/settings/privacy");
  await expectPrivacyControlsReady(member);
  await expect(
    member.getByRole("heading", { name: "Export app-owned data" }),
  ).toBeVisible();
  await expect(
    member.getByText("No privacy request has been created."),
  ).toBeVisible();
  const acknowledge = member.getByRole("button", {
    name: "Acknowledge this notice",
  });
  await expect(acknowledge).toBeVisible();
  await acknowledge.focus();
  await expect(acknowledge).toBeFocused();
  await member.keyboard.press("Enter");
  await expect(
    member.getByRole("status").filter({
      hasText: "Current privacy notice acknowledged.",
    }),
  ).toContainText("Current privacy notice acknowledged.");
  await member.getByRole("button", { name: "Grant sharing consent" }).click();
  await expect(member.getByText("Sharing is granted")).toBeVisible();

  const commitments = await listCommitments(owner, state.household.id);
  const shared = uniqueCommitment(commitments, canonicalNames.shared);
  const privateCanary = uniqueCommitment(
    commitments,
    canonicalNames.privateCanary,
  );
  state.sharedCommitmentId = shared.id;
  state.privateCanaryId = privateCanary.id;

  await owner.goto(`/household?householdId=${state.household.id}`);
  await expect(
    owner.getByRole("heading", { name: "Share only what you choose" }),
  ).toBeVisible();
  await owner.getByLabel("Fake local email").fill("member@autopayguard.local");
  const invitationResponse = owner.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/bff/v1/households/${state.household.id}/invitations`),
  );
  const inviteButton = owner.getByRole("button", {
    name: "Create invitation code",
  });
  await inviteButton.focus();
  await owner.keyboard.press("Enter");
  const created = (await (
    await invitationResponse
  ).json()) as CreatedInvitation;
  expect(created.emailSent).toBe(false);
  expect(created.invitation.status).toBe("PENDING");
  expect(created.invitationCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
  state.invitationIds.push(created.invitation.id);
  state.invitationCode = created.invitationCode;
  await expect(
    owner.getByRole("status").filter({
      hasText: "Invitation created locally. No email was sent.",
    }),
  ).toHaveText("Invitation created locally. No email was sent.");
  await expect(
    owner.locator('output[aria-label="One-time invitation code"]'),
  ).toHaveText(state.invitationCode);
  await assertSecretAbsentFromStorage(owner, state.invitationCode);

  await member.goto("/household");
  await expect(member.getByText(state.household.name)).toBeVisible();
  await member
    .getByLabel("One-time invitation code")
    .fill(state.invitationCode);
  const acceptanceRequest = member.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/bff/v1/household-invitations/accept"),
  );
  const acceptanceResponse = member.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/bff/v1/household-invitations/accept"),
  );
  const accept = member.getByRole("button", { name: "Accept invitation" });
  await accept.focus();
  await member.keyboard.press("Enter");
  const request = await acceptanceRequest;
  state.acceptanceKey = request.headers()["idempotency-key"] ?? "";
  expect(state.acceptanceKey).toMatch(/^m5-invitation-accept-/);
  const accepted = (await (await acceptanceResponse).json()) as {
    id: string;
    role: string;
    status: string;
    version: number;
  };
  state.memberId = accepted.id;
  expect(accepted.role).toBe("MEMBER");
  expect(accepted.status).toBe("ACTIVE");
  await expect(
    member.getByRole("status").filter({ hasText: "Invitation accepted" }),
  ).toContainText("Invitation accepted");
  await api(member, "POST", "/v1/household-invitations/accept", {
    expectedStatus: 200,
    headers: { "idempotency-key": state.acceptanceKey },
    data: { invitationCode: state.invitationCode },
  });

  await owner.goto(
    `/commitments/${shared.id}?householdId=${state.household.id}`,
  );
  await expect(
    owner.getByRole("heading", { name: canonicalNames.shared }),
  ).toBeVisible();
  await expect(
    owner.getByText(
      /Responsibility is a planning label only\. It does not grant ownership, editing, payment authority, provider access, or notification subscription\./,
    ),
  ).toBeVisible();
  await owner.getByRole("radio", { name: /^Household\b/ }).check();
  await owner
    .getByLabel("Optional planning responsibility")
    .selectOption(state.memberId);

  const current = await getCommitment(owner, shared.id);
  await api(owner, "PATCH", `/v1/commitments/${shared.id}/sharing`, {
    headers: { "if-match": current.etag },
    data: { visibility: "HOUSEHOLD", responsibleMemberId: null },
  });
  await owner.getByRole("button", { name: "Save visibility" }).click();
  const stale = owner.getByRole("alert").filter({
    hasText: "Sharing not changed",
  });
  await expect(stale).toContainText(
    "This commitment changed in another tab. Reload before choosing visibility again.",
  );
  await stale.getByRole("button", { name: "Reload latest version" }).click();
  const responsibility = owner.getByLabel("Optional planning responsibility");
  await expect(responsibility).toHaveValue("");
  await responsibility.selectOption(state.memberId);
  const saveVisibility = owner.getByRole("button", {
    name: "Save visibility",
  });
  await expect(saveVisibility).toBeEnabled();
  await saveVisibility.click();
  await expect(
    owner.getByRole("status").filter({ hasText: "Sharing updated" }),
  ).toContainText("Sharing updated");

  await member.goto(
    `/commitments/${shared.id}?householdId=${state.household.id}`,
  );
  await expect(
    member.getByRole("heading", { name: canonicalNames.shared }),
  ).toBeVisible();
  await expect(member.getByText("Read-only household view")).toBeVisible();
  await expect(
    member.getByText(
      "You can view this record, but only the household owner can change it.",
    ),
  ).toBeVisible();
  await expect(member.getByTestId("edit-commitment-link")).toHaveCount(0);
  await expect(member.getByTestId("archive-commitment-button")).toHaveCount(0);
  await expect(member.locator("#main-content")).not.toContainText(
    canonicalNames.privateCanary,
  );
  await expect(member.locator("#main-content")).not.toContainText(
    state.privateCanaryId,
  );

  await member.goto(`/dashboard?householdId=${state.household.id}`);
  await expect(member.locator("#main-content")).not.toContainText(
    canonicalNames.privateCanary,
  );
  await expect(member.locator("#main-content")).not.toContainText(
    state.privateCanaryId,
  );
  await member.goto(`/household?householdId=${state.household.id}`);
  await expect(
    member.getByText(
      "You are a read-only member. Totals cover only records visible to you.",
    ),
  ).toBeVisible();
  await expect(
    member.getByRole("heading", {
      name: "Owner controls stay with the founder",
    }),
  ).toBeVisible();
}

async function privacyJourney(
  sessions: Record<RealIdentity, RealSession>,
  state: JourneyState,
) {
  const member = sessions.member.page;
  const foreign = sessions.foreign.page;
  const privacyAdmin = sessions.privacyAdmin.page;
  const guideAdmin = sessions.guideAdmin.page;

  await member.goto("/settings/privacy");
  await expect(
    member.getByText(
      /The generated canonical JSON is available only to your signed-in subject, is integrity-labeled, and expires within 24 hours\./,
    ),
  ).toBeVisible();
  await expect(
    member.getByText(
      /Only your app-owned IANA timezone can be corrected here\./,
    ),
  ).toBeVisible();
  await expect(
    member.getByText(
      /This does not delete your Keycloak identity and is not a legal-compliance claim\./,
    ),
  ).toBeVisible();

  const exportRequest = await createPrivacyRequestViaUi(
    member,
    "Request JSON export",
  );
  state.privacyRequestIds.push(exportRequest.id);
  expect(exportRequest.status).toBe("READY");
  expect(exportRequest.export?.schemaVersion).toBe("autopay-guard-export-v1");

  const exportPath = `/v1/privacy/requests/${exportRequest.id}/export`;
  await api(foreign, "GET", exportPath, { expectedStatus: 404 });
  await api(guideAdmin, "GET", exportPath, { expectedStatus: 403 });
  await api(privacyAdmin, "GET", exportPath, { expectedStatus: 403 });

  await member.reload();
  const downloadEvent = member.waitForEvent("download");
  await member.getByRole("button", { name: "Download canonical JSON" }).click();
  const download = await downloadEvent;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("The canonical JSON UI download did not create a file.");
  }
  const bytes = await readFile(downloadPath);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  expect(text.charCodeAt(0)).not.toBe(0xfeff);
  expect(JSON.stringify(JSON.parse(text))).toBe(text);
  const payload = JSON.parse(text) as Record<string, unknown>;
  expect(Object.keys(payload)).toEqual(
    [
      "schemaVersion",
      "generatedAt",
      "subject",
      "noticeAcknowledgements",
      "consentEvents",
      "memberships",
      "households",
      "notificationData",
      "cancellationData",
      "privacyRequests",
      "auditEvents",
      "supportGrants",
    ].sort(),
  );
  expect(payload.schemaVersion).toBe("autopay-guard-export-v1");
  for (const forbidden of [
    "access_token",
    "refresh_token",
    "password",
    "token_hash",
    "code_hash",
    "idempotency",
    "raw_failure",
  ]) {
    expect(text.toLowerCase()).not.toContain(forbidden);
  }

  await backdateExport(exportRequest.id);
  await member.waitForTimeout(1_200);
  await member.reload();
  await expect(
    member.getByText(
      /The stored export bytes reached their retention deadline and were physically removed\./,
    ),
  ).toBeVisible();
  await api(member, "GET", exportPath, { expectedStatus: 410 });

  const alternate =
    state.memberOriginalTimezone === "UTC" ? "Asia/Kolkata" : "UTC";
  await member.getByLabel("IANA timezone").fill(alternate);
  const correction = await createPrivacyRequestViaUi(
    member,
    "Request timezone correction",
  );
  state.privacyRequestIds.push(correction.id);

  await privacyAdmin.goto("/admin/privacy");
  await expect(
    privacyAdmin.getByRole("heading", { name: "Privacy request queue" }),
  ).toBeVisible();
  const correctionCard = privacyAdmin
    .locator("article")
    .filter({ hasText: correction.id });
  await correctionCard
    .getByRole("radio", { name: "Select for conditional execution" })
    .check();
  await privacyAdmin
    .getByLabel("Type EXECUTE CORRECTION")
    .fill("EXECUTE CORRECTION");

  await api(
    privacyAdmin,
    "POST",
    `/v1/admin/privacy/requests/${correction.id}/execute`,
    {
      headers: {
        "if-match": `"${correction.version}"`,
        "idempotency-key": idempotencyKey("m5-real-stale-correction-winner"),
      },
    },
  );
  await privacyAdmin
    .getByRole("button", { name: "Execute conditional local operation" })
    .click();
  await expect(
    privacyAdmin.getByRole("alert").filter({ hasText: "Request not executed" }),
  ).toContainText(
    "The request changed in another session. Refresh before executing.",
  );
  const correctedMe = await apiJson<{ timezone: string }>(
    member,
    "GET",
    "/v1/me",
  );
  expect(correctedMe.timezone).toBe(alternate);

  await member.reload();
  await member.getByLabel("IANA timezone").fill(state.memberOriginalTimezone);
  const restoration = await createPrivacyRequestViaUi(
    member,
    "Request timezone correction",
  );
  state.privacyRequestIds.push(restoration.id);
  await executePrivacyRequestViaUi(
    privacyAdmin,
    restoration,
    "Privacy request moved to EXECUTED.",
  );
  const restoredMe = await apiJson<{ timezone: string }>(
    member,
    "GET",
    "/v1/me",
  );
  expect(restoredMe.timezone).toBe(state.memberOriginalTimezone);

  await member.goto("/settings/privacy");
  await member.getByLabel("Type DELETE LOCAL DATA").fill("DELETE LOCAL DATA");
  const memberDeletion = await createPrivacyRequestViaUi(
    member,
    "Request local deletion",
  );
  state.privacyRequestIds.push(memberDeletion.id);
  await executePrivacyRequestViaUi(
    privacyAdmin,
    memberDeletion,
    "Execution was safely blocked; household and user data were preserved.",
  );
  await expect(
    privacyAdmin.getByText("BLOCKED", { exact: true }).first(),
  ).toBeVisible();
}

async function finishHouseholdJourney(
  sessions: Record<RealIdentity, RealSession>,
  state: JourneyState,
) {
  const owner = sessions.owner.page;
  const member = sessions.member.page;
  const foreign = sessions.foreign.page;

  await member.goto("/settings/privacy");
  const withdrawConfirmation = member.getByRole("checkbox", {
    name: /I understand that withdrawing pauses member access/,
  });
  await withdrawConfirmation.check();
  const withdraw = member.getByRole("button", {
    name: "Withdraw sharing consent",
  });
  await withdraw.focus();
  await member.keyboard.press("Enter");
  await expect(
    member.getByRole("status").filter({
      hasText: "Household sharing consent withdrawn.",
    }),
  ).toContainText("Household sharing consent withdrawn.");
  await member.goto(
    `/commitments/${state.sharedCommitmentId}?householdId=${state.household.id}`,
  );
  await expect(
    member.getByRole("heading", { name: "Create your workspace first" }),
  ).toBeVisible();
  await expect(member.getByText(canonicalNames.shared)).toHaveCount(0);
  await member.goto("/settings/privacy");
  await member.getByRole("button", { name: "Grant sharing consent" }).click();
  await expect(member.getByText("Sharing is granted")).toBeVisible();

  await owner.goto("/settings/privacy");
  await owner
    .getByRole("checkbox", {
      name: /I understand that withdrawing pauses member access/,
    })
    .check();
  await owner.getByRole("button", { name: "Withdraw sharing consent" }).click();
  await expect(owner.getByText("Sharing is not granted")).toBeVisible();
  await member.goto(
    `/commitments/${state.sharedCommitmentId}?householdId=${state.household.id}`,
  );
  await expect(
    member.getByRole("heading", { name: "Create your workspace first" }),
  ).toBeVisible();
  await expect(member.getByText(canonicalNames.shared)).toHaveCount(0);
  await owner.goto("/settings/privacy");
  await owner.getByRole("button", { name: "Grant sharing consent" }).click();
  await expect(owner.getByText("Sharing is granted")).toBeVisible();

  const revoked = await createInvitationViaUi(
    owner,
    state.household.id,
    "foreign@autopayguard.local",
  );
  state.invitationIds.push(revoked.invitation.id);
  await owner.goto(`/household?householdId=${state.household.id}`);
  const revokedRow = owner
    .locator(".outgoing-invitations li")
    .filter({ hasText: "foreign@autopayguard.local" })
    .filter({ hasText: "pending" })
    .first();
  const revoke = revokedRow.getByRole("button", { name: "Revoke" });
  await revoke.focus();
  await owner.keyboard.press("Enter");
  const confirmation = owner.getByRole("alertdialog");
  await expect(confirmation).toBeFocused();
  await confirmation.getByRole("button", { name: "Revoke invitation" }).click();
  const revokedStatus = owner.getByRole("status").filter({
    hasText: "Household change completed",
  });
  await expect(revokedStatus).toContainText(
    "The invitation was revoked and its one-time code no longer works.",
  );

  await ensurePrivacyReady(foreign, true);
  await foreign.goto("/household");
  await foreign
    .getByLabel("One-time invitation code")
    .fill(revoked.invitationCode);
  await foreign.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    foreign
      .getByRole("alert")
      .filter({ hasText: "Could not accept invitation" }),
  ).toContainText(/invalid, expired, revoked, already used/i);

  const expiring = await createInvitationViaUi(
    owner,
    state.household.id,
    "foreign@autopayguard.local",
  );
  state.invitationIds.push(expiring.invitation.id);
  await backdateInvitation(expiring.invitation.id);
  await foreign.goto("/household");
  await foreign
    .getByLabel("One-time invitation code")
    .fill(expiring.invitationCode);
  await foreign.getByRole("button", { name: "Accept invitation" }).click();
  const expiryAlert = foreign.getByRole("alert").filter({
    hasText: "Could not accept invitation",
  });
  await expect(expiryAlert).toContainText(/invalid, expired, revoked/i);
  await expect(expiryAlert).toBeVisible();

  await api(member, "POST", "/v1/household-invitations/accept", {
    expectedStatus: 200,
    headers: { "idempotency-key": state.acceptanceKey },
    data: { invitationCode: state.invitationCode },
  });

  await owner.goto(`/household?householdId=${state.household.id}`);
  const memberRow = owner
    .locator(".household-panel li")
    .filter({ hasText: "Member User" })
    .first();
  const remove = memberRow.getByRole("button", { name: "Remove" });
  await remove.focus();
  await owner.keyboard.press("Enter");
  const removal = owner.getByRole("alertdialog");
  await expect(removal).toBeFocused();
  await removal.getByRole("button", { name: "Remove member" }).click();
  await expect(
    owner.getByRole("status").filter({ hasText: "Household change completed" }),
  ).toContainText("The member was removed and shared access ended.");

  const sharedAfterRemoval = await getCommitment(
    owner,
    state.sharedCommitmentId,
  );
  expect(sharedAfterRemoval.body.responsibleMemberId).toBeNull();
  await member.goto(
    `/commitments/${state.sharedCommitmentId}?householdId=${state.household.id}`,
  );
  await expect(
    member.getByRole("heading", { name: "Create your workspace first" }),
  ).toBeVisible();
  await expect(member.getByText(canonicalNames.shared)).toHaveCount(0);
}

async function deletionJourney(
  browser: Parameters<typeof attemptDeletedIdentitySignIn>[0],
  sessions: Record<RealIdentity, RealSession>,
  state: JourneyState,
  testInfo: TestInfo,
) {
  const owner = sessions.owner.page;
  const deletion = sessions.deletion.page;
  const privacyAdmin = sessions.privacyAdmin.page;

  await ensurePrivacyReady(deletion, true);
  const disposableMe = await apiJson<{ id: string }>(deletion, "GET", "/v1/me");

  const disposableExport = await createPrivacyRequestViaUi(
    deletion,
    "Request JSON export",
  );
  state.deletionExportRequestId = disposableExport.id;
  expect(disposableExport.status).toBe("READY");
  await deletion.getByLabel("Type DELETE LOCAL DATA").fill("DELETE LOCAL DATA");
  const disposableDeletion = await createPrivacyRequestViaUi(
    deletion,
    "Request local deletion",
  );
  state.deletionRequestId = disposableDeletion.id;

  await executePrivacyRequestViaUi(
    privacyAdmin,
    disposableDeletion,
    "Privacy request moved to EXECUTED.",
    () => {
      state.deletionExecuted = true;
    },
  );
  expect(state.deletionExecuted).toBe(true);
  await api(deletion, "GET", "/v1/me", { expectedStatus: 403 });
  await assertDisposableDeletionState(disposableMe.id, disposableExport.id);
  await signOutAndProtect(deletion, "/settings/privacy");
  state.deletionSignedOut = true;
  await attemptDeletedIdentitySignIn(browser, testInfo);

  await owner.goto("/settings/privacy");
  await owner.getByLabel("Type DELETE LOCAL DATA").fill("DELETE LOCAL DATA");
  const protectedDeletion = await createPrivacyRequestViaUi(
    owner,
    "Request local deletion",
  );
  state.ownerPrivacyRequestIds.push(protectedDeletion.id);
  await executePrivacyRequestViaUi(
    privacyAdmin,
    protectedDeletion,
    "Execution was safely blocked; household and user data were preserved.",
  );
  const ownerMe = await apiJson<{ email: string }>(owner, "GET", "/v1/me");
  expect(ownerMe.email).toBe("demo@autopayguard.local");
  expect((await resolveCanonicalHousehold(owner)).id).toBe(state.household.id);
}

async function guideJourney(
  sessions: Record<RealIdentity, RealSession>,
  state: JourneyState,
) {
  const owner = sessions.owner.page;
  const guideAdmin = sessions.guideAdmin.page;

  const catalog = await apiJson<{
    items: Array<{
      guideId: string;
      merchantName: string;
      state: string;
      version: number;
    }>;
  }>(guideAdmin, "GET", "/v1/admin/cancellation-guides");
  const reservedGuide = catalog.items.find(
    ({ guideId }) => guideId === disposableGuideId,
  );
  if (!reservedGuide) {
    throw new Error(
      "The reserved fictional guide was absent from the UI catalog.",
    );
  }

  await guideAdmin.goto("/admin/guides");
  await expect(
    guideAdmin.getByRole("heading", {
      name: "Fictional guide administration",
    }),
  ).toBeVisible();
  await expect(
    guideAdmin.getByText(
      /Publishing makes a fictional local guide current; it does not verify a merchant or link, and no provider is contacted\./,
    ),
  ).toBeVisible();
  const guideCard = guideAdmin
    .locator("article")
    .filter({ hasText: reservedGuide.merchantName })
    .first();
  await guideCard
    .getByRole("link", { name: "Open guide and immutable history" })
    .click();
  await expect(
    guideAdmin.getByRole("heading", { name: reservedGuide.merchantName }),
  ).toBeVisible();
  const createDraft = guideAdmin.getByRole("button", {
    name: "Create server-cloned draft",
  });
  await createDraft.focus();
  await guideAdmin.keyboard.press("Enter");
  await guideAdmin.waitForURL(/\/admin\/guides\/drafts\/[0-9a-f-]+$/);
  const draftId = new URL(guideAdmin.url()).pathname.split("/").at(-1);
  if (!draftId) {
    throw new Error(
      "The guide draft URL did not expose its bounded identifier.",
    );
  }
  await expect(
    guideAdmin.getByRole("heading", { name: "Edit fictional guide text" }),
  ).toBeVisible();
  await expect(
    guideAdmin.getByText(
      /All identifiers, merchant data, versions, status, timestamps, tracks, sequence, action types, targets, allowlists, and catalog-head state remain immutable and server controlled\./,
    ),
  ).toBeVisible();

  const draftResponse = await api(
    guideAdmin,
    "GET",
    `/v1/admin/cancellation-guide-drafts/${draftId}`,
  );
  const draft = await responseJson<{
    guideVersion: number;
    version: number;
    riskNotice: string;
    reviewIntervalDays: number;
    steps: Array<{
      track: string;
      sequenceNumber: number;
      title: string;
      instruction: string;
      actionType: string;
      targetKey: string | null;
      targetUri: string | null;
    }>;
  }>(draftResponse);
  const externalBody = {
    riskNotice:
      "External fictional local edit used only to prove stale-write recovery.",
    reviewIntervalDays: 62,
    steps: draft.steps.map(({ track, sequenceNumber, title, instruction }) => ({
      track,
      sequenceNumber,
      title,
      instruction,
    })),
  };

  await guideAdmin
    .getByLabel("Risk notice")
    .fill("Unsaved fictional local text survives the stale response.");
  await api(
    guideAdmin,
    "PATCH",
    `/v1/admin/cancellation-guide-drafts/${draftId}`,
    {
      headers: { "if-match": etag(draftResponse, draft.version) },
      data: externalBody,
    },
  );
  await guideAdmin.getByRole("button", { name: "Save draft text" }).click();
  const stale = guideAdmin.getByRole("alert").filter({
    hasText: "Draft operation was not completed",
  });
  await expect(stale).toContainText(
    "This draft changed in another session. Your unsaved text remains on screen",
  );
  await expect(guideAdmin.getByLabel("Risk notice")).toHaveValue(
    "Unsaved fictional local text survives the stale response.",
  );
  await stale.getByRole("button", { name: "Reload latest draft" }).click();

  const allowedRisk =
    "Fictional local M5 browser guide. No merchant or provider was contacted.";
  await guideAdmin.getByLabel("Risk notice").fill(allowedRisk);
  await guideAdmin.getByLabel("Review interval in days").fill("61");
  const titles = guideAdmin.getByRole("textbox", { name: "Step title" });
  const instructions = guideAdmin.getByRole("textbox", {
    name: "Step instruction",
  });
  await titles.first().fill("Review fictional local service controls");
  await instructions
    .first()
    .fill("Use only this fictional local instruction during acceptance.");
  await guideAdmin.getByRole("button", { name: "Save draft text" }).click();
  await expect(
    guideAdmin.getByRole("status").filter({
      hasText: /Draft text saved with conditional version/,
    }),
  ).toContainText(/Draft text saved with conditional version/);
  await guideAdmin
    .getByLabel(`Type PUBLISH VERSION ${draft.guideVersion}`)
    .fill(`PUBLISH VERSION ${draft.guideVersion}`);
  const publish = guideAdmin.getByRole("button", {
    name: "Publish fictional guide",
  });
  await publish.focus();
  await guideAdmin.keyboard.press("Enter");
  await expect(
    guideAdmin.getByRole("heading", { name: "Fictional guide published" }),
  ).toBeVisible();
  await expect(
    guideAdmin.getByText(
      /This does not verify a merchant or link, and no provider was contacted\./,
    ),
  ).toBeVisible();

  const cancellationGuide = await apiJson<{ id: string; version: number }>(
    owner,
    "GET",
    `/v1/commitments/${state.sharedCommitmentId}/cancellation-guide`,
  );
  const feedbackBefore = await listFeedback(guideAdmin);
  const canary = `PRIVATE MILESTONE FIVE FEEDBACK ${alphabeticUuid()}`;
  await api(
    owner,
    "POST",
    `/v1/cancellation-guides/${cancellationGuide.id}/feedback`,
    {
      expectedStatus: 204,
      headers: {
        "idempotency-key": idempotencyKey("m5-real-feedback-create"),
      },
      data: {
        commitmentId: state.sharedCommitmentId,
        guideVersion: cancellationGuide.version,
        outcome: "WORKED",
        note: canary,
      },
    },
  );
  const feedbackAfter = await listFeedback(guideAdmin);
  const beforeIds = new Set(feedbackBefore.map(({ id }) => id));
  const createdFeedback = feedbackAfter.filter(
    (item) =>
      !beforeIds.has(item.id) &&
      item.guideId === cancellationGuide.id &&
      item.disposition === "PENDING",
  );
  if (createdFeedback.length !== 1) {
    throw new Error("One redacted guide feedback row was not created.");
  }
  state.feedbackId = createdFeedback[0]!.id;

  await guideAdmin.goto("/admin/guides");
  const feedbackCard = guideAdmin
    .locator("article")
    .filter({ hasText: `Feedback ${state.feedbackId}` });
  await expect(feedbackCard).toBeVisible();
  await expect(feedbackCard).not.toContainText(canary);
  await expect(feedbackCard).not.toContainText("demo@autopayguard.local");
  await expect(feedbackCard).not.toContainText(canonicalNames.shared);
  await feedbackCard.getByRole("radio", { name: "Mark resolved" }).check();
  await feedbackCard
    .getByRole("checkbox", {
      name: /I confirm this changes only the redacted feedback review disposition/,
    })
    .check();
  await feedbackCard
    .getByRole("button", { name: "Save feedback review" })
    .click();
  await expect(
    guideAdmin.getByRole("status").filter({
      hasText: "Feedback review saved as resolved.",
    }),
  ).toContainText("Feedback review saved as resolved.");

  await guideAdmin.goto(`/admin/guides/${disposableGuideId}`);
  await expect(
    guideAdmin.getByText("Immutable published version").first(),
  ).toBeVisible();
  await guideAdmin.getByLabel("Type RETIRE GUIDE").fill("RETIRE GUIDE");
  const retire = guideAdmin.getByRole("button", { name: "Retire guide head" });
  await retire.focus();
  await guideAdmin.keyboard.press("Enter");
  await expect(
    guideAdmin.getByRole("status").filter({
      hasText:
        "The current fictional local guide head was retired. Immutable history was preserved.",
    }),
  ).toContainText(
    "The current fictional local guide head was retired. Immutable history was preserved.",
  );
  await expect(
    guideAdmin.getByText("Immutable published version").first(),
  ).toBeVisible();
  const ownerDenied = await owner.goto("/admin/guides");
  expect(ownerDenied?.status()).toBe(404);
  const privacyDenied = await sessions.privacyAdmin.page.goto("/admin/guides");
  expect(privacyDenied?.status()).toBe(404);
}

async function supportJourney(
  sessions: Record<RealIdentity, RealSession>,
  state: JourneyState,
) {
  const owner = sessions.owner.page;
  const support = sessions.supportRead.page;
  const foreign = sessions.foreign.page;
  const denialMessage =
    "The role/code pair is invalid, revoked, expired, or unavailable.";

  await owner.goto(`/settings/support?householdId=${state.household.id}`);
  await expect(
    owner.getByRole("heading", { name: "Redacted support diagnostics" }),
  ).toBeVisible();
  await expect(
    owner.getByText(
      /never names, amounts, notes, targets, credentials, or impersonation/,
    ),
  ).toBeVisible();
  const first = await createSupportCodeViaUi(owner);
  state.supportGrantIds.push(first.grant.id);
  await expect(owner.locator("output")).toHaveText(first.supportCode);
  await assertSecretAbsentFromStorage(owner, first.supportCode);

  await api(owner, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 403,
    data: { supportCode: first.supportCode },
  });
  await api(foreign, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 403,
    data: { supportCode: first.supportCode },
  });

  await support.goto("/support/diagnostics");
  await expect(
    support.getByRole("heading", { name: "Redacted local diagnostics" }),
  ).toBeVisible();
  await expect(
    support.getByText(
      /no account search, impersonation, raw logs, message retry, resend, or household mutation/,
    ),
  ).toBeVisible();
  await expect(
    support.getByText(/This view is read-only and code-scoped\./),
  ).toBeVisible();
  await expect(
    support.getByText(/it is not proof of incident resolution/),
  ).toBeVisible();
  await api(support, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 400,
    data: {},
  });
  await support.getByLabel("Owner-provided support code").fill("A".repeat(43));
  await support
    .getByRole("button", { name: "Open redacted diagnostics" })
    .click();
  await expect(
    support.getByRole("alert").filter({ hasText: denialMessage }),
  ).toHaveText(denialMessage);

  await support
    .getByLabel("Owner-provided support code")
    .fill(first.supportCode);
  const resolve = support.getByRole("button", {
    name: "Open redacted diagnostics",
  });
  await resolve.focus();
  await support.keyboard.press("Enter");
  const diagnostics = support.getByRole("heading", {
    name: "Bounded workspace state",
  });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.locator("xpath=ancestor::section")).toBeFocused();
  await expect(support.getByText("Active commitments")).toBeVisible();
  await expect(support.locator("#main-content")).not.toContainText(
    canonicalNames.privateCanary,
  );
  await expect(support.locator("#main-content")).not.toContainText(
    state.privateCanaryId,
  );
  await expect(support.locator("#main-content")).not.toContainText("₹");
  await owner.getByRole("button", { name: "Revoke now" }).click();
  await expect(
    owner.getByRole("status").filter({ hasText: "Support code revoked." }),
  ).toContainText("Support code revoked.");
  await support
    .getByLabel("Owner-provided support code")
    .fill(first.supportCode);
  await support
    .getByRole("button", { name: "Open redacted diagnostics" })
    .click();
  await expect(
    support.getByRole("alert").filter({ hasText: denialMessage }),
  ).toBeFocused();

  await owner.goto(`/settings/support?householdId=${state.household.id}`);
  const second = await createSupportCodeViaUi(owner);
  state.supportGrantIds.push(second.grant.id);
  await backdateSupportGrant(second.grant.id);
  await support
    .getByLabel("Owner-provided support code")
    .fill(second.supportCode);
  await support
    .getByRole("button", { name: "Open redacted diagnostics" })
    .click();
  await expect(
    support.getByRole("alert").filter({ hasText: denialMessage }),
  ).toHaveText(denialMessage);
}

async function auditJourney(
  sessions: Record<RealIdentity, RealSession>,
  state: JourneyState,
) {
  const audit = sessions.auditRead.page;
  const events = await listAllAuditEvents(audit);
  const baselineIds = new Set(state.baselineAuditEventIds);
  const currentRunEvents = events.filter(
    (event) => typeof event.id === "string" && !baselineIds.has(event.id),
  );
  const exactKeys = [
    "id",
    "occurredAt",
    "actorRole",
    "action",
    "resourceType",
    "resourceId",
    "outcome",
    "correlationId",
  ].sort();
  for (const event of events) {
    expect(Object.keys(event).sort()).toEqual(exactKeys);
  }
  const [acceptedInvitationId, revokedInvitationId, expiredInvitationId] =
    state.invitationIds;
  const [activeSupportGrantId, expiredSupportGrantId] = state.supportGrantIds;
  if (
    !acceptedInvitationId ||
    !revokedInvitationId ||
    !expiredInvitationId ||
    !activeSupportGrantId ||
    !expiredSupportGrantId ||
    !state.feedbackId ||
    !state.deletionRequestId
  ) {
    throw new Error(
      "The real-OIDC journey did not retain its audit resource identifiers.",
    );
  }
  const privacyRequestIds = [
    ...state.privacyRequestIds,
    ...state.ownerPrivacyRequestIds,
  ];
  const expectedAuditResources = new Map<string, string[]>([
    ["HOUSEHOLD_INVITATION_CREATED", state.invitationIds],
    ["HOUSEHOLD_INVITATION_ACCEPTED", [acceptedInvitationId]],
    ["HOUSEHOLD_INVITATION_REVOKED", [revokedInvitationId]],
    ["HOUSEHOLD_INVITATION_EXPIRED", [expiredInvitationId]],
    ["HOUSEHOLD_MEMBER_REMOVED", [state.memberId]],
    ["COMMITMENT_SHARING_CHANGED", [state.sharedCommitmentId]],
    ["PRIVACY_CORRECTION_EXECUTED", state.privacyRequestIds],
    ["PRIVACY_DELETION_BLOCKED", privacyRequestIds],
    ["PRIVACY_DELETION_EXECUTED", [state.deletionRequestId]],
    ["GUIDE_DRAFT_CREATED", [disposableGuideId]],
    ["GUIDE_DRAFT_SAVED", [disposableGuideId]],
    ["GUIDE_PUBLISHED", [disposableGuideId]],
    ["GUIDE_RETIRED", [disposableGuideId]],
    ["GUIDE_FEEDBACK_REVIEWED", [state.feedbackId]],
    ["SUPPORT_GRANT_CREATED", state.supportGrantIds],
    ["SUPPORT_GRANT_REVOKED", [activeSupportGrantId]],
    ["SUPPORT_GRANT_EXPIRED", [expiredSupportGrantId]],
    ["SUPPORT_DIAGNOSTICS_VIEWED", [activeSupportGrantId]],
  ]);
  for (const [action, resourceIds] of expectedAuditResources) {
    expect(
      currentRunEvents.some(
        (event) =>
          event.action === action &&
          typeof event.resourceId === "string" &&
          resourceIds.includes(event.resourceId),
      ),
      `This run's redacted audit omitted ${action} for its expected resource.`,
    ).toBe(true);
  }

  await audit.goto("/admin/audit");
  await expect(
    audit.getByRole("heading", { name: "Local application audit" }),
  ).toBeVisible();
  await expect(
    audit.getByText(
      /This is not a legal compliance report or a complete infrastructure audit/,
    ),
  ).toBeVisible();
  await expect(
    audit.getByRole("cell", { name: "SUPPORT_GRANT_EXPIRED" }).first(),
  ).toBeVisible();
  await expect(audit.locator("#main-content")).not.toContainText(
    "demo@autopayguard.local",
  );
  await expect(audit.locator("#main-content")).not.toContainText(
    canonicalNames.privateCanary,
  );
  await expect(audit.locator("#main-content")).not.toContainText(
    state.privateCanaryId,
  );
  await expect(audit.locator("#main-content")).not.toContainText("₹");
  const guideCrossRole = await sessions.privacyAdmin.page.goto("/admin/audit");
  expect(guideCrossRole?.status()).toBe(404);
  const auditCrossRole = await sessions.auditRead.page.goto("/admin/privacy");
  expect(auditCrossRole?.status()).toBe(404);
  const supportCrossRole = await sessions.supportRead.page.goto("/admin/audit");
  expect(supportCrossRole?.status()).toBe(404);
}

async function cleanupJourneyFixtures(
  sessions: Partial<Record<RealIdentity, RealSession>>,
  state: JourneyState,
) {
  const failures: unknown[] = [];
  const attempt = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      failures.push(new Error(label, { cause: error }));
    }
  };
  const owner = sessions.owner?.page;
  if (owner) {
    await attempt("Owner privacy readiness could not be restored.", () =>
      ensurePrivacyReady(owner, false),
    );
    await attempt("The canonical household could not be restored.", () =>
      restoreCanonicalHousehold(owner, state.household),
    );
  }
  await attempt("The member timezone could not be restored.", () =>
    restoreMemberTimezone(state.memberOriginalTimezone),
  );
  await attempt("The member privacy fixture could not be reset.", () =>
    resetMemberPrivacyFixture(),
  );
  await attempt("The foreign privacy fixture could not be reset.", () =>
    resetPrivacyFixtureForEmail("foreign@autopayguard.local"),
  );
  await attempt("The deletion privacy fixture could not be reset.", () =>
    resetPrivacyFixtureForEmail("deletion@autopayguard.local"),
  );
  await attempt("Owner privacy requests could not be restored.", () =>
    cleanupNewPrivacyRequestsForEmail(
      "demo@autopayguard.local",
      state.baselineOwnerPrivacyRequestIds,
    ),
  );
  await attempt("Owner consent events could not be restored.", () =>
    cleanupNewConsentEventsForEmail(
      "demo@autopayguard.local",
      state.baselineOwnerConsentEventIds,
    ),
  );
  await attempt("Owner notice acknowledgements could not be restored.", () =>
    cleanupNewNoticeAcknowledgementsForEmail(
      "demo@autopayguard.local",
      state.baselineOwnerNoticeAcknowledgementIds,
    ),
  );
  await attempt("Guide feedback could not be restored.", () =>
    cleanupNewGuideFeedback(state.baselineGuideFeedbackIds),
  );
  await attempt("Support grants could not be restored.", () =>
    cleanupNewSupportGrants(state.household.id, state.baselineSupportGrantIds),
  );
  await attempt("The disposable guide could not be reset.", () =>
    resetDisposableGuideFixture(),
  );
  await attempt("The disposable deletion fixture could not be reset.", () =>
    resetDisposableDeletionFixture(),
  );
  await attempt("Operation-rate fixtures could not be reset.", () =>
    resetRateEventsForIdentities(sessionOrder),
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Milestone 5 real-OIDC fixture cleanup failed.",
    );
  }
}

async function cleanupRunMetadata(state: JourneyState) {
  const failures: unknown[] = [];
  await cleanupNewM5IdempotencyRecords(
    state.baselineM5IdempotencyRecordKeys,
  ).catch((error) =>
    failures.push(
      new Error("M5 idempotency residue could not be removed.", {
        cause: error,
      }),
    ),
  );
  await cleanupNewAuditEvents(state.baselineAuditEventIds).catch((error) =>
    failures.push(
      new Error("M5 audit residue could not be removed.", { cause: error }),
    ),
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Milestone 5 real-OIDC metadata cleanup failed.",
    );
  }
}

async function restoreDisposableDeletionIdentity(
  browser: Parameters<typeof attemptDeletedIdentitySignIn>[0],
  state: JourneyState,
  testInfo: TestInfo,
) {
  if (state.deletionRestored) {
    return;
  }
  // The restore is deliberately unconditional. A deletion can commit before
  // Playwright receives or asserts its response, so state flags are evidence,
  // not the authority for fixture recovery.
  await resetDisposableDeletionFixture();
  const restored = await createRealSession(
    browser,
    "deletion",
    testInfo,
    "/settings/privacy",
  );
  try {
    const me = await apiJson<{ email: string }>(restored.page, "GET", "/v1/me");
    expect(me.email).toBe("deletion@autopayguard.local");
    await signOutAndProtect(restored.page, "/settings/privacy");
    state.deletionRestored = true;
  } finally {
    await restored.context.close();
  }
}

async function signOutAll(
  sessions: Partial<Record<RealIdentity, RealSession>>,
  state: JourneyState,
  signedOutIdentities: ReadonlySet<RealIdentity>,
) {
  const protectedPaths: Partial<Record<RealIdentity, string>> = {
    owner: "/household",
    member: "/settings/privacy",
    foreign: "/household",
    guideAdmin: "/admin/guides",
    privacyAdmin: "/admin/privacy",
    auditRead: "/admin/audit",
    supportRead: "/support/diagnostics",
  };
  for (const identity of sessionOrder) {
    if (signedOutIdentities.has(identity)) {
      continue;
    }
    if (identity === "deletion" && state.deletionSignedOut) {
      continue;
    }
    const session = sessions[identity];
    const protectedPath = protectedPaths[identity];
    if (!session || !protectedPath) {
      continue;
    }
    try {
      await session.page.goto(protectedPath);
      await signOutAndProtect(session.page, protectedPath);
    } catch (cause) {
      throw new Error(
        `The ${identity} session could not be signed out safely.`,
        {
          cause,
        },
      );
    }
  }
}

async function signOutIdentityNow(
  sessions: Partial<Record<RealIdentity, RealSession>>,
  identity: RealIdentity,
  protectedPath: string,
) {
  const session = sessions[identity];
  if (!session) {
    throw new Error(`The ${identity} session was not available for sign-out.`);
  }
  try {
    await session.page.goto(protectedPath);
    await signOutAndProtect(session.page, protectedPath);
    await session.context.close();
  } catch (cause) {
    throw new Error(`The ${identity} session could not be signed out safely.`, {
      cause,
    });
  }
}

async function ensurePrivacyReady(
  page: Page,
  requireFreshAcknowledgement: boolean,
) {
  await page.goto("/settings/privacy");
  await expectPrivacyControlsReady(page);
  const acknowledge = page.getByRole("button", {
    name: "Acknowledge this notice",
  });
  if (await acknowledge.isVisible().catch(() => false)) {
    await acknowledge.click();
  } else if (requireFreshAcknowledgement) {
    throw new Error("The disposable privacy fixture was not reset.");
  }
  const grant = page.getByRole("button", { name: "Grant sharing consent" });
  if (await grant.isVisible().catch(() => false)) {
    await grant.click();
  }
  await expect(page.getByText("Sharing is granted")).toBeVisible();
}

async function expectPrivacyControlsReady(page: Page) {
  const heading = page.getByRole("heading", { name: "Privacy controls" });
  try {
    await expect(heading).toBeVisible({ timeout: 15_000 });
  } catch (cause) {
    const resourceState = await page
      .locator(".resource-state")
      .first()
      .innerText()
      .catch(() => "No privacy resource state was rendered.");
    const path = new URL(page.url()).pathname;
    throw new Error(
      `Privacy controls did not become ready at ${path}: ${resourceState.replace(/\s+/g, " ").trim()}`,
      { cause },
    );
  }
}

async function createPrivacyRequestViaUi(
  page: Page,
  buttonName:
    | "Request JSON export"
    | "Request timezone correction"
    | "Request local deletion",
) {
  const button = page.getByRole("button", { name: buttonName });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/bff/v1/privacy/requests"),
  );
  await button.focus();
  await page.keyboard.press("Enter");
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as PrivacyRequest;
  expect(body.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const expectedStatus = {
    "Request JSON export": "Export request created.",
    "Request timezone correction":
      "Timezone correction request created for privacy admin review.",
    "Request local deletion":
      "Local deletion request created for privacy admin review.",
  }[buttonName];
  await expect(
    page.getByRole("status").filter({ hasText: expectedStatus }),
  ).toContainText(expectedStatus);
  return body;
}

async function executePrivacyRequestViaUi(
  page: Page,
  request: PrivacyRequest,
  expectedMessage: string,
  onCommitted?: () => void,
) {
  await page.goto("/admin/privacy");
  await expect(
    page.getByRole("heading", { name: "Privacy request queue" }),
  ).toBeVisible();
  const card = page.locator("article").filter({ hasText: request.id });
  await expect(card).toBeVisible();
  await card
    .getByRole("radio", { name: "Select for conditional execution" })
    .check();
  await page
    .getByLabel(`Type EXECUTE ${request.requestType}`)
    .fill(`EXECUTE ${request.requestType}`);
  const execute = page.getByRole("button", {
    name: "Execute conditional local operation",
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/bff/v1/admin/privacy/requests/${request.id}/execute`),
  );
  await execute.focus();
  await page.keyboard.press("Enter");
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  onCommitted?.();
  await expect(
    page.getByRole("status").filter({ hasText: expectedMessage }),
  ).toContainText(expectedMessage);
}

async function createInvitationViaUi(
  page: Page,
  householdId: string,
  email: string,
) {
  await page.goto(`/household?householdId=${householdId}`);
  await page.getByLabel("Fake local email").fill(email);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/bff/v1/households/${householdId}/invitations`),
  );
  await page.getByRole("button", { name: "Create invitation code" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const created = (await response.json()) as CreatedInvitation;
  expect(created.emailSent).toBe(false);
  expect(created.invitationCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(
    page.getByRole("status").filter({
      hasText: "Invitation created locally. No email was sent.",
    }),
  ).toHaveText("Invitation created locally. No email was sent.");
  await assertSecretAbsentFromStorage(page, created.invitationCode);
  return created;
}

async function createSupportCodeViaUi(page: Page) {
  await page
    .getByRole("checkbox", {
      name: /I authorize temporary read-only redacted diagnostics/,
    })
    .check();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/bff\/v1\/households\/[0-9a-f-]+\/support-codes$/.test(
        new URL(response.url()).pathname,
      ),
  );
  const generate = page.getByRole("button", {
    name: "Generate one-time support code",
  });
  await generate.focus();
  await page.keyboard.press("Enter");
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const created = (await response.json()) as CreatedSupportGrant;
  expect(created.supportCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(
    page.getByRole("status").filter({
      hasText: "Support code created. It is shown only on this page.",
    }),
  ).toContainText("Support code created. It is shown only on this page.");
  await expect(
    page.getByText(
      /This plaintext is not persisted and will disappear when you leave or reload this page\. No email was sent\./,
    ),
  ).toBeVisible();
  return created;
}

async function listFeedback(page: Page) {
  const items: Array<{
    id: string;
    guideId: string;
    guideVersion: number;
    outcome: string;
    disposition: string;
    version: number;
  }> = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const collection: {
      items: typeof items;
      nextCursor: string | null;
    } = await apiJson(
      page,
      "GET",
      `/v1/admin/cancellation-guide-feedback?${query.toString()}`,
    );
    items.push(...collection.items);
    cursor = collection.nextCursor;
    if (!cursor) {
      return items;
    }
  }
  throw new Error("The feedback queue exceeded its bounded page count.");
}

async function listAllAuditEvents(page: Page) {
  const items: Array<Record<string, unknown> & { action: string }> = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const collection: {
      items: Array<Record<string, unknown> & { action: string }>;
      nextCursor: string | null;
    } = await apiJson(
      page,
      "GET",
      `/v1/admin/audit-events?${query.toString()}`,
    );
    items.push(...collection.items);
    cursor = collection.nextCursor;
    if (!cursor) {
      return items;
    }
  }
  throw new Error("The audit queue exceeded its bounded page count.");
}

async function assertSecretAbsentFromStorage(page: Page, secret: string) {
  await expectBrowserStorageEmpty(page);
  const content = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    url: location.href,
  }));
  expect(JSON.stringify(content)).not.toContain(secret);
}

function initialPath(identity: RealIdentity) {
  switch (identity) {
    case "guideAdmin":
      return "/admin/guides";
    case "privacyAdmin":
      return "/admin/privacy";
    case "auditRead":
      return "/admin/audit";
    case "supportRead":
      return "/support/diagnostics";
    case "member":
    case "deletion":
      return "/settings/privacy";
    default:
      return "/household";
  }
}

function alphabeticUuid() {
  return crypto
    .randomUUID()
    .replace(/[0-9]/g, (digit) =>
      String.fromCharCode("q".charCodeAt(0) + Number(digit)),
    );
}
