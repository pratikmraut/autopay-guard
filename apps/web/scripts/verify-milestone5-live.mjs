import { chromium } from "@playwright/test";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const acknowledgement = "I_ACKNOWLEDGE_LOCAL_FAKE_M5_ACCEPTANCE";
const baseUrl = "http://localhost:3000";
const issuer = "http://localhost:8081/realms/autopay-guard";
const execFile = promisify(execFileCallback);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const envFile = join(repositoryRoot, ".env");
const lockPath = join(
  tmpdir(),
  "autopay-guard-milestone5-live-acceptance.lock",
);
const disposableGuideId = "40000000-0000-4000-8000-000000000020";
const disposableOidcSubject = "88888888-8888-4888-8888-888888888888";
const deletionTombstoneHash = createHash("sha256")
  .update(
    `autopay-guard/deletion-tombstone/v1:${disposableOidcSubject}`,
    "utf8",
  )
  .digest("hex");
const expectedUsernames = Object.freeze({
  owner: "demo@autopayguard.local",
  member: "member@autopayguard.local",
  foreign: "foreign@autopayguard.local",
  guideAdmin: "admin@autopayguard.local",
  privacyAdmin: "privacy-admin@autopayguard.local",
  auditRead: "audit-reader@autopayguard.local",
  supportRead: "support@autopayguard.local",
  deletion: "deletion@autopayguard.local",
});
const identityEnvironment = Object.freeze({
  owner: ["KEYCLOAK_FAKE_USER_USERNAME", "KEYCLOAK_FAKE_USER_PASSWORD"],
  member: ["KEYCLOAK_FAKE_MEMBER_USERNAME", "KEYCLOAK_FAKE_MEMBER_PASSWORD"],
  foreign: ["KEYCLOAK_FAKE_FOREIGN_USERNAME", "KEYCLOAK_FAKE_FOREIGN_PASSWORD"],
  guideAdmin: [
    "KEYCLOAK_FAKE_GUIDE_ADMIN_USERNAME",
    "KEYCLOAK_FAKE_GUIDE_ADMIN_PASSWORD",
  ],
  privacyAdmin: [
    "KEYCLOAK_FAKE_PRIVACY_ADMIN_USERNAME",
    "KEYCLOAK_FAKE_PRIVACY_ADMIN_PASSWORD",
  ],
  auditRead: [
    "KEYCLOAK_FAKE_AUDIT_READ_USERNAME",
    "KEYCLOAK_FAKE_AUDIT_READ_PASSWORD",
  ],
  supportRead: [
    "KEYCLOAK_FAKE_SUPPORT_USERNAME",
    "KEYCLOAK_FAKE_SUPPORT_PASSWORD",
  ],
  deletion: [
    "KEYCLOAK_FAKE_DELETION_USERNAME",
    "KEYCLOAK_FAKE_DELETION_PASSWORD",
  ],
});
const canonicalNames = Object.freeze({
  shared: "M2 Fixture StreamBox Demo",
  privateCanary: "M2 Fixture CloudNest Demo",
  fitClub: "M2 Fixture FitClub Demo",
  variable: "M2 Fixture Monsoon Utility Demo",
});
const expectedCanonicalNames = new Set(Object.values(canonicalNames));
const auditKeys = [
  "id",
  "occurredAt",
  "actorRole",
  "action",
  "resourceType",
  "resourceId",
  "outcome",
  "correlationId",
];
const feedbackKeys = [
  "id",
  "guideId",
  "guideVersion",
  "outcome",
  "createdAt",
  "disposition",
  "version",
];

validateEnvironment();
const identities = loadIdentities();
const releaseLock = await acquireLock();
let browser;
const sessions = {};
let household = null;
let ownerOriginalConsent = null;
let memberOriginalConsent = null;
let foreignOriginalConsent = null;
let baselineM5Fixture = null;
let memberOriginalTimezone = null;
let memberTimezoneChanged = false;
let supportGrant = null;
let invitationCode = null;
let supportCode = null;
let localFixtureAdministrationReady = false;
let disposableExportRequestId = null;
let disposableDeletionRequestId = null;
let primaryFailure = null;
const evidence = {
  invitationId: null,
  expiredInvitationId: null,
  memberId: null,
  sharedCommitmentId: null,
  correctionRequestIds: [],
  deletionRequestIds: [],
  exportRequestId: null,
  guideId: disposableGuideId,
  feedbackId: null,
  supportGrantId: null,
  expiredSupportGrantId: null,
  oneTimeCanaries: [],
};

try {
  await assertLocalStackReady();
  await assertLocalComposeAdministration();
  localFixtureAdministrationReady = true;
  await resetDisposableGuideFixture();
  await resetDisposableDeletionFixture();
  browser = await chromium.launch({ headless: true });
  for (const [name, identity] of Object.entries(identities)) {
    sessions[name] = await authenticatedSession(browser, identity);
    sessions[name].me = await assertMe(sessions[name].page, identity.username);
  }

  household = await resolveCanonicalHousehold(sessions.owner.page);
  await restoreCanonicalHousehold(sessions.owner.page, household);
  await assertCanonicalDashboard(sessions.owner.page, household);
  baselineM5Fixture = await captureM5FixtureBaseline(household.id, sessions);

  ownerOriginalConsent = await currentConsent(sessions.owner.page);
  memberOriginalConsent = await currentConsent(sessions.member.page);
  foreignOriginalConsent = await currentConsent(sessions.foreign.page);
  memberOriginalTimezone = (
    await json(await api(sessions.member.page, "GET", "/v1/me"))
  ).timezone;
  await ensureNoticeAndConsent(sessions.owner.page);
  await ensureNoticeAndConsent(sessions.member.page);
  await ensureNoticeAndConsent(sessions.foreign.page);
  await ensureNoticeAndConsent(sessions.deletion.page);

  const mailpitBefore = await mailpitMessageIds();
  const householdResult = await exerciseHouseholdJourney(sessions, household);
  invitationCode = householdResult.invitationCode;
  evidence.invitationId = householdResult.invitationId;
  evidence.expiredInvitationId = householdResult.expiredInvitationId;
  evidence.memberId = householdResult.memberId;
  evidence.sharedCommitmentId = householdResult.sharedCommitmentId;
  evidence.deletionRequestIds.push(householdResult.memberDeletionRequestId);

  const privacyResult = await exercisePrivacyJourneys(
    sessions,
    household,
    memberOriginalTimezone,
  );
  memberTimezoneChanged = privacyResult.memberTimezoneChanged;
  evidence.correctionRequestIds.push(...privacyResult.correctionRequestIds);
  evidence.deletionRequestIds.push(...privacyResult.deletionRequestIds);
  evidence.exportRequestId = privacyResult.exportRequestId;

  const guideResult = await exerciseGuideAndFeedback(sessions, household);
  evidence.feedbackId = guideResult.feedbackId;

  const supportResult = await exerciseSupport(sessions, household);
  supportCode = supportResult.supportCode;
  evidence.supportGrantId = supportResult.grantId;
  evidence.expiredSupportGrantId = supportResult.expiredGrantId;

  await assertNoPlaintextInBrowserStorage(
    Object.values(sessions).map(({ page }) => page),
    [invitationCode, supportCode, ...evidence.oneTimeCanaries],
  );
  await assertNoM5Delivery(mailpitBefore, identities.member.username, [
    invitationCode,
    supportCode,
    ...evidence.oneTimeCanaries,
  ]);
  await assertNoOneTimeSecretInServiceLogs([
    invitationCode,
    supportCode,
    ...evidence.oneTimeCanaries,
  ]);
  await assertRedactedAudit(sessions, evidence, [
    invitationCode,
    supportCode,
    ...evidence.oneTimeCanaries,
  ]);

  invitationCode = null;
  supportCode = null;
  supportGrant = null;
  memberTimezoneChanged = false;
  evidence.oneTimeCanaries.length = 0;
} catch (error) {
  primaryFailure = error;
} finally {
  const cleanupFailures = [];
  if (sessions.owner?.page && household) {
    if (supportGrant) {
      try {
        await revokeSupportGrant(
          sessions.owner.page,
          household.id,
          supportGrant,
          [204, 404, 412],
        );
        supportGrant = null;
      } catch (error) {
        cleanupFailures.push(
          new Error("The temporary support grant could not be revoked.", {
            cause: error,
          }),
        );
      }
    }

    if (
      memberTimezoneChanged &&
      sessions.member?.page &&
      sessions.privacyAdmin?.page &&
      memberOriginalTimezone
    ) {
      try {
        await executeTimezoneCorrection(
          sessions.member.page,
          sessions.privacyAdmin.page,
          memberOriginalTimezone,
        );
        memberTimezoneChanged = false;
      } catch (error) {
        cleanupFailures.push(
          new Error("The member timezone could not be restored.", {
            cause: error,
          }),
        );
      }
    }

    try {
      await restoreCanonicalHousehold(sessions.owner.page, household);
      await restoreConsent(
        sessions.member.page,
        memberOriginalConsent?.currentAction,
      );
      await restoreConsent(
        sessions.owner.page,
        ownerOriginalConsent?.currentAction,
      );
      await restoreConsent(
        sessions.foreign.page,
        foreignOriginalConsent?.currentAction,
      );
      await assertCanonicalDashboard(sessions.owner.page, household);
    } catch (error) {
      cleanupFailures.push(
        new Error("The canonical M5 household cleanup failed.", {
          cause: error,
        }),
      );
    }
  }

  if (localFixtureAdministrationReady) {
    try {
      await resetDisposableGuideFixture();
    } catch (error) {
      cleanupFailures.push(
        new Error("The disposable guide fixture could not be reset.", {
          cause: error,
        }),
      );
    }
    try {
      await cleanupDisposablePrivacyRequest(disposableExportRequestId);
      await cleanupDisposablePrivacyRequest(disposableDeletionRequestId);
      await cleanupDisposableSubjectPrivacyState();
      await resetDisposableDeletionFixture();
      if (sessions.deletion?.page) {
        await assertMe(sessions.deletion.page, identities.deletion.username);
      }
    } catch (error) {
      cleanupFailures.push(
        new Error("The disposable deletion identity could not be reset.", {
          cause: error,
        }),
      );
    }
    if (household?.id && baselineM5Fixture) {
      try {
        await restoreM5FixtureBaseline(household.id, baselineM5Fixture);
      } catch (error) {
        cleanupFailures.push(
          new Error("The canonical M5 fixture residue could not be removed.", {
            cause: error,
          }),
        );
      }
    }
  }

  invitationCode = null;
  supportCode = null;
  for (const session of Object.values(sessions)) {
    await session.context.close().catch((error) => cleanupFailures.push(error));
  }
  await browser?.close().catch((error) => cleanupFailures.push(error));
  await releaseLock().catch((error) => cleanupFailures.push(error));
  if (primaryFailure || cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures].filter(Boolean),
      "Milestone 5 guarded live acceptance failed.",
    );
  }
}

console.log(
  "Milestone 5 guarded live acceptance passed for fake-local household sharing/consent suspension, canonical export download/expiry/purge, correction, blocked and successful resettable deletion, guide draft/publish/retire/reactivation, redacted feedback/support/audit, exact staff-role isolation, stale ETags, and deterministic fixture cleanup.",
);

async function exerciseHouseholdJourney(activeSessions, selectedHousehold) {
  const ownerPage = activeSessions.owner.page;
  const memberPage = activeSessions.member.page;
  const foreignPage = activeSessions.foreign.page;
  const privacyAdminPage = activeSessions.privacyAdmin.page;
  const commitments = await listCommitments(
    ownerPage,
    selectedHousehold.id,
    false,
  );
  const shared = uniqueNamedCommitment(commitments, canonicalNames.shared);
  const privateCanary = uniqueNamedCommitment(
    commitments,
    canonicalNames.privateCanary,
  );

  const invitationResponse = await api(
    ownerPage,
    "POST",
    `/v1/households/${selectedHousehold.id}/invitations`,
    {
      expectedStatus: 201,
      data: { inviteeEmail: identities.member.username },
    },
  );
  const created = await json(invitationResponse);
  if (
    created.emailSent !== false ||
    !created.invitation ||
    created.invitation.status !== "PENDING" ||
    created.invitation.inviteeEmail !== identities.member.username ||
    !/^[A-Za-z0-9_-]{43}$/.test(created.invitationCode)
  ) {
    throw new Error(
      "The fake-local invitation did not return one bounded manual code.",
    );
  }
  const lifetime =
    Date.parse(created.invitation.expiresAt) -
    Date.parse(created.invitation.createdAt);
  if (Math.abs(lifetime - 24 * 60 * 60 * 1_000) > 1_000) {
    throw new Error("The invitation does not have an exact 24-hour lifetime.");
  }
  let oneTimeCode = created.invitationCode;
  const invitationId = created.invitation.id;
  const invitationDigest = sha256Hex(oneTimeCode);
  evidence.oneTimeCanaries.push(oneTimeCode, invitationDigest);
  await assertInvitationSecretStorage(
    invitationId,
    oneTimeCode,
    invitationDigest,
  );
  if (
    JSON.stringify(created.invitation).includes(oneTimeCode) ||
    invitationResponse.url().includes(oneTimeCode)
  ) {
    throw new Error(
      "Invitation plaintext leaked into a persistent read shape.",
    );
  }

  await api(
    ownerPage,
    "POST",
    `/v1/households/${selectedHousehold.id}/invitations`,
    {
      expectedStatus: 400,
      headers: { "idempotency-key": idempotencyKey("forbidden-invite") },
      data: { inviteeEmail: identities.member.username },
    },
  );
  await api(foreignPage, "POST", "/v1/household-invitations/accept", {
    expectedStatus: 404,
    headers: { "idempotency-key": idempotencyKey("foreign-invite") },
    data: { invitationCode: oneTimeCode },
  });

  const incoming = await json(
    await api(memberPage, "GET", "/v1/household-invitations"),
  );
  if (
    incoming.items?.filter(({ id }) => id === invitationId).length !== 1 ||
    JSON.stringify(incoming).includes(oneTimeCode)
  ) {
    throw new Error(
      "The intended member did not receive exactly one redacted invitation.",
    );
  }

  const acceptanceKey = idempotencyKey("m5-invitation-accept");
  const acceptedResponse = await api(
    memberPage,
    "POST",
    "/v1/household-invitations/accept",
    {
      expectedStatus: 200,
      headers: { "idempotency-key": acceptanceKey },
      data: { invitationCode: oneTimeCode },
    },
  );
  const accepted = await json(acceptedResponse);
  const memberEtag = assertVersionAndEtag(
    acceptedResponse,
    accepted,
    "invitation acceptance",
  );
  if (
    accepted.role !== "MEMBER" ||
    accepted.status !== "ACTIVE" ||
    accepted.userId === selectedHousehold.ownerUserId
  ) {
    throw new Error("Invitation acceptance did not create an active member.");
  }
  const replay = await json(
    await api(memberPage, "POST", "/v1/household-invitations/accept", {
      expectedStatus: 200,
      headers: { "idempotency-key": acceptanceKey },
      data: { invitationCode: oneTimeCode },
    }),
  );
  if (JSON.stringify(replay) !== JSON.stringify(accepted)) {
    throw new Error("Invitation acceptance replay was not stable.");
  }

  const sharedCurrent = await commitment(ownerPage, shared.id);
  const sharedResponse = await api(
    ownerPage,
    "PATCH",
    `/v1/commitments/${shared.id}/sharing`,
    {
      headers: { "if-match": sharedCurrent.etag },
      data: {
        visibility: "HOUSEHOLD",
        responsibleMemberId: accepted.id,
      },
    },
  );
  const sharedBody = await json(sharedResponse);
  if (
    sharedBody.visibility !== "HOUSEHOLD" ||
    sharedBody.responsibleMemberId !== accepted.id ||
    sharedBody.canManage !== true
  ) {
    throw new Error(
      "Owner sharing did not retain the non-authoritative responsibility label.",
    );
  }
  assertVersionAndEtag(sharedResponse, sharedBody, "commitment sharing");
  await api(ownerPage, "PATCH", `/v1/commitments/${shared.id}/sharing`, {
    expectedStatus: 412,
    headers: { "if-match": sharedCurrent.etag },
    data: { visibility: "PRIVATE", responsibleMemberId: null },
  });

  await assertMemberIsolation(
    memberPage,
    selectedHousehold,
    sharedBody,
    privateCanary,
  );
  await api(memberPage, "PATCH", `/v1/commitments/${shared.id}/sharing`, {
    expectedStatus: 404,
    headers: { "if-match": `"${sharedBody.version}"` },
    data: { visibility: "PRIVATE", responsibleMemberId: null },
  });
  await api(memberPage, "DELETE", `/v1/commitments/${shared.id}`, {
    expectedStatus: 404,
    headers: { "if-match": `"${sharedBody.version}"` },
  });
  await api(foreignPage, "GET", `/v1/commitments/${shared.id}`, {
    expectedStatus: 404,
  });
  const foreignHouseholds = await json(
    await api(foreignPage, "GET", "/v1/households"),
  );
  if (foreignHouseholds.items?.length !== 0) {
    throw new Error("The foreign fake user enumerated a household.");
  }

  await setConsent(memberPage, "WITHDRAWN");
  await api(memberPage, "GET", `/v1/commitments/${shared.id}`, {
    expectedStatus: 404,
  });
  await setConsent(memberPage, "GRANTED");
  await api(memberPage, "GET", `/v1/commitments/${shared.id}`);

  const suspendedInvitationResponse = await api(
    ownerPage,
    "POST",
    `/v1/households/${selectedHousehold.id}/invitations`,
    {
      expectedStatus: 201,
      data: { inviteeEmail: identities.foreign.username },
    },
  );
  const suspendedInvitation = await json(suspendedInvitationResponse);
  let suspendedCode = suspendedInvitation.invitationCode;
  if (
    suspendedInvitation.emailSent !== false ||
    !/^[A-Za-z0-9_-]{43}$/.test(suspendedCode)
  ) {
    throw new Error(
      "The consent-suspension invitation did not remain manual and fake-local.",
    );
  }
  const suspendedDigest = sha256Hex(suspendedCode);
  evidence.oneTimeCanaries.push(suspendedCode, suspendedDigest);
  await assertInvitationSecretStorage(
    suspendedInvitation.invitation.id,
    suspendedCode,
    suspendedDigest,
  );
  suspendedInvitation.invitationCode = null;

  await setConsent(ownerPage, "WITHDRAWN");
  await api(memberPage, "GET", `/v1/commitments/${shared.id}`, {
    expectedStatus: 404,
  });
  const suspendedIncoming = await json(
    await api(foreignPage, "GET", "/v1/household-invitations"),
  );
  if (
    suspendedIncoming.items?.some(
      ({ id }) => id === suspendedInvitation.invitation.id,
    )
  ) {
    throw new Error(
      "Owner consent withdrawal did not suspend the pending invitation.",
    );
  }
  await api(
    ownerPage,
    "POST",
    `/v1/households/${selectedHousehold.id}/invitations`,
    {
      expectedStatus: 409,
      data: { inviteeEmail: identities.foreign.username },
    },
  );
  await setConsent(ownerPage, "GRANTED");
  await api(memberPage, "GET", `/v1/commitments/${shared.id}`);
  const restoredIncoming = await json(
    await api(foreignPage, "GET", "/v1/household-invitations"),
  );
  if (
    restoredIncoming.items?.filter(
      ({ id }) => id === suspendedInvitation.invitation.id,
    ).length !== 1 ||
    JSON.stringify(restoredIncoming).includes(suspendedCode)
  ) {
    throw new Error(
      "Owner consent regrant did not restore one redacted pending invitation.",
    );
  }
  await api(
    ownerPage,
    "DELETE",
    `/v1/households/${selectedHousehold.id}/invitations/${suspendedInvitation.invitation.id}`,
    {
      expectedStatus: 204,
      headers: {
        "if-match": `"${suspendedInvitation.invitation.version}"`,
      },
    },
  );
  suspendedCode = null;

  const expiringInvitationResponse = await api(
    ownerPage,
    "POST",
    `/v1/households/${selectedHousehold.id}/invitations`,
    {
      expectedStatus: 201,
      data: { inviteeEmail: identities.foreign.username },
    },
  );
  const expiringInvitation = await json(expiringInvitationResponse);
  let expiringCode = expiringInvitation.invitationCode;
  if (
    expiringInvitation.emailSent !== false ||
    !expiringInvitation.invitation ||
    expiringInvitation.invitation.status !== "PENDING" ||
    !/^[A-Za-z0-9_-]{43}$/.test(expiringCode)
  ) {
    throw new Error(
      "The invitation-expiry fixture did not return one bounded manual code.",
    );
  }
  const expiringDigest = sha256Hex(expiringCode);
  evidence.oneTimeCanaries.push(expiringCode, expiringDigest);
  await assertInvitationSecretStorage(
    expiringInvitation.invitation.id,
    expiringCode,
    expiringDigest,
  );
  expiringInvitation.invitationCode = null;
  await backdateInvitationToExpiryBoundary(expiringInvitation.invitation.id);

  const expiredIncoming = await json(
    await api(foreignPage, "GET", "/v1/household-invitations"),
  );
  if (
    expiredIncoming.items?.some(
      ({ id }) => id === expiringInvitation.invitation.id,
    )
  ) {
    throw new Error(
      "An invitation remained visible at its exact 24-hour boundary.",
    );
  }
  const ownerInvitations = await json(
    await api(
      ownerPage,
      "GET",
      `/v1/households/${selectedHousehold.id}/invitations`,
    ),
  );
  const expiredInvitation = ownerInvitations.items?.find(
    ({ id }) => id === expiringInvitation.invitation.id,
  );
  if (
    expiredInvitation?.status !== "EXPIRED" ||
    expiredInvitation.version !== expiringInvitation.invitation.version + 1
  ) {
    throw new Error(
      "The exact 24-hour invitation boundary did not persist one EXPIRED transition.",
    );
  }
  await api(foreignPage, "POST", "/v1/household-invitations/accept", {
    expectedStatus: 404,
    headers: {
      "idempotency-key": idempotencyKey("expired-invitation-accept"),
    },
    data: { invitationCode: expiringCode },
  });
  await api(
    ownerPage,
    "DELETE",
    `/v1/households/${selectedHousehold.id}/invitations/${expiredInvitation.id}`,
    {
      expectedStatus: 412,
      headers: { "if-match": `"${expiredInvitation.version}"` },
    },
  );
  expiringCode = null;

  const memberDeletion = await createPrivacyRequest(
    memberPage,
    "DELETION",
    null,
  );
  const blockedMemberDeletion = await executePrivacyRequest(
    privacyAdminPage,
    memberDeletion,
  );
  if (blockedMemberDeletion.status !== "BLOCKED") {
    throw new Error(
      "Deletion was not blocked while the subject had a multi-member household.",
    );
  }

  await api(
    ownerPage,
    "DELETE",
    `/v1/households/${selectedHousehold.id}/members/${accepted.id}`,
    {
      expectedStatus: 412,
      headers: { "if-match": `"${accepted.version + 99}"` },
    },
  );
  await api(
    ownerPage,
    "DELETE",
    `/v1/households/${selectedHousehold.id}/members/${accepted.id}`,
    {
      expectedStatus: 204,
      headers: { "if-match": memberEtag },
    },
  );
  await api(memberPage, "GET", `/v1/commitments/${shared.id}`, {
    expectedStatus: 404,
  });
  const afterRemoval = await commitment(ownerPage, shared.id);
  if (afterRemoval.body.responsibleMemberId !== null) {
    throw new Error("Member removal did not atomically clear responsibility.");
  }

  const returnedInvitationCode = oneTimeCode;
  created.invitationCode = null;
  oneTimeCode = null;
  return {
    invitationCode: returnedInvitationCode,
    invitationId,
    expiredInvitationId: expiredInvitation.id,
    memberId: accepted.id,
    sharedCommitmentId: shared.id,
    memberDeletionRequestId: blockedMemberDeletion.id,
  };
}

async function assertMemberIsolation(
  memberPage,
  selectedHousehold,
  shared,
  privateCanary,
) {
  const listed = await listCommitments(memberPage, selectedHousehold.id, false);
  if (
    listed.length !== 1 ||
    listed[0].id !== shared.id ||
    listed[0].canManage !== false
  ) {
    throw new Error(
      "The member commitment list was not limited to one shared read-only row.",
    );
  }
  const listedText = JSON.stringify(listed);
  if (
    listedText.includes(privateCanary.id) ||
    listedText.includes(privateCanary.displayName) ||
    listedText.includes(String(privateCanary.amountMinor))
  ) {
    throw new Error(
      "A private commitment canary leaked through the member list.",
    );
  }
  const direct = await json(
    await api(memberPage, "GET", `/v1/commitments/${shared.id}`),
  );
  if (direct.id !== shared.id || direct.canManage !== false) {
    throw new Error("The member direct read was not read-only.");
  }
  await api(memberPage, "GET", `/v1/commitments/${privateCanary.id}`, {
    expectedStatus: 404,
  });

  const month = localDateInTimeZone(selectedHousehold.timezone).slice(0, 7);
  const query = new URLSearchParams({
    householdId: selectedHousehold.id,
    month,
  });
  const summary = await json(
    await api(memberPage, "GET", `/v1/dashboard/summary?${query.toString()}`),
  );
  if (
    summary.activeCommitmentCount !== 1 ||
    JSON.stringify(summary).includes(privateCanary.id) ||
    JSON.stringify(summary).includes(privateCanary.displayName)
  ) {
    throw new Error(
      "Member dashboard aggregates were not limited to visible records.",
    );
  }
}

async function exercisePrivacyJourneys(
  activeSessions,
  selectedHousehold,
  originalTimezone,
) {
  const ownerPage = activeSessions.owner.page;
  const memberPage = activeSessions.member.page;
  const deletionPage = activeSessions.deletion.page;
  const privacyAdminPage = activeSessions.privacyAdmin.page;
  const correctionRequestIds = [];
  const deletionRequestIds = [];

  const alternateTimezone = originalTimezone === "UTC" ? "Asia/Kolkata" : "UTC";
  const correction = await createPrivacyRequest(
    memberPage,
    "CORRECTION",
    alternateTimezone,
  );
  correctionRequestIds.push(correction.id);
  await api(
    privacyAdminPage,
    "POST",
    `/v1/admin/privacy/requests/${correction.id}/execute`,
    {
      expectedStatus: 412,
      headers: {
        "if-match": `"${correction.version + 99}"`,
        "idempotency-key": idempotencyKey("m5-stale-correction"),
      },
    },
  );
  await api(
    ownerPage,
    "POST",
    `/v1/admin/privacy/requests/${correction.id}/execute`,
    {
      expectedStatus: 403,
      headers: {
        "if-match": `"${correction.version}"`,
        "idempotency-key": idempotencyKey("m5-user-correction"),
      },
    },
  );
  memberTimezoneChanged = true;
  const executedCorrection = await executePrivacyRequest(
    privacyAdminPage,
    correction,
  );
  if (
    executedCorrection.status !== "EXECUTED" ||
    executedCorrection.correctionField !== "TIMEZONE" ||
    executedCorrection.correctionValue !== alternateTimezone
  ) {
    throw new Error(
      "The privacy administrator did not execute the bounded timezone correction.",
    );
  }
  const correctedMe = await json(await api(memberPage, "GET", "/v1/me"));
  if (correctedMe.timezone !== alternateTimezone) {
    throw new Error("The correction did not update only the app timezone.");
  }

  const restored = await executeTimezoneCorrection(
    memberPage,
    privacyAdminPage,
    originalTimezone,
  );
  correctionRequestIds.push(restored.id);
  const restoredMe = await json(await api(memberPage, "GET", "/v1/me"));
  if (restoredMe.timezone !== originalTimezone) {
    throw new Error(
      "The live correction journey did not restore the original timezone.",
    );
  }
  memberTimezoneChanged = false;

  const protectedDeletion = await createPrivacyRequest(
    ownerPage,
    "DELETION",
    null,
  );
  const blockedProtected = await executePrivacyRequest(
    privacyAdminPage,
    protectedDeletion,
  );
  deletionRequestIds.push(blockedProtected.id);
  if (blockedProtected.status !== "BLOCKED") {
    throw new Error("The canonical demo deletion was not server-blocked.");
  }
  const ownerMe = await json(await api(ownerPage, "GET", "/v1/me"));
  if (ownerMe.email !== identities.owner.username) {
    throw new Error(
      "The protected canonical identity changed during deletion denial.",
    );
  }
  const stillOwned = await resolveCanonicalHousehold(ownerPage);
  if (stillOwned.id !== selectedHousehold.id) {
    throw new Error("The protected deletion changed the canonical household.");
  }

  const disposableMe = await json(await api(deletionPage, "GET", "/v1/me"));
  const exportRequest = await createAndExpireExport(
    activeSessions,
    disposableMe.id,
  );

  const disposableDeletion = await createPrivacyRequest(
    deletionPage,
    "DELETION",
    null,
  );
  disposableDeletionRequestId = disposableDeletion.id;
  deletionRequestIds.push(disposableDeletion.id);
  const executedDeletion = await executePrivacyRequest(
    privacyAdminPage,
    disposableDeletion,
  );
  if (executedDeletion.status !== "EXECUTED") {
    throw new Error("The resettable disposable fake identity was not deleted.");
  }
  await api(deletionPage, "GET", "/v1/me", { expectedStatus: 403 });
  await assertDisposableDeletionDatabaseState(
    disposableMe.id,
    exportRequest.id,
  );

  await api(
    activeSessions.guideAdmin.page,
    "GET",
    "/v1/admin/privacy/requests",
    { expectedStatus: 403 },
  );
  await api(
    activeSessions.auditRead.page,
    "GET",
    "/v1/admin/privacy/requests",
    { expectedStatus: 403 },
  );
  await api(
    activeSessions.supportRead.page,
    "GET",
    "/v1/admin/privacy/requests",
    { expectedStatus: 403 },
  );

  return {
    correctionRequestIds,
    deletionRequestIds,
    exportRequestId: exportRequest.id,
    memberTimezoneChanged: false,
  };
}

async function createAndExpireExport(activeSessions, disposableUserId) {
  const deletionPage = activeSessions.deletion.page;
  const response = await api(deletionPage, "POST", "/v1/privacy/requests", {
    expectedStatus: 201,
    headers: {
      "idempotency-key": idempotencyKey("m5-export"),
    },
    data: { requestType: "EXPORT" },
  });
  assertNoStore(response, "privacy export creation");
  const request = await json(response);
  disposableExportRequestId = request.id;
  if (
    request.requestType !== "EXPORT" ||
    request.status !== "READY" ||
    !request.export ||
    request.export.schemaVersion !== "autopay-guard-export-v1" ||
    !/^[a-f0-9]{64}$/.test(request.export.sha256) ||
    !Number.isSafeInteger(request.export.byteCount) ||
    request.export.byteCount < 2 ||
    request.export.byteCount > 5 * 1024 * 1024
  ) {
    throw new Error("The disposable canonical JSON export was not ready.");
  }
  assertVersionAndEtag(response, request, "privacy export creation");

  const path = `/v1/privacy/requests/${request.id}/export`;
  const download = await api(deletionPage, "GET", path);
  assertNoStore(download, "privacy export download");
  const bytes = await download.body();
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    download.headers()["content-type"]?.split(";", 1)[0] !==
      "application/json" ||
    download.headers()["content-disposition"] !==
      'attachment; filename="autopay-guard-export-v1.json"' ||
    download.headers()["x-content-sha256"] !== digest ||
    digest !== request.export.sha256 ||
    bytes.byteLength !== request.export.byteCount
  ) {
    throw new Error(
      "The subject export bytes, headers, length, and digest did not agree.",
    );
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    text.charCodeAt(0) === 0xfeff ||
    JSON.stringify(JSON.parse(text)) !== text
  ) {
    throw new Error(
      "The export was not compact canonical UTF-8 JSON without a BOM.",
    );
  }
  const payload = JSON.parse(text);
  assertExactKeys(
    payload,
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
    ],
    "canonical export manifest",
  );
  if (
    payload.schemaVersion !== "autopay-guard-export-v1" ||
    !keysAreRecursivelySorted(payload)
  ) {
    throw new Error(
      "The export manifest did not use lexicographically ordered object keys.",
    );
  }
  const exportText = text.toLowerCase();
  for (const forbidden of [
    "access_token",
    "refresh_token",
    "password",
    "token_hash",
    "code_hash",
    "idempotency",
    "raw_failure",
  ]) {
    if (exportText.includes(forbidden)) {
      throw new Error("The export contained a forbidden secret field.");
    }
  }

  for (const page of [activeSessions.owner.page, activeSessions.foreign.page]) {
    await api(page, "GET", path, { expectedStatus: 404 });
  }
  for (const page of [
    activeSessions.guideAdmin.page,
    activeSessions.privacyAdmin.page,
    activeSessions.auditRead.page,
    activeSessions.supportRead.page,
  ]) {
    await api(page, "GET", path, { expectedStatus: 403 });
  }

  await backdateExportArtifact(request.id);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_200));
  await api(deletionPage, "GET", "/v1/privacy/requests");
  const expired = await json(
    await api(deletionPage, "GET", `/v1/privacy/requests/${request.id}`),
  );
  const expiredAt = Date.parse(expired.export?.expiresAt ?? "");
  if (
    expired.status !== "EXPIRED" ||
    !expired.export ||
    expired.export.schemaVersion !== request.export.schemaVersion ||
    expired.export.sha256 !== request.export.sha256 ||
    expired.export.byteCount !== request.export.byteCount ||
    expired.export.generatedAt !== request.export.generatedAt ||
    !Number.isFinite(expiredAt) ||
    expiredAt > Date.now()
  ) {
    throw new Error(
      "The locally expired export did not retain only its safe metadata.",
    );
  }
  assertExactKeys(
    expired.export,
    ["schemaVersion", "sha256", "byteCount", "generatedAt", "expiresAt"],
    "expired export metadata",
  );
  await api(deletionPage, "GET", path, { expectedStatus: 410 });
  const databaseState = await postgresScalar(
    `
      SELECT
        r.status || '|' ||
        (a.payload IS NULL)::text || '|' ||
        (a.purged_at IS NOT NULL)::text
      FROM privacy_requests r
      JOIN privacy_export_artifacts a ON a.request_id = r.id
      WHERE r.id = :'request_id'::uuid
        AND r.requester_user_id = :'user_id'::uuid
    `,
    { request_id: request.id, user_id: disposableUserId },
  );
  if (databaseState !== "EXPIRED|true|true") {
    throw new Error(
      "PostgreSQL retained export payload bytes after local expiry.",
    );
  }
  return request;
}

function keysAreRecursivelySorted(value) {
  if (Array.isArray(value)) {
    return value.every(keysAreRecursivelySorted);
  }
  if (!value || typeof value !== "object") {
    return true;
  }
  const keys = Object.keys(value);
  if (keys.join("\u0000") !== [...keys].sort().join("\u0000")) {
    return false;
  }
  return keys.every((key) => keysAreRecursivelySorted(value[key]));
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function assertInvitationSecretStorage(
  invitationId,
  plaintext,
  expectedDigest,
) {
  requireUuid(invitationId, "invitation");
  const state = await postgresScalar(
    `
      SELECT
        (i.token_hash = :'expected_digest')::text || '|' ||
        (position(:'plaintext' in row_to_json(i)::text) = 0)::text
      FROM household_invitations i
      WHERE i.id = :'invitation_id'::uuid
    `,
    {
      invitation_id: invitationId,
      plaintext,
      expected_digest: expectedDigest,
    },
  );
  if (state !== "true|true") {
    throw new Error(
      "An invitation did not persist exactly its digest-only one-time secret.",
    );
  }
}

async function assertSupportSecretStorage(grantId, plaintext, expectedDigest) {
  requireUuid(grantId, "support grant");
  const state = await postgresScalar(
    `
      SELECT
        (g.code_hash = :'expected_digest')::text || '|' ||
        (position(:'plaintext' in row_to_json(g)::text) = 0)::text
      FROM support_diagnostic_grants g
      WHERE g.id = :'grant_id'::uuid
    `,
    {
      grant_id: grantId,
      plaintext,
      expected_digest: expectedDigest,
    },
  );
  if (state !== "true|true") {
    throw new Error(
      "A support grant did not persist exactly its digest-only one-time secret.",
    );
  }
}

async function backdateInvitationToExpiryBoundary(invitationId) {
  requireUuid(invitationId, "invitation");
  const changed = await postgresScalar(
    `
      WITH boundary AS (
        SELECT clock_timestamp() AS expires_at
      ),
      changed AS (
        UPDATE household_invitations i
        SET created_at = boundary.expires_at - INTERVAL '1 day',
            expires_at = boundary.expires_at,
            updated_at = boundary.expires_at - INTERVAL '1 day'
        FROM boundary
        WHERE i.id = :'invitation_id'::uuid
          AND i.status = 'PENDING'
        RETURNING i.id
      )
      SELECT COUNT(*) FROM changed
    `,
    { invitation_id: invitationId },
  );
  if (changed !== "1") {
    throw new Error(
      "The known disposable invitation could not be advanced to its exact expiry boundary.",
    );
  }
}

async function backdateSupportGrantToExpiryBoundary(grantId) {
  requireUuid(grantId, "support grant");
  const changed = await postgresScalar(
    `
      WITH boundary AS (
        SELECT clock_timestamp() AS expires_at
      ),
      changed AS (
        UPDATE support_diagnostic_grants g
        SET created_at = boundary.expires_at - INTERVAL '15 minutes',
            expires_at = boundary.expires_at,
            updated_at = boundary.expires_at - INTERVAL '15 minutes'
        FROM boundary
        WHERE g.id = :'grant_id'::uuid
          AND g.status = 'ACTIVE'
        RETURNING g.id
      )
      SELECT COUNT(*) FROM changed
    `,
    { grant_id: grantId },
  );
  if (changed !== "1") {
    throw new Error(
      "The known disposable support grant could not be advanced to its expiry boundary.",
    );
  }
}

async function assertExpiredSupportGrant(grantId) {
  requireUuid(grantId, "support grant");
  const state = await postgresScalar(
    `
      SELECT
        status || '|' ||
        optimistic_version || '|' ||
        (active_key IS NULL)::text
      FROM support_diagnostic_grants
      WHERE id = :'grant_id'::uuid
    `,
    { grant_id: grantId },
  );
  if (state !== "EXPIRED|1|true") {
    throw new Error(
      "The support grant did not persist one safe EXPIRED transition.",
    );
  }
}

async function backdateExportArtifact(requestId) {
  requireUuid(requestId, "export request");
  const changed = await postgresScalar(
    `
      WITH changed AS (
        UPDATE privacy_export_artifacts
        SET expires_at = generated_at + INTERVAL '1 second'
        WHERE request_id = :'request_id'::uuid
          AND payload IS NOT NULL
          AND purged_at IS NULL
        RETURNING request_id
      )
      SELECT COUNT(*) FROM changed
    `,
    { request_id: requestId },
  );
  if (changed !== "1") {
    throw new Error("The known disposable export could not be backdated.");
  }
}

async function assertDisposableDeletionDatabaseState(
  deletedUserId,
  exportRequestId,
) {
  requireUuid(deletedUserId, "disposable user");
  requireUuid(exportRequestId, "export request");
  const state = await postgresScalar(
    `
      SELECT
        (SELECT COUNT(*) FROM users WHERE id = :'user_id'::uuid) || '|' ||
        (
          SELECT COUNT(*) FROM deletion_tombstones
          WHERE subject_hash = :'subject_hash'
        ) || '|' ||
        (
          SELECT COUNT(*) FROM privacy_export_artifacts
          WHERE request_id = :'request_id'::uuid
        )
    `,
    {
      user_id: deletedUserId,
      subject_hash: deletionTombstoneHash,
      request_id: exportRequestId,
    },
  );
  if (state !== "0|1|0") {
    throw new Error(
      "Disposable deletion did not remove the app user/export and retain exactly one tombstone.",
    );
  }
}

async function cleanupDisposablePrivacyRequest(requestId) {
  if (!requestId) {
    return;
  }
  requireUuid(requestId, "disposable privacy request");
  await postgresExecute(
    `
      BEGIN;

      DELETE FROM privacy_export_artifacts
      WHERE request_id = :'request_id'::uuid;

      DELETE FROM privacy_request_event_locks
      WHERE request_id = :'request_id'::uuid;

      DELETE FROM privacy_request_events
      WHERE request_id = :'request_id'::uuid;

      DELETE FROM privacy_requests
      WHERE id = :'request_id'::uuid;

      COMMIT;
    `,
    { request_id: requestId },
  );
}

async function cleanupDisposableSubjectPrivacyState() {
  const state = await postgresScalar(
    `
      BEGIN;

      CREATE TEMP TABLE m5_cleanup_privacy_requests
      ON COMMIT DROP
      AS
      SELECT r.id
      FROM privacy_requests r
      JOIN users u ON u.id = r.requester_user_id
      WHERE u.oidc_subject = :'oidc_subject';

      DELETE FROM audit_event_locks
      WHERE id IN (
        SELECT a.id
        FROM audit_events a
        JOIN m5_cleanup_privacy_requests r
          ON a.resource_type = 'PRIVACY_REQUEST'
         AND a.resource_id = r.id
      );

      DELETE FROM audit_events
      WHERE resource_type = 'PRIVACY_REQUEST'
        AND resource_id IN (
          SELECT id FROM m5_cleanup_privacy_requests
        );

      DELETE FROM m5_idempotency_records
      WHERE resource_id IN (
        SELECT id FROM m5_cleanup_privacy_requests
      );

      DELETE FROM privacy_export_artifacts
      WHERE request_id IN (
        SELECT id FROM m5_cleanup_privacy_requests
      );

      DELETE FROM privacy_request_event_locks
      WHERE request_id IN (
        SELECT id FROM m5_cleanup_privacy_requests
      );

      DELETE FROM privacy_request_events
      WHERE request_id IN (
        SELECT id FROM m5_cleanup_privacy_requests
      );

      DELETE FROM privacy_requests
      WHERE id IN (
        SELECT id FROM m5_cleanup_privacy_requests
      );

      COMMIT;

      SELECT
        (
          SELECT COUNT(*)
          FROM privacy_requests r
          JOIN users u ON u.id = r.requester_user_id
          WHERE u.oidc_subject = :'oidc_subject'
        ) || '|' ||
        (
          SELECT COUNT(*)
          FROM privacy_export_artifacts a
          JOIN users u ON u.id = a.requester_user_id
          WHERE u.oidc_subject = :'oidc_subject'
        );
    `,
    { oidc_subject: disposableOidcSubject },
  );
  if (state !== "0|0") {
    throw new Error(
      "Disposable-subject privacy requests or artifacts survived cleanup.",
    );
  }
}

async function captureM5FixtureBaseline(householdId, activeSessions) {
  requireUuid(householdId, "M5 baseline household");
  const userIds = Object.values(activeSessions).map(({ me }) => {
    requireUuid(me?.id, "M5 baseline user");
    return me.id;
  });
  const userVariables = {};
  const userParameters = bindUuidParameters(
    userIds,
    "capture_user",
    userVariables,
  );
  const actorKeys = [];
  for (const [index, userId] of userIds.entries()) {
    const subject = await postgresScalar(
      "SELECT oidc_subject FROM users WHERE id = :'user_id'::uuid",
      { user_id: userId },
    );
    if (!subject) {
      throw new Error(`The M5 baseline user ${index + 1} has no OIDC subject.`);
    }
    actorKeys.push(sha256Hex(`autopay-guard/operation-rate/v1:${subject}`));
  }
  const actorVariables = {};
  const actorParameters = bindTextParameters(
    actorKeys,
    "capture_actor",
    actorVariables,
    /^[0-9a-f]{64}$/,
    "M5 rate actor",
  );
  const householdVariables = { household_id: householdId };

  return {
    userIds,
    actorKeys,
    invitationIds: await uuidRows(
      `
        SELECT id
        FROM household_invitations
        WHERE household_id = :'household_id'::uuid
        ORDER BY id
      `,
      householdVariables,
      "M5 baseline invitation",
    ),
    memberIds: await uuidRows(
      `
        SELECT id
        FROM household_members
        WHERE household_id = :'household_id'::uuid
        ORDER BY id
      `,
      householdVariables,
      "M5 baseline member",
    ),
    privacyRequestIds: await uuidRows(
      `
        SELECT id
        FROM privacy_requests
        WHERE requester_user_id IN (${userParameters})
        ORDER BY id
      `,
      userVariables,
      "M5 baseline privacy request",
    ),
    feedbackIds: await uuidRows(
      `
        SELECT id
        FROM cancellation_guide_feedback
        WHERE household_id = :'household_id'::uuid
        ORDER BY id
      `,
      householdVariables,
      "M5 baseline feedback",
    ),
    supportGrantIds: await uuidRows(
      `
        SELECT id
        FROM support_diagnostic_grants
        WHERE household_id = :'household_id'::uuid
        ORDER BY id
      `,
      householdVariables,
      "M5 baseline support grant",
    ),
    noticeAcknowledgementIds: await uuidRows(
      `
        SELECT id
        FROM privacy_notice_acknowledgements
        WHERE user_id IN (${userParameters})
        ORDER BY id
      `,
      userVariables,
      "M5 baseline notice acknowledgement",
    ),
    consentEventIds: await uuidRows(
      `
        SELECT id
        FROM consent_events
        WHERE user_id IN (${userParameters})
        ORDER BY id
      `,
      userVariables,
      "M5 baseline consent event",
    ),
    auditEventIds: await uuidRows(
      `
        SELECT id
        FROM audit_events
        WHERE actor_user_id IN (${userParameters})
        ORDER BY id
      `,
      userVariables,
      "M5 baseline audit event",
    ),
    rateEventIds: await uuidRows(
      `
        SELECT id
        FROM operation_rate_events
        WHERE actor_key IN (${actorParameters})
        ORDER BY id
      `,
      actorVariables,
      "M5 baseline rate event",
    ),
    m5IdempotencyKeys: await textRows(
      `
        SELECT actor_user_id::text || ':' || operation || ':' || key_hash
        FROM m5_idempotency_records
        WHERE actor_user_id IN (${userParameters})
        ORDER BY actor_user_id, operation, key_hash
      `,
      userVariables,
      /^[0-9a-f-]{36}:[A-Z_]+:[0-9a-f]{64}$/,
      "M5 baseline idempotency key",
    ),
    legacyIdempotencyKeys: await textRows(
      `
        SELECT owner_user_id::text || ':' || operation || ':' || key_hash
        FROM idempotency_records
        WHERE owner_user_id IN (${userParameters})
        ORDER BY owner_user_id, operation, key_hash
      `,
      userVariables,
      /^[0-9a-f-]{36}:[A-Z_]+:[0-9a-f]{64}$/,
      "M5 baseline legacy idempotency key",
    ),
  };
}

async function restoreM5FixtureBaseline(householdId, baseline) {
  requireUuid(householdId, "M5 cleanup household");
  const variables = { household_id: householdId };
  const userParameters = bindUuidParameters(
    baseline.userIds,
    "cleanup_user",
    variables,
  );
  const actorParameters = bindTextParameters(
    baseline.actorKeys,
    "cleanup_actor",
    variables,
    /^[0-9a-f]{64}$/,
    "M5 cleanup rate actor",
  );
  const invitationPredicate = baselineExclusion(
    "id",
    baseline.invitationIds,
    "baseline_invitation",
    variables,
  );
  const memberPredicate = baselineExclusion(
    "id",
    baseline.memberIds,
    "baseline_member",
    variables,
  );
  const privacyPredicate = baselineExclusion(
    "id",
    baseline.privacyRequestIds,
    "baseline_privacy",
    variables,
  );
  const feedbackPredicate = baselineExclusion(
    "id",
    baseline.feedbackIds,
    "baseline_feedback",
    variables,
  );
  const supportPredicate = baselineExclusion(
    "id",
    baseline.supportGrantIds,
    "baseline_support",
    variables,
  );
  const noticePredicate = baselineExclusion(
    "id",
    baseline.noticeAcknowledgementIds,
    "baseline_notice",
    variables,
  );
  const consentPredicate = baselineExclusion(
    "id",
    baseline.consentEventIds,
    "baseline_consent",
    variables,
  );
  const auditPredicate = baselineExclusion(
    "id",
    baseline.auditEventIds,
    "baseline_audit",
    variables,
  );
  const ratePredicate = baselineExclusion(
    "id",
    baseline.rateEventIds,
    "baseline_rate",
    variables,
  );
  const m5IdempotencyPredicate = baselineTextExclusion(
    "actor_user_id::text || ':' || operation || ':' || key_hash",
    baseline.m5IdempotencyKeys,
    "baseline_m5_idem",
    variables,
  );
  const legacyIdempotencyPredicate = baselineTextExclusion(
    "owner_user_id::text || ':' || operation || ':' || key_hash",
    baseline.legacyIdempotencyKeys,
    "baseline_legacy_idem",
    variables,
  );

  const remaining = await postgresScalar(
    `
      BEGIN;

      CREATE TEMP TABLE m5_cleanup_privacy ON COMMIT DROP AS
      SELECT id
      FROM privacy_requests
      WHERE requester_user_id IN (${userParameters})
        ${privacyPredicate};

      CREATE TEMP TABLE m5_cleanup_feedback ON COMMIT DROP AS
      SELECT id
      FROM cancellation_guide_feedback
      WHERE household_id = :'household_id'::uuid
        ${feedbackPredicate};

      CREATE TEMP TABLE m5_cleanup_support ON COMMIT DROP AS
      SELECT id
      FROM support_diagnostic_grants
      WHERE household_id = :'household_id'::uuid
        ${supportPredicate};

      CREATE TEMP TABLE m5_cleanup_invitations ON COMMIT DROP AS
      SELECT id
      FROM household_invitations
      WHERE household_id = :'household_id'::uuid
        ${invitationPredicate};

      CREATE TEMP TABLE m5_cleanup_members ON COMMIT DROP AS
      SELECT id
      FROM household_members
      WHERE household_id = :'household_id'::uuid
        ${memberPredicate};

      CREATE TEMP TABLE m5_cleanup_notices ON COMMIT DROP AS
      SELECT id
      FROM privacy_notice_acknowledgements
      WHERE user_id IN (${userParameters})
        ${noticePredicate};

      CREATE TEMP TABLE m5_cleanup_consents ON COMMIT DROP AS
      SELECT id
      FROM consent_events
      WHERE user_id IN (${userParameters})
        ${consentPredicate};

      CREATE TEMP TABLE m5_cleanup_audit ON COMMIT DROP AS
      SELECT id
      FROM audit_events
      WHERE actor_user_id IN (${userParameters})
        ${auditPredicate};

      CREATE TEMP TABLE m5_cleanup_rates ON COMMIT DROP AS
      SELECT id
      FROM operation_rate_events
      WHERE actor_key IN (${actorParameters})
        ${ratePredicate};

      CREATE TEMP TABLE m5_cleanup_idempotency ON COMMIT DROP AS
      SELECT actor_user_id, operation, key_hash
      FROM m5_idempotency_records
      WHERE actor_user_id IN (${userParameters})
        ${m5IdempotencyPredicate};

      CREATE TEMP TABLE m5_cleanup_legacy_idempotency ON COMMIT DROP AS
      SELECT owner_user_id, operation, key_hash
      FROM idempotency_records
      WHERE owner_user_id IN (${userParameters})
        ${legacyIdempotencyPredicate};

      DELETE FROM audit_event_locks
      WHERE id IN (SELECT id FROM m5_cleanup_audit);

      DELETE FROM audit_events
      WHERE id IN (SELECT id FROM m5_cleanup_audit);

      DELETE FROM m5_idempotency_records r
      USING m5_cleanup_idempotency c
      WHERE r.actor_user_id = c.actor_user_id
        AND r.operation = c.operation
        AND r.key_hash = c.key_hash;

      DELETE FROM idempotency_records r
      USING m5_cleanup_legacy_idempotency c
      WHERE r.owner_user_id = c.owner_user_id
        AND r.operation = c.operation
        AND r.key_hash = c.key_hash;

      DELETE FROM privacy_export_artifacts
      WHERE request_id IN (SELECT id FROM m5_cleanup_privacy);

      DELETE FROM privacy_request_event_locks
      WHERE request_id IN (SELECT id FROM m5_cleanup_privacy);

      DELETE FROM privacy_request_events
      WHERE request_id IN (SELECT id FROM m5_cleanup_privacy);

      DELETE FROM privacy_requests
      WHERE id IN (SELECT id FROM m5_cleanup_privacy);

      DELETE FROM guide_feedback_reviews
      WHERE feedback_id IN (SELECT id FROM m5_cleanup_feedback);

      DELETE FROM cancellation_guide_feedback
      WHERE id IN (SELECT id FROM m5_cleanup_feedback);

      DELETE FROM support_diagnostic_grants
      WHERE id IN (SELECT id FROM m5_cleanup_support);

      DELETE FROM household_invitations
      WHERE id IN (SELECT id FROM m5_cleanup_invitations);

      UPDATE recurring_commitments
      SET visibility = 'PRIVATE',
          responsible_member_id = NULL,
          optimistic_version = optimistic_version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE household_id = :'household_id'::uuid
        AND responsible_member_id IN (SELECT id FROM m5_cleanup_members);

      DELETE FROM household_members
      WHERE id IN (SELECT id FROM m5_cleanup_members);

      DELETE FROM consent_event_locks
      WHERE id IN (SELECT id FROM m5_cleanup_consents);

      DELETE FROM consent_events
      WHERE id IN (SELECT id FROM m5_cleanup_consents);

      DELETE FROM privacy_notice_acknowledgement_locks
      WHERE id IN (SELECT id FROM m5_cleanup_notices);

      DELETE FROM privacy_notice_acknowledgements
      WHERE id IN (SELECT id FROM m5_cleanup_notices);

      DELETE FROM operation_rate_events
      WHERE id IN (SELECT id FROM m5_cleanup_rates);

      SELECT
        (SELECT COUNT(*) FROM privacy_requests
         WHERE id IN (SELECT id FROM m5_cleanup_privacy)) || '|' ||
        (SELECT COUNT(*) FROM cancellation_guide_feedback
         WHERE id IN (SELECT id FROM m5_cleanup_feedback)) || '|' ||
        (SELECT COUNT(*) FROM support_diagnostic_grants
         WHERE id IN (SELECT id FROM m5_cleanup_support)) || '|' ||
        (SELECT COUNT(*) FROM household_invitations
         WHERE id IN (SELECT id FROM m5_cleanup_invitations)) || '|' ||
        (SELECT COUNT(*) FROM household_members
         WHERE id IN (SELECT id FROM m5_cleanup_members)) || '|' ||
        (SELECT COUNT(*) FROM consent_events
         WHERE id IN (SELECT id FROM m5_cleanup_consents)) || '|' ||
        (SELECT COUNT(*) FROM privacy_notice_acknowledgements
         WHERE id IN (SELECT id FROM m5_cleanup_notices)) || '|' ||
        (SELECT COUNT(*) FROM audit_events
         WHERE id IN (SELECT id FROM m5_cleanup_audit)) || '|' ||
        (SELECT COUNT(*) FROM operation_rate_events
         WHERE id IN (SELECT id FROM m5_cleanup_rates)) || '|' ||
        (SELECT COUNT(*)
         FROM m5_idempotency_records r
         JOIN m5_cleanup_idempotency c
           ON r.actor_user_id = c.actor_user_id
          AND r.operation = c.operation
          AND r.key_hash = c.key_hash) || '|' ||
        (SELECT COUNT(*)
         FROM idempotency_records r
         JOIN m5_cleanup_legacy_idempotency c
           ON r.owner_user_id = c.owner_user_id
          AND r.operation = c.operation
          AND r.key_hash = c.key_hash);

      COMMIT;
    `,
    variables,
  );
  if (remaining !== "0|0|0|0|0|0|0|0|0|0|0") {
    throw new Error("Milestone 5 fixture residue survived baseline cleanup.");
  }
}

async function uuidRows(sql, variables, label) {
  const values = await textRows(sql, variables, /^[0-9a-f-]{36}$/, label);
  for (const value of values) {
    requireUuid(value, label);
  }
  return values;
}

async function textRows(sql, variables, pattern, label) {
  const output = await postgresCommand(sql, variables);
  const values = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => !pattern.test(value))) {
    throw new Error(`A ${label} value was invalid.`);
  }
  return values;
}

function bindUuidParameters(values, prefix, variables) {
  return values
    .map((value, index) => {
      requireUuid(value, prefix);
      const name = `${prefix}_${index}`;
      variables[name] = value;
      return `:'${name}'::uuid`;
    })
    .join(", ");
}

function bindTextParameters(values, prefix, variables, pattern, label) {
  return values
    .map((value, index) => {
      if (!pattern.test(value)) {
        throw new Error(`A ${label} value was invalid.`);
      }
      const name = `${prefix}_${index}`;
      variables[name] = value;
      return `:'${name}'`;
    })
    .join(", ");
}

function baselineExclusion(column, values, prefix, variables) {
  if (values.length === 0) {
    return "";
  }
  return `AND ${column} NOT IN (${bindUuidParameters(
    values,
    prefix,
    variables,
  )})`;
}

function baselineTextExclusion(expression, values, prefix, variables) {
  if (values.length === 0) {
    return "";
  }
  return `AND ${expression} NOT IN (${bindTextParameters(
    values,
    prefix,
    variables,
    /^[0-9a-f-]{36}:[A-Z_]+:[0-9a-f]{64}$/,
    prefix,
  )})`;
}

async function executeTimezoneCorrection(
  subjectPage,
  privacyAdminPage,
  timezone,
) {
  const request = await createPrivacyRequest(
    subjectPage,
    "CORRECTION",
    timezone,
  );
  const executed = await executePrivacyRequest(privacyAdminPage, request);
  if (executed.status !== "EXECUTED" || executed.correctionValue !== timezone) {
    throw new Error("A bounded timezone correction did not execute.");
  }
  return executed;
}

async function createPrivacyRequest(page, requestType, correctionValue) {
  const response = await api(page, "POST", "/v1/privacy/requests", {
    expectedStatus: 201,
    headers: {
      "idempotency-key": idempotencyKey(`m5-${requestType.toLowerCase()}`),
    },
    data:
      requestType === "CORRECTION"
        ? { requestType, correctionValue }
        : { requestType },
  });
  const body = await json(response);
  if (
    body.requestType !== requestType ||
    body.status !== "REQUESTED" ||
    body.version !== 0 ||
    body.export !== null
  ) {
    throw new Error(
      `The ${requestType} privacy request returned invalid initial state.`,
    );
  }
  assertVersionAndEtag(response, body, "privacy request creation");
  return body;
}

async function executePrivacyRequest(privacyAdminPage, request) {
  const key = idempotencyKey("m5-privacy-execute");
  const path = `/v1/admin/privacy/requests/${request.id}/execute`;
  const options = {
    headers: {
      "if-match": `"${request.version}"`,
      "idempotency-key": key,
    },
  };
  const response = await api(privacyAdminPage, "POST", path, options);
  const body = await json(response);
  assertVersionAndEtag(response, body, "privacy request execution");
  if (request.requestType === "DELETION" && body.status === "EXECUTED") {
    await api(privacyAdminPage, "POST", path, {
      ...options,
      expectedStatus: 404,
    });
    return body;
  }
  const replay = await json(await api(privacyAdminPage, "POST", path, options));
  if (JSON.stringify(replay) !== JSON.stringify(body)) {
    throw new Error("Privacy execution idempotency replay was not stable.");
  }
  return body;
}

async function exerciseGuideAndFeedback(activeSessions, selectedHousehold) {
  const ownerPage = activeSessions.owner.page;
  const guideAdminPage = activeSessions.guideAdmin.page;
  const catalogResponse = await api(
    guideAdminPage,
    "GET",
    "/v1/admin/cancellation-guides",
  );
  assertNoStore(catalogResponse, "guide administration catalog");
  const catalog = await json(catalogResponse);
  if (!Array.isArray(catalog.items) || catalog.items.length !== 20) {
    throw new Error(
      "The guide administrator did not receive the fictional twenty-guide catalog.",
    );
  }
  for (const item of catalog.items) {
    assertExactKeys(
      item,
      [
        "guideId",
        "merchantId",
        "merchantName",
        "merchantCategory",
        "state",
        "currentPublishedVersion",
        "version",
        "updatedAt",
      ],
      "guide catalog summary",
    );
    if (item.state !== "ACTIVE") {
      throw new Error(
        "The live verifier found an irreversible retired guide head.",
      );
    }
    const versions = await json(
      await api(
        guideAdminPage,
        "GET",
        `/v1/admin/cancellation-guides/${item.guideId}/versions`,
      ),
    );
    if (
      !Array.isArray(versions.items) ||
      versions.items.some(({ status }) => status === "DRAFT")
    ) {
      throw new Error(
        "The live verifier found an editable draft that cannot be safely discarded.",
      );
    }
  }
  const disposableGuide = catalog.items.find(
    ({ guideId }) => guideId === disposableGuideId,
  );
  if (!disposableGuide) {
    throw new Error("The reserved disposable fictional guide is missing.");
  }
  await exerciseDisposableGuideLifecycle(guideAdminPage, disposableGuide);

  const nonexistent = "00000000-0000-4000-8000-000000000099";
  await api(
    guideAdminPage,
    "POST",
    `/v1/admin/cancellation-guides/${nonexistent}/drafts`,
    {
      expectedStatus: 404,
      headers: {
        "idempotency-key": idempotencyKey("m5-missing-draft"),
      },
    },
  );
  await api(
    guideAdminPage,
    "POST",
    `/v1/admin/cancellation-guides/${nonexistent}/retire`,
    {
      expectedStatus: 404,
      headers: {
        "if-match": '"0"',
        "idempotency-key": idempotencyKey("m5-missing-retire"),
      },
    },
  );
  await api(
    guideAdminPage,
    "POST",
    `/v1/admin/cancellation-guide-drafts/${nonexistent}/publish`,
    {
      expectedStatus: 404,
      headers: {
        "if-match": '"0"',
        "idempotency-key": idempotencyKey("m5-missing-publish"),
      },
    },
  );
  await api(
    ownerPage,
    "POST",
    `/v1/admin/cancellation-guides/${catalog.items[0].guideId}/drafts`,
    {
      expectedStatus: 403,
      headers: {
        "idempotency-key": idempotencyKey("m5-user-draft"),
      },
    },
  );

  const commitments = await listCommitments(
    ownerPage,
    selectedHousehold.id,
    false,
  );
  const commitment = uniqueNamedCommitment(commitments, canonicalNames.shared);
  const guide = await json(
    await api(
      ownerPage,
      "GET",
      `/v1/commitments/${commitment.id}/cancellation-guide`,
    ),
  );
  const before = await listAllFeedback(guideAdminPage);
  const beforeIds = new Set(before.map(({ id }) => id));
  const noteCanary = `milestone-five-feedback-redaction-${alphabeticUuid()}`;
  await api(ownerPage, "POST", `/v1/cancellation-guides/${guide.id}/feedback`, {
    expectedStatus: 204,
    headers: {
      "idempotency-key": idempotencyKey("m5-feedback-create"),
    },
    data: {
      commitmentId: commitment.id,
      guideVersion: guide.version,
      outcome: "WORKED",
      note: noteCanary,
    },
  });
  const after = await listAllFeedback(guideAdminPage);
  const created = after.filter(
    (item) =>
      !beforeIds.has(item.id) &&
      item.guideId === guide.id &&
      item.guideVersion === guide.version &&
      item.outcome === "WORKED" &&
      item.disposition === "PENDING",
  );
  if (created.length !== 1) {
    throw new Error(
      "The guide administrator did not receive one new redacted feedback row.",
    );
  }
  for (const item of after) {
    assertExactKeys(item, feedbackKeys, "redacted guide feedback");
  }
  const redactedFeedback = JSON.stringify(after);
  for (const forbidden of [
    noteCanary,
    identities.owner.username,
    selectedHousehold.id,
    commitment.id,
    commitment.displayName,
    String(commitment.amountMinor),
  ]) {
    if (redactedFeedback.includes(forbidden)) {
      throw new Error(
        "The guide feedback administration queue leaked user content.",
      );
    }
  }

  const feedback = created[0];
  await api(
    guideAdminPage,
    "POST",
    `/v1/admin/cancellation-guide-feedback/${feedback.id}/review`,
    {
      expectedStatus: 412,
      headers: {
        "if-match": `"${feedback.version + 99}"`,
        "idempotency-key": idempotencyKey("m5-stale-feedback"),
      },
      data: { disposition: "RESOLVED" },
    },
  );
  await api(
    ownerPage,
    "POST",
    `/v1/admin/cancellation-guide-feedback/${feedback.id}/review`,
    {
      expectedStatus: 403,
      headers: {
        "if-match": `"${feedback.version}"`,
        "idempotency-key": idempotencyKey("m5-user-feedback"),
      },
      data: { disposition: "RESOLVED" },
    },
  );
  const reviewedResponse = await api(
    guideAdminPage,
    "POST",
    `/v1/admin/cancellation-guide-feedback/${feedback.id}/review`,
    {
      headers: {
        "if-match": `"${feedback.version}"`,
        "idempotency-key": idempotencyKey("m5-feedback-review"),
      },
      data: { disposition: "RESOLVED" },
    },
  );
  const reviewed = await json(reviewedResponse);
  assertExactKeys(reviewed, feedbackKeys, "reviewed guide feedback");
  assertVersionAndEtag(reviewedResponse, reviewed, "guide feedback review");
  if (reviewed.disposition !== "RESOLVED") {
    throw new Error("Guide feedback was not resolved.");
  }

  for (const name of ["privacyAdmin", "auditRead", "supportRead"]) {
    await api(
      activeSessions[name].page,
      "GET",
      "/v1/admin/cancellation-guides",
      { expectedStatus: 403 },
    );
  }
  return { feedbackId: feedback.id };
}

async function exerciseDisposableGuideLifecycle(page, initialGuide) {
  const createKey = idempotencyKey("m5-guide-draft");
  const createdResponse = await api(
    page,
    "POST",
    `/v1/admin/cancellation-guides/${disposableGuideId}/drafts`,
    {
      expectedStatus: 201,
      headers: { "idempotency-key": createKey },
    },
  );
  const created = await json(createdResponse);
  const createdEtag = assertVersionAndEtag(
    createdResponse,
    created,
    "guide draft creation",
  );
  assertGuideDraft(created, disposableGuideId);
  const replayedDraft = await json(
    await api(
      page,
      "POST",
      `/v1/admin/cancellation-guides/${disposableGuideId}/drafts`,
      {
        expectedStatus: 201,
        headers: { "idempotency-key": createKey },
      },
    ),
  );
  if (JSON.stringify(replayedDraft) !== JSON.stringify(created)) {
    throw new Error("Guide draft creation replay was not stable.");
  }

  const updateBody = {
    riskNotice:
      "Fictional local M5 acceptance guide. No merchant was contacted.",
    reviewIntervalDays: 61,
    steps: created.steps.map(({ track, sequenceNumber }) => ({
      track,
      sequenceNumber,
      title: `M5 ${track} step ${sequenceNumber}`,
      instruction:
        "Use only this fictional local instruction during acceptance.",
    })),
  };
  await api(
    page,
    "PATCH",
    `/v1/admin/cancellation-guide-drafts/${created.draftId}`,
    {
      expectedStatus: 412,
      headers: { "if-match": `"${created.version + 99}"` },
      data: updateBody,
    },
  );
  const updatedResponse = await api(
    page,
    "PATCH",
    `/v1/admin/cancellation-guide-drafts/${created.draftId}`,
    {
      headers: { "if-match": createdEtag },
      data: updateBody,
    },
  );
  const updated = await json(updatedResponse);
  assertGuideDraft(updated, disposableGuideId);
  const updatedEtag = assertVersionAndEtag(
    updatedResponse,
    updated,
    "guide draft update",
  );
  if (
    updated.riskNotice !== updateBody.riskNotice ||
    updated.reviewIntervalDays !== updateBody.reviewIntervalDays ||
    updated.steps.some(
      (step, index) =>
        step.actionType !== created.steps[index].actionType ||
        step.targetKey !== created.steps[index].targetKey ||
        step.targetUri !== created.steps[index].targetUri,
    )
  ) {
    throw new Error(
      "Guide draft editing changed fields outside text/review interval.",
    );
  }

  const publishKey = idempotencyKey("m5-guide-publish");
  const publicationResponse = await api(
    page,
    "POST",
    `/v1/admin/cancellation-guide-drafts/${updated.draftId}/publish`,
    {
      headers: {
        "if-match": updatedEtag,
        "idempotency-key": publishKey,
      },
    },
  );
  const publication = await json(publicationResponse);
  if (
    publication.guideId !== disposableGuideId ||
    publication.catalogState !== "ACTIVE" ||
    publication.publishedVersion !== updated.guideVersion
  ) {
    throw new Error("The disposable fictional guide did not publish.");
  }
  const replayedPublication = await json(
    await api(
      page,
      "POST",
      `/v1/admin/cancellation-guide-drafts/${updated.draftId}/publish`,
      {
        headers: {
          "if-match": updatedEtag,
          "idempotency-key": publishKey,
        },
      },
    ),
  );
  if (JSON.stringify(replayedPublication) !== JSON.stringify(publication)) {
    throw new Error("Guide publication replay was not stable.");
  }

  const publishedHeadResponse = await api(
    page,
    "GET",
    `/v1/admin/cancellation-guides/${disposableGuideId}`,
  );
  const publishedHead = await json(publishedHeadResponse);
  const publishedHeadEtag = assertVersionAndEtag(
    publishedHeadResponse,
    publishedHead,
    "published guide head",
  );
  await api(
    page,
    "POST",
    `/v1/admin/cancellation-guides/${disposableGuideId}/retire`,
    {
      expectedStatus: 412,
      headers: {
        "if-match": `"${initialGuide.version}"`,
        "idempotency-key": idempotencyKey("m5-stale-retire"),
      },
    },
  );
  const retireKey = idempotencyKey("m5-guide-retire");
  const retiredResponse = await api(
    page,
    "POST",
    `/v1/admin/cancellation-guides/${disposableGuideId}/retire`,
    {
      headers: {
        "if-match": publishedHeadEtag,
        "idempotency-key": retireKey,
      },
    },
  );
  const retired = await json(retiredResponse);
  if (retired.state !== "RETIRED" || retired.currentPublishedVersion !== null) {
    throw new Error("The disposable guide head did not retire safely.");
  }
  assertVersionAndEtag(retiredResponse, retired, "guide retirement");

  const reactivationDraftResponse = await api(
    page,
    "POST",
    `/v1/admin/cancellation-guides/${disposableGuideId}/drafts`,
    {
      expectedStatus: 201,
      headers: {
        "idempotency-key": idempotencyKey("m5-guide-reactivation-draft"),
      },
    },
  );
  const reactivationDraft = await json(reactivationDraftResponse);
  assertGuideDraft(reactivationDraft, disposableGuideId);
  const reactivationEtag = assertVersionAndEtag(
    reactivationDraftResponse,
    reactivationDraft,
    "retired guide clone",
  );
  await api(
    page,
    "POST",
    `/v1/admin/cancellation-guide-drafts/${reactivationDraft.draftId}/publish`,
    {
      headers: {
        "if-match": reactivationEtag,
        "idempotency-key": idempotencyKey("m5-guide-reactivate"),
      },
    },
  );
  const reactivated = await json(
    await api(
      page,
      "GET",
      `/v1/admin/cancellation-guides/${disposableGuideId}`,
    ),
  );
  if (
    reactivated.state !== "ACTIVE" ||
    reactivated.currentPublishedVersion !== reactivationDraft.guideVersion
  ) {
    throw new Error(
      "Publishing a retired guide clone did not reactivate the fictional head.",
    );
  }
  const versions = await json(
    await api(
      page,
      "GET",
      `/v1/admin/cancellation-guides/${disposableGuideId}/versions`,
    ),
  );
  if (
    versions.items?.length < 3 ||
    versions.items.some(({ status }) => status !== "PUBLISHED")
  ) {
    throw new Error(
      "Guide publication did not preserve immutable published history.",
    );
  }
}

function assertGuideDraft(draft, expectedGuideId) {
  assertExactKeys(
    draft,
    [
      "draftId",
      "guideId",
      "guideVersion",
      "status",
      "riskNotice",
      "structuralReviewedAt",
      "reviewIntervalDays",
      "steps",
      "version",
      "createdAt",
      "updatedAt",
    ],
    "guide draft",
  );
  if (
    draft.guideId !== expectedGuideId ||
    draft.status !== "DRAFT" ||
    !Array.isArray(draft.steps) ||
    draft.steps.length !== 4
  ) {
    throw new Error("The disposable guide draft shape is invalid.");
  }
}

async function listAllFeedback(page) {
  const items = [];
  let cursor = null;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const response = await api(
      page,
      "GET",
      `/v1/admin/cancellation-guide-feedback?${query.toString()}`,
    );
    assertNoStore(response, "guide feedback queue");
    const body = await json(response);
    if (!Array.isArray(body.items)) {
      throw new Error("The guide feedback queue is invalid.");
    }
    items.push(...body.items);
    cursor = body.nextCursor ?? null;
    if (!cursor) {
      return items;
    }
  }
  throw new Error("The guide feedback queue exceeded its verifier bound.");
}

async function exerciseSupport(activeSessions, selectedHousehold) {
  const ownerPage = activeSessions.owner.page;
  const supportPage = activeSessions.supportRead.page;
  const response = await api(
    ownerPage,
    "POST",
    `/v1/households/${selectedHousehold.id}/support-codes`,
    {
      expectedStatus: 201,
      data: { acknowledgeReadOnlyDiagnostics: true },
    },
  );
  const created = await json(response);
  if (
    !created.grant ||
    created.grant.status !== "ACTIVE" ||
    created.grant.version !== 0 ||
    !/^[A-Za-z0-9_-]{43}$/.test(created.supportCode)
  ) {
    throw new Error(
      "The owner support-code response did not contain one bounded manual code.",
    );
  }
  const lifetime =
    Date.parse(created.grant.expiresAt) - Date.parse(created.grant.createdAt);
  if (
    lifetime <= 0 ||
    lifetime > 15 * 60 * 1_000 ||
    lifetime < 14 * 60 * 1_000
  ) {
    throw new Error(
      "The owner support grant was not bounded to at most fifteen minutes.",
    );
  }
  let oneTimeCode = created.supportCode;
  const grant = created.grant;
  const supportDigest = sha256Hex(oneTimeCode);
  evidence.oneTimeCanaries.push(oneTimeCode, supportDigest);
  await assertSupportSecretStorage(grant.id, oneTimeCode, supportDigest);
  supportGrant = grant;
  supportCode = oneTimeCode;

  await api(
    ownerPage,
    "POST",
    `/v1/households/${selectedHousehold.id}/support-codes`,
    {
      expectedStatus: 400,
      headers: {
        "idempotency-key": idempotencyKey("forbidden-support-code"),
      },
      data: { acknowledgeReadOnlyDiagnostics: true },
    },
  );
  await api(ownerPage, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 403,
    data: { supportCode: oneTimeCode },
  });
  await api(
    activeSessions.foreign.page,
    "POST",
    "/v1/support/diagnostics/resolve",
    {
      expectedStatus: 403,
      data: { supportCode: oneTimeCode },
    },
  );
  await api(supportPage, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 404,
    data: { supportCode: "A".repeat(43) },
  });

  const diagnosticsResponse = await api(
    supportPage,
    "POST",
    "/v1/support/diagnostics/resolve",
    { data: { supportCode: oneTimeCode } },
  );
  assertNoStore(diagnosticsResponse, "support diagnostics");
  const diagnostics = await json(diagnosticsResponse);
  assertExactKeys(
    diagnostics,
    [
      "schemaVersion",
      "status",
      "activeCommitmentCount",
      "failedNotificationCount",
      "pendingPrivacyRequestCount",
      "latestCommitmentVersion",
      "generatedAt",
      "grantExpiresAt",
    ],
    "support diagnostics",
  );
  const createdGrantExpiry = Date.parse(grant.expiresAt);
  const diagnosticGrantExpiry = Date.parse(diagnostics.grantExpiresAt);
  if (
    diagnostics.schemaVersion !== "support-diagnostics-v1" ||
    diagnostics.activeCommitmentCount !== 4 ||
    !["HEALTHY", "ATTENTION"].includes(diagnostics.status) ||
    !Number.isFinite(createdGrantExpiry) ||
    !Number.isFinite(diagnosticGrantExpiry) ||
    diagnosticGrantExpiry !== createdGrantExpiry
  ) {
    throw new Error(
      "Support diagnostics did not expose the expected bounded counters.",
    );
  }
  const diagnosticText = JSON.stringify(diagnostics);
  for (const forbidden of [
    oneTimeCode,
    selectedHousehold.id,
    selectedHousehold.name,
    identities.owner.username,
    ...expectedCanonicalNames,
    "INR",
    "450000",
    "5400000",
  ]) {
    if (diagnosticText.includes(forbidden)) {
      throw new Error("Support diagnostics leaked household content.");
    }
  }

  for (const name of ["guideAdmin", "privacyAdmin", "auditRead"]) {
    await api(
      activeSessions[name].page,
      "POST",
      "/v1/support/diagnostics/resolve",
      {
        expectedStatus: 403,
        data: { supportCode: oneTimeCode },
      },
    );
  }

  await api(
    ownerPage,
    "DELETE",
    `/v1/households/${selectedHousehold.id}/support-codes/${grant.id}`,
    {
      expectedStatus: 412,
      headers: { "if-match": `"${grant.version + 99}"` },
    },
  );
  await revokeSupportGrant(ownerPage, selectedHousehold.id, grant);
  supportGrant = null;
  await api(supportPage, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 404,
    data: { supportCode: oneTimeCode },
  });

  const expiringResponse = await api(
    ownerPage,
    "POST",
    `/v1/households/${selectedHousehold.id}/support-codes`,
    {
      expectedStatus: 201,
      data: { acknowledgeReadOnlyDiagnostics: true },
    },
  );
  const expiring = await json(expiringResponse);
  let expiringCode = expiring.supportCode;
  if (
    !expiring.grant ||
    expiring.grant.status !== "ACTIVE" ||
    expiring.grant.version !== 0 ||
    !/^[A-Za-z0-9_-]{43}$/.test(expiringCode)
  ) {
    throw new Error(
      "The support-expiry fixture did not return one bounded manual code.",
    );
  }
  const expiringDigest = sha256Hex(expiringCode);
  evidence.oneTimeCanaries.push(expiringCode, expiringDigest);
  await assertSupportSecretStorage(
    expiring.grant.id,
    expiringCode,
    expiringDigest,
  );
  expiring.supportCode = null;
  supportGrant = expiring.grant;
  await backdateSupportGrantToExpiryBoundary(expiring.grant.id);
  await api(supportPage, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 404,
    data: { supportCode: expiringCode },
  });
  await assertExpiredSupportGrant(expiring.grant.id);
  await api(
    ownerPage,
    "DELETE",
    `/v1/households/${selectedHousehold.id}/support-codes/${expiring.grant.id}`,
    {
      expectedStatus: 412,
      headers: { "if-match": `"${expiring.grant.version + 1}"` },
    },
  );
  supportGrant = null;
  expiringCode = null;

  const returnedSupportCode = oneTimeCode;
  created.supportCode = null;
  oneTimeCode = null;
  return {
    grantId: grant.id,
    expiredGrantId: expiring.grant.id,
    supportCode: returnedSupportCode,
  };
}

async function revokeSupportGrant(
  page,
  householdId,
  grant,
  expectedStatus = 204,
) {
  await api(
    page,
    "DELETE",
    `/v1/households/${householdId}/support-codes/${grant.id}`,
    {
      expectedStatus,
      headers: { "if-match": `"${grant.version}"` },
    },
  );
}

async function assertRedactedAudit(
  activeSessions,
  expected,
  plaintextCanaries,
) {
  for (const name of [
    "owner",
    "member",
    "foreign",
    "guideAdmin",
    "privacyAdmin",
    "supportRead",
  ]) {
    await api(
      activeSessions[name].page,
      "GET",
      "/v1/admin/audit-events?limit=1",
      { expectedStatus: 403 },
    );
  }

  const events = await listAuditEvents(activeSessions.auditRead.page);
  for (const event of events) {
    assertExactKeys(event, auditKeys, "redacted audit event");
    if (event.outcome !== "SUCCEEDED") {
      throw new Error("The audit view returned a non-allowlisted outcome.");
    }
  }
  const serialized = JSON.stringify(events);
  for (const forbidden of [
    ...plaintextCanaries.filter(Boolean),
    ...Object.values(expectedUsernames),
    ...expectedCanonicalNames,
    "INR",
    "450000",
    "5400000",
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error("The audit view leaked identity or household content.");
    }
  }

  const requiredPairs = [
    ["HOUSEHOLD_INVITATION_CREATED", expected.invitationId],
    ["HOUSEHOLD_INVITATION_ACCEPTED", expected.invitationId],
    ["HOUSEHOLD_MEMBER_REMOVED", expected.memberId],
    ["COMMITMENT_SHARING_CHANGED", expected.sharedCommitmentId],
    ["GUIDE_FEEDBACK_REVIEWED", expected.feedbackId],
    ["GUIDE_DRAFT_CREATED", expected.guideId],
    ["GUIDE_DRAFT_SAVED", expected.guideId],
    ["GUIDE_PUBLISHED", expected.guideId],
    ["GUIDE_RETIRED", expected.guideId],
    ["SUPPORT_GRANT_CREATED", expected.supportGrantId],
    ["SUPPORT_GRANT_REVOKED", expected.supportGrantId],
    ["SUPPORT_GRANT_CREATED", expected.expiredSupportGrantId],
    ["SUPPORT_GRANT_EXPIRED", expected.expiredSupportGrantId],
    ["HOUSEHOLD_INVITATION_EXPIRED", expected.expiredInvitationId],
    ...expected.correctionRequestIds.map((id) => [
      "PRIVACY_CORRECTION_EXECUTED",
      id,
    ]),
    ...expected.deletionRequestIds
      .slice(0, 2)
      .map((id) => ["PRIVACY_DELETION_BLOCKED", id]),
    ["PRIVACY_DELETION_EXECUTED", expected.deletionRequestIds.at(-1)],
  ];
  for (const [action, resourceId] of requiredPairs) {
    if (
      !resourceId ||
      !events.some(
        (event) => event.action === action && event.resourceId === resourceId,
      )
    ) {
      throw new Error(
        "A successful M5 mutation is absent from the redacted audit view.",
      );
    }
  }
  if (
    events.filter(
      ({ action, resourceId }) =>
        action === "GUIDE_PUBLISHED" && resourceId === expected.guideId,
    ).length < 2
  ) {
    throw new Error(
      "The redacted audit view did not retain both guide publications.",
    );
  }
}

async function listAuditEvents(page) {
  const items = [];
  let cursor = null;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const response = await api(
      page,
      "GET",
      `/v1/admin/audit-events?${query.toString()}`,
    );
    assertNoStore(response, "audit event list");
    const body = await json(response);
    if (!Array.isArray(body.items)) {
      throw new Error("The audit response did not contain an items array.");
    }
    items.push(...body.items);
    cursor = body.nextCursor ?? null;
    if (!cursor) {
      return items;
    }
  }
  throw new Error("The audit event list exceeded its verifier bound.");
}

async function assertNoPlaintextInBrowserStorage(pages, secrets) {
  const canaries = secrets.filter(Boolean);
  for (const page of pages) {
    if (canaries.some((value) => page.url().includes(value))) {
      throw new Error("A one-time code appeared in a browser URL.");
    }
    const snapshot = await page.evaluate(() => ({
      local: Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, index) => {
          const key = localStorage.key(index) ?? "";
          return [key, localStorage.getItem(key)];
        }),
      ),
      session: Object.fromEntries(
        Array.from({ length: sessionStorage.length }, (_, index) => {
          const key = sessionStorage.key(index) ?? "";
          return [key, sessionStorage.getItem(key)];
        }),
      ),
      visibleText: document.body?.innerText ?? "",
    }));
    const serialized = JSON.stringify(snapshot);
    if (canaries.some((value) => serialized.includes(value))) {
      throw new Error(
        "A one-time invitation or support code entered browser storage or DOM text.",
      );
    }
  }
}

async function mailpitMessageIds() {
  const response = await fetch(
    "http://localhost:8025/api/v1/messages?start=0&limit=500",
  );
  if (!response.ok) {
    throw new Error("The canonical local Mailpit API is unavailable.");
  }
  const body = await response.json();
  if (!Array.isArray(body.messages)) {
    throw new Error("Mailpit returned an invalid message summary.");
  }
  return new Set(body.messages.map(({ ID }) => ID).filter(Boolean));
}

async function assertNoM5Delivery(beforeIds, inviteeEmail, secrets) {
  const response = await fetch(
    "http://localhost:8025/api/v1/messages?start=0&limit=500",
  );
  if (!response.ok) {
    throw new Error("The canonical local Mailpit API is unavailable.");
  }
  const body = await response.json();
  if (!Array.isArray(body.messages)) {
    throw new Error("Mailpit returned an invalid message summary.");
  }
  const newMessages = body.messages.filter(
    ({ ID }) => ID && !beforeIds.has(ID),
  );
  const serialized = JSON.stringify(newMessages);
  if (
    serialized.includes(inviteeEmail) ||
    secrets.filter(Boolean).some((value) => serialized.includes(value))
  ) {
    throw new Error(
      "Milestone 5 emitted an invitation/support delivery or leaked a one-time code to Mailpit.",
    );
  }
}

async function assertNoOneTimeSecretInServiceLogs(canaries) {
  const secrets = [...new Set(canaries.filter(Boolean))];
  if (secrets.length === 0) {
    throw new Error(
      "No one-time secret canaries were available for log review.",
    );
  }
  const { stdout, stderr } = await execFile(
    "docker",
    ["compose", "logs", "--no-color"],
    {
      cwd: repositoryRoot,
      env: process.env,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const logs = `${stdout}\n${stderr}`;
  if (secrets.some((secret) => logs.includes(secret))) {
    throw new Error(
      "A one-time invitation/support code or digest appeared in local service logs.",
    );
  }
}

async function restoreCanonicalHousehold(page, selectedHousehold) {
  const invitationCollection = await json(
    await api(
      page,
      "GET",
      `/v1/households/${selectedHousehold.id}/invitations`,
    ),
  );
  for (const invitation of invitationCollection.items ?? []) {
    if (invitation.status !== "PENDING") {
      continue;
    }
    await api(
      page,
      "DELETE",
      `/v1/households/${selectedHousehold.id}/invitations/${invitation.id}`,
      {
        expectedStatus: [204, 404],
        headers: { "if-match": `"${invitation.version}"` },
      },
    );
  }

  const memberCollection = await json(
    await api(page, "GET", `/v1/households/${selectedHousehold.id}/members`),
  );
  for (const member of memberCollection.items ?? []) {
    if (member.role !== "MEMBER" || member.status !== "ACTIVE") {
      continue;
    }
    await api(
      page,
      "DELETE",
      `/v1/households/${selectedHousehold.id}/members/${member.id}`,
      {
        expectedStatus: [204, 404],
        headers: { "if-match": `"${member.version}"` },
      },
    );
  }

  const commitments = await listCommitments(page, selectedHousehold.id, false);
  for (const item of commitments) {
    if (
      !expectedCanonicalNames.has(item.displayName) ||
      (item.visibility === "PRIVATE" && item.responsibleMemberId === null)
    ) {
      continue;
    }
    const current = await commitment(page, item.id);
    await api(page, "PATCH", `/v1/commitments/${item.id}/sharing`, {
      headers: { "if-match": current.etag },
      data: { visibility: "PRIVATE", responsibleMemberId: null },
    });
  }

  const activeMembers = await json(
    await api(page, "GET", `/v1/households/${selectedHousehold.id}/members`),
  );
  const pendingInvitations = await json(
    await api(
      page,
      "GET",
      `/v1/households/${selectedHousehold.id}/invitations`,
    ),
  );
  if (
    activeMembers.items?.some(
      ({ role, status }) => role === "MEMBER" && status === "ACTIVE",
    ) ||
    pendingInvitations.items?.some(({ status }) => status === "PENDING")
  ) {
    throw new Error(
      "Household cleanup left an active member or pending invitation.",
    );
  }
}

async function assertCanonicalDashboard(page, selectedHousehold) {
  const commitments = await listCommitments(page, selectedHousehold.id, false);
  const canonical = commitments.filter(({ displayName }) =>
    expectedCanonicalNames.has(displayName),
  );
  if (
    canonical.length !== 4 ||
    new Set(canonical.map(({ displayName }) => displayName)).size !== 4 ||
    canonical.some(
      ({ visibility, responsibleMemberId, canManage }) =>
        visibility !== "PRIVATE" ||
        responsibleMemberId !== null ||
        canManage !== true,
    )
  ) {
    throw new Error(
      "Cleanup did not restore four private, unassigned canonical commitments.",
    );
  }
  const month = localDateInTimeZone(selectedHousehold.timezone).slice(0, 7);
  const query = new URLSearchParams({
    householdId: selectedHousehold.id,
    month,
  });
  const summary = await json(
    await api(page, "GET", `/v1/dashboard/summary?${query.toString()}`),
  );
  const monthly = summary.monthlyProjection?.totals;
  const annual = summary.annualizedProjection?.totals;
  if (
    summary.activeCommitmentCount !== 4 ||
    monthly?.length !== 1 ||
    monthly[0].currency !== "INR" ||
    monthly[0].knownTotalMinor !== 450000 ||
    annual?.length !== 1 ||
    annual[0].currency !== "INR" ||
    annual[0].knownTotalMinor !== 5400000
  ) {
    throw new Error(
      "Cleanup did not restore INR 4,500 monthly and INR 54,000 forward projection.",
    );
  }
}

async function currentConsent(page) {
  const body = await json(await api(page, "GET", "/v1/privacy/consents"));
  const hasEvents = Array.isArray(body.events) && body.events.length > 0;
  if (
    body.purpose !== "HOUSEHOLD_SHARING" ||
    !Array.isArray(body.events) ||
    (body.nextCursor !== null && typeof body.nextCursor !== "string") ||
    (hasEvents &&
      (!body.currentPurposeVersion ||
        !["GRANTED", "WITHDRAWN"].includes(body.currentAction))) ||
    (!hasEvents &&
      (body.currentPurposeVersion !== null || body.currentAction !== null))
  ) {
    throw new Error("The household-sharing consent state is invalid.");
  }
  return body;
}

async function ensureNoticeAndConsent(page) {
  const notice = await json(
    await api(page, "GET", "/v1/privacy/notices/current"),
  );
  const acknowledgements = await json(
    await api(page, "GET", "/v1/privacy/notice-acknowledgements"),
  );
  if (
    !Array.isArray(acknowledgements.items) ||
    !acknowledgements.items.some(
      (item) =>
        item.noticeVersion === notice.noticeVersion &&
        item.contentSha256 === notice.contentSha256 &&
        item.eventType === "ACKNOWLEDGED",
    )
  ) {
    const response = await api(
      page,
      "POST",
      "/v1/privacy/notice-acknowledgements",
      {
        expectedStatus: 201,
        headers: {
          "idempotency-key": idempotencyKey("m5-notice-ack"),
        },
        data: { noticeVersion: notice.noticeVersion },
      },
    );
    const acknowledged = await json(response);
    if (
      acknowledged.noticeVersion !== notice.noticeVersion ||
      acknowledged.contentSha256 !== notice.contentSha256
    ) {
      throw new Error(
        "The current privacy notice acknowledgement was not pinned.",
      );
    }
  }
  await setConsent(page, "GRANTED");
}

async function setConsent(page, action) {
  const notice = await json(
    await api(page, "GET", "/v1/privacy/notices/current"),
  );
  const current = await currentConsent(page);
  if (
    current.currentAction === action &&
    current.currentPurposeVersion === notice.noticeVersion
  ) {
    return current;
  }
  const response = await api(page, "POST", "/v1/privacy/consents", {
    expectedStatus: 201,
    headers: {
      "idempotency-key": idempotencyKey(`m5-consent-${action.toLowerCase()}`),
    },
    data: {
      purpose: "HOUSEHOLD_SHARING",
      purposeVersion: notice.noticeVersion,
      action,
    },
  });
  const body = await json(response);
  if (
    body.purpose !== "HOUSEHOLD_SHARING" ||
    body.purposeVersion !== notice.noticeVersion ||
    body.action !== action
  ) {
    throw new Error("A household-sharing consent event was not pinned.");
  }
  return body;
}

async function restoreConsent(page, originalAction) {
  if (!page) {
    return;
  }
  const expectedAction = originalAction ?? "WITHDRAWN";
  await setConsent(page, expectedAction);
  const restored = await currentConsent(page);
  if (restored.currentAction !== expectedAction) {
    throw new Error("The fake-local consent state was not safely restored.");
  }
}

async function commitment(page, commitmentId) {
  const response = await api(page, "GET", `/v1/commitments/${commitmentId}`);
  const body = await json(response);
  return {
    body,
    etag: assertVersionAndEtag(response, body, "commitment conditional read"),
  };
}

async function listCommitments(page, householdId, includeArchived) {
  const items = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({
      householdId,
      includeArchived: String(includeArchived),
      limit: "100",
    });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const body = await json(
      await api(page, "GET", `/v1/commitments?${query.toString()}`),
    );
    if (!Array.isArray(body.items)) {
      throw new Error("The commitment collection is invalid.");
    }
    items.push(...body.items);
    cursor = body.nextCursor ?? null;
  } while (cursor);
  return items;
}

function uniqueNamedCommitment(items, displayName) {
  const matches = items.filter(
    (item) => item.displayName === displayName && item.status === "ACTIVE",
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one active canonical commitment named ${displayName}.`,
    );
  }
  return matches[0];
}

async function resolveCanonicalHousehold(page) {
  const body = await json(await api(page, "GET", "/v1/households"));
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error("The canonical fake owner has no household.");
  }
  const household = [...body.items].sort((left, right) =>
    `${left.createdAt}:${left.id}`.localeCompare(
      `${right.createdAt}:${right.id}`,
    ),
  )[0];
  if (
    household.defaultCurrency !== "INR" ||
    household.accessRole !== "OWNER" ||
    household.canManage !== true
  ) {
    throw new Error("The oldest fake household is not the owner INR scope.");
  }
  return household;
}

async function assertMe(page, expectedEmail) {
  const body = await json(await api(page, "GET", "/v1/me"));
  if (body.email !== expectedEmail || typeof body.id !== "string") {
    throw new Error(
      "An authenticated M5 session resolved to the wrong identity.",
    );
  }
  requireUuid(body.id, "authenticated user");
  return body;
}

async function authenticatedSession(browserInstance, identity) {
  const context = await browserInstance.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  try {
    await page.goto("/signin?callbackUrl=%2Fmore", {
      waitUntil: "load",
    });
    const continueButton = page.getByRole("button", {
      name: "Continue securely",
    });
    await continueButton.waitFor({ state: "visible" });
    const signInActionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === baseUrl &&
        new URL(response.url()).pathname === "/signin",
      { timeout: 30_000 },
    );
    await continueButton.click();
    await signInActionResponsePromise;
    await page.locator("#username").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.locator("#username").fill(identity.username);
    await page.locator("#password").fill(identity.password);
    await page.locator("#kc-login").click();
    await page.waitForURL(
      (url) =>
        url.origin === baseUrl &&
        !url.pathname.startsWith("/signin") &&
        !url.pathname.startsWith("/api/auth"),
      { timeout: 30_000 },
    );
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function api(page, method, path, options = {}) {
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus ?? 200];
  const response = await page.request.fetch(`${baseUrl}/api/bff${path}`, {
    method,
    data: options.data,
    headers: {
      accept: "application/json, application/problem+json",
      origin: baseUrl,
      ...(options.data === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  if (!expected.includes(response.status())) {
    const correlationId =
      response.headers()["x-correlation-id"] ?? "not-provided";
    throw new Error(
      `Authenticated local request ${method} ${path.split("?")[0]} returned HTTP ${response.status()} (correlation ${correlationId}).`,
    );
  }
  return response;
}

async function json(response) {
  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("An authenticated M5 response was not a JSON object.");
  }
  return body;
}

function assertVersionAndEtag(response, body, operation) {
  if (!Number.isSafeInteger(body.version) || body.version < 0) {
    throw new Error(`${operation} returned an invalid version.`);
  }
  const expected = `"${body.version}"`;
  const actual = response.headers().etag;
  if (actual !== expected) {
    throw new Error(
      `${operation} returned ETag ${actual ?? "missing"} for version ${body.version}.`,
    );
  }
  return actual;
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The ${label} is not a JSON object.`);
  }
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.join("\u0000") !== allowed.join("\u0000")) {
    throw new Error(`The ${label} returned fields outside its allowlist.`);
  }
}

function assertNoStore(response, label) {
  if (!(response.headers()["cache-control"] ?? "").includes("no-store")) {
    throw new Error(`The ${label} response was not marked no-store.`);
  }
}

function idempotencyKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function alphabeticUuid() {
  return crypto
    .randomUUID()
    .replace(/[0-9]/g, (digit) =>
      String.fromCharCode("q".charCodeAt(0) + Number(digit)),
    );
}

function localDateInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

async function assertLocalStackReady() {
  const checks = [
    ["web", `${baseUrl}/signin`],
    ["API", "http://localhost:8080/actuator/health/readiness"],
    ["Keycloak", `${issuer}/.well-known/openid-configuration`],
    ["Mailpit", "http://localhost:8025/readyz"],
  ];
  for (const [name, url] of checks) {
    const response = await fetch(url, { redirect: "manual" });
    if (!response.ok) {
      throw new Error(`${name} is not ready at its canonical loopback URL.`);
    }
  }
}

async function assertLocalComposeAdministration() {
  const identity = await postgresScalar(
    "SELECT current_database() || '|' || current_user",
  );
  if (identity !== "autopay_guard|autopay_guard_admin") {
    throw new Error(
      "Refusing local fixture administration against an unexpected PostgreSQL database.",
    );
  }
  const fixture = await postgresScalar(
    `
      SELECT COUNT(*)
      FROM cancellation_guide_versions
      WHERE guide_id = :'guide_id'::uuid
        AND version = 1
        AND status = 'PUBLISHED'
    `,
    { guide_id: disposableGuideId },
  );
  if (fixture !== "1") {
    throw new Error(
      "The reserved fictional guide baseline is missing from local PostgreSQL.",
    );
  }
}

async function resetDisposableGuideFixture() {
  await postgresExecute(
    `
      BEGIN;

      UPDATE cancellation_guide_catalog_state
      SET current_published_version = 1,
          state = 'ACTIVE',
          optimistic_version = 0,
          updated_at = (
            SELECT published_at
            FROM cancellation_guide_versions
            WHERE guide_id = :'guide_id'::uuid AND version = 1
          )
      WHERE guide_id = :'guide_id'::uuid;

      DELETE FROM guide_lifecycle_event_locks
      WHERE id IN (
        SELECT id
        FROM guide_lifecycle_events
        WHERE guide_id = :'guide_id'::uuid
          AND guide_version > 1
      );

      DELETE FROM guide_lifecycle_events
      WHERE guide_id = :'guide_id'::uuid
        AND guide_version > 1;

      DELETE FROM cancellation_published_target_locks
      WHERE guide_id = :'guide_id'::uuid
        AND guide_version > 1;

      DELETE FROM cancellation_published_step_locks
      WHERE guide_id = :'guide_id'::uuid
        AND guide_version > 1;

      DELETE FROM cancellation_published_version_locks
      WHERE guide_id = :'guide_id'::uuid
        AND version > 1;

      DELETE FROM cancellation_guide_draft_states
      WHERE guide_id = :'guide_id'::uuid
        AND guide_version > 1;

      DELETE FROM cancellation_guide_steps
      WHERE guide_id = :'guide_id'::uuid
        AND guide_version > 1;

      DELETE FROM cancellation_guide_versions
      WHERE guide_id = :'guide_id'::uuid
        AND version > 1;

      COMMIT;
    `,
    { guide_id: disposableGuideId },
  );
  const state = await postgresScalar(
    `
      SELECT
        s.state || '|' ||
        s.current_published_version || '|' ||
        s.optimistic_version || '|' ||
        COUNT(v.version)
      FROM cancellation_guide_catalog_state s
      JOIN cancellation_guide_versions v ON v.guide_id = s.guide_id
      WHERE s.guide_id = :'guide_id'::uuid
      GROUP BY
        s.state,
        s.current_published_version,
        s.optimistic_version
    `,
    { guide_id: disposableGuideId },
  );
  if (state !== "ACTIVE|1|0|1") {
    throw new Error(
      "The reserved fictional guide did not return to its exact baseline.",
    );
  }
}

async function resetDisposableDeletionFixture() {
  await postgresExecute(
    `
      DELETE FROM deletion_tombstones
      WHERE subject_hash = :'subject_hash'
    `,
    { subject_hash: deletionTombstoneHash },
  );
  const remaining = await postgresScalar(
    `
      SELECT COUNT(*)
      FROM deletion_tombstones
      WHERE subject_hash = :'subject_hash'
    `,
    { subject_hash: deletionTombstoneHash },
  );
  if (remaining !== "0") {
    throw new Error(
      "The exact disposable deletion tombstone could not be reset.",
    );
  }
}

async function postgresScalar(sql, variables = {}) {
  const output = await postgresCommand(sql, variables);
  return output.trim();
}

async function postgresExecute(sql, variables = {}) {
  await postgresCommand(sql, variables);
}

async function postgresCommand(sql, variables) {
  const args = [
    "compose",
    "--project-directory",
    repositoryRoot,
    "--env-file",
    envFile,
    "--file",
    join(repositoryRoot, "compose.yaml"),
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username",
    requiredEnvironment("POSTGRES_USER"),
    "--dbname",
    requiredEnvironment("POSTGRES_DB"),
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
  ];
  for (const [name, value] of Object.entries(variables).sort()) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !/^[A-Za-z0-9_.:@-]+$/.test(value)) {
      throw new Error("A local PostgreSQL fixture variable was invalid.");
    }
    args.push("--set", `${name}=${value}`);
  }
  return runPostgresCommand(args, sql);
}

async function runPostgresCommand(args, sql) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn("docker", args, {
      cwd: repositoryRoot,
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const maximumOutputBytes = 1024 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error("The local PostgreSQL fixture command timed out."));
    }, 30_000);

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      rejectCommand(error);
    };

    child.once("error", fail);
    child.stdin.once("error", (error) => {
      if (error.code !== "EPIPE") {
        child.kill();
        fail(error);
      }
    });
    child.stdout.on("data", (chunk) => {
      if (settled) {
        return;
      }
      stdoutBytes += chunk.length;
      if (stdoutBytes > maximumOutputBytes) {
        child.kill();
        fail(
          new Error("The local PostgreSQL fixture output exceeded its limit."),
        );
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (settled) {
        return;
      }
      stderrBytes += chunk.length;
      if (stderrBytes > maximumOutputBytes) {
        child.kill();
        fail(
          new Error("The local PostgreSQL fixture error exceeded its limit."),
        );
        return;
      }
      stderrChunks.push(chunk);
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        rejectCommand(
          new Error(
            `The local PostgreSQL fixture command failed (${
              signal ?? code ?? "unknown"
            })${stderr ? `: ${stderr.slice(0, 4_000)}` : "."}`,
          ),
        );
        return;
      }
      resolveCommand(stdout);
    });
    child.stdin.end(`${sql}\n`);
  });
}

function requireUuid(value, label) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`The ${label} identifier is not a UUIDv4.`);
  }
}

function validateEnvironment() {
  if (process.env.M5_LIVE_ACCEPTANCE_ACK !== acknowledgement) {
    throw new Error(
      `Set M5_LIVE_ACCEPTANCE_ACK=${acknowledgement} to confirm this guarded fake-local mutation.`,
    );
  }
  requireExactEnvironment("COMPOSE_PROJECT_NAME", "autopay-guard");
  requireExactEnvironment("AUTH_URL", baseUrl);
  requireExactEnvironment("AUTH_KEYCLOAK_ISSUER", issuer);
  requireExactEnvironment("POSTGRES_DB", "autopay_guard");
  requireExactEnvironment("POSTGRES_USER", "autopay_guard_admin");
}

function loadIdentities() {
  const result = {};
  for (const [name, [usernameName, passwordName]] of Object.entries(
    identityEnvironment,
  )) {
    const username = requiredEnvironment(usernameName);
    if (
      username !== expectedUsernames[name] ||
      !username.endsWith("@autopayguard.local")
    ) {
      throw new Error(
        `${usernameName} must be the canonical fake-local M5 identity.`,
      );
    }
    result[name] = {
      username,
      password: requiredEnvironment(passwordName),
    };
  }
  if (
    new Set(Object.values(result).map(({ username }) => username)).size !==
    Object.keys(result).length
  ) {
    throw new Error("Every Milestone 5 role must use a distinct identity.");
  }
  return result;
}

function requireExactEnvironment(name, expected) {
  if (requiredEnvironment(name) !== expected) {
    throw new Error(`${name} must equal the canonical fake-local value.`);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Milestone 5 live acceptance.`);
  }
  return value;
}

async function acquireLock() {
  const token = crypto.randomUUID();
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another M5 live verifier may be running. After checking processes, remove the stale lock at ${lockPath}.`,
      );
    }
    throw error;
  }
  await handle.writeFile(
    JSON.stringify({
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }),
  );
  await handle.close();
  return async () => {
    const current = await readFile(lockPath, "utf8").catch(() => null);
    if (current) {
      const owner = JSON.parse(current);
      if (owner.token === token) {
        await rm(lockPath, { force: true });
      }
    }
  };
}
