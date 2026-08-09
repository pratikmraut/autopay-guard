import { expect, test, type Page } from "@playwright/test";

import {
  expectEmptyBrowserStorage,
  expectNoHorizontalOverflow,
  expectNoOverflowAtTwoHundredPercent,
  expectNoSeriousAxe,
  expiredInstant,
  fixedInstant,
  fixtureIds,
  fulfillJson,
  fulfillProblem,
  futureInstant,
  oneTimeCode,
  ownerHousehold,
  signInAs,
} from "./milestone5-test-support";

test.setTimeout(180_000);

test("household access exposes bounded states, focus, pagination failure, and no delivery claims", async ({
  page,
}, testInfo) => {
  let releaseHouseholds: (() => void) | undefined;
  const householdGate = new Promise<void>((resolve) => {
    releaseHouseholds = resolve;
  });

  await mockHouseholdRoutes(page, householdGate);
  await signInAs(page, "USER", "/household");

  await expect(page.getByRole("status")).toContainText(
    "Loading household access",
  );
  releaseHouseholds?.();

  await expect(
    page.getByRole("heading", { name: "Share only what you choose" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(1);
  for (const staffLink of [
    "Guide admin",
    "Privacy queue",
    "Local audit",
    "Support diagnostics",
  ]) {
    await expect(page.getByRole("link", { name: staffLink })).toHaveCount(0);
  }
  await expect(
    page.getByText(
      /Invitations and sharing stay inside this fake local workspace\. No email is sent, and members cannot edit commitments or act on a payment or provider\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("The code is never placed in a URL or browser storage.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText(/expired · expires/i)).toBeVisible();

  const removeMember = page.getByRole("button", { name: "Remove" });
  await removeMember.focus();
  await expect(removeMember).toBeFocused();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeFocused();
  await expect(
    confirmation.getByRole("heading", { name: "Remove M5 Test Member?" }),
  ).toBeVisible();
  await confirmation.getByRole("button", { name: "Keep unchanged" }).click();
  await expect(confirmation).toHaveCount(0);

  await page
    .getByRole("button", { name: "Load more household members" })
    .click();
  const paginationAlert = page.getByRole("alert").filter({
    hasText: "More members could not be loaded",
  });
  await expect(paginationAlert).toBeVisible();

  await page.getByLabel("Fake local email").fill("invitee@autopayguard.local");
  const createInvitation = page.getByRole("button", {
    name: "Create invitation code",
  });
  await createInvitation.focus();
  await expect(createInvitation).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Could not create invitation",
    }),
  ).toContainText(
    "A current privacy-notice acknowledgement and household-sharing grant are required",
  );
  const createdInvitationCode = page.locator(
    'output[aria-label="One-time invitation code"]',
  );
  await expect(createdInvitationCode).toHaveCount(0);

  await createInvitation.click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Invitation created locally. No email was sent.",
    }),
  ).toHaveText("Invitation created locally. No email was sent.");
  await expect(createdInvitationCode).toHaveText(oneTimeCode);
  await expectEmptyBrowserStorage(page);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(createdInvitationCode).toHaveCount(0);

  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page, "The M5 household hub");
  await expectNoOverflowAtTwoHundredPercent(
    page,
    testInfo,
    "The M5 household hub",
  );
});

test("privacy controls render blocked, expired, failed, and erased-data-safe lifecycle states", async ({
  page,
}, testInfo) => {
  let releasePrivacy: (() => void) | undefined;
  const privacyGate = new Promise<void>((resolve) => {
    releasePrivacy = resolve;
  });
  await mockPrivacyRoutes(page, privacyGate);
  await signInAs(page, "USER", "/settings/privacy");

  await expect(page.getByRole("status")).toContainText(
    "Loading privacy controls",
  );
  releasePrivacy?.();

  await expect(
    page.getByRole("heading", { name: "Privacy controls" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /These controls do not change Keycloak or establish legal compliance\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The generated canonical JSON is available only to your signed-in subject, is integrity-labeled, and expires within 24 hours.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Only your app-owned IANA timezone can be corrected here. Identity provider attributes and historical snapshots are unchanged.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Nothing was erased\. The current local eligibility check blocked execution/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /stored export bytes reached their retention deadline and were physically removed/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /local operation failed safely and produced no partial export or partial mutation/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Eligible app-owned data was removed; only the minimal tombstone and redacted execution audit remain/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /It contains no email, name, household, or financial content\. This does not delete your Keycloak identity/,
    ),
  ).toBeVisible();

  const exportButton = page.getByRole("button", {
    name: "Request JSON export",
  });
  await exportButton.focus();
  await expect(exportButton).toBeFocused();
  await page.keyboard.press("Enter");
  const operationAlert = page.getByRole("alert").filter({
    hasText: "That operation was not completed",
  });
  await expect(operationAlert).toContainText(
    "Too many attempts were made. Wait before trying again.",
  );

  await page.getByLabel("IANA timezone").fill("Not/AZone");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Enter a valid IANA timezone such as Asia/Kolkata.",
    }),
  ).toBeVisible();

  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page, "The M5 privacy controls");
  await expectNoOverflowAtTwoHundredPercent(
    page,
    testInfo,
    "The M5 privacy controls",
  );

  await expectEmptyBrowserStorage(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await expectEmptyBrowserStorage(page);

  await page.goto("/settings/privacy");
  await expect(page).toHaveURL("/signin?callbackUrl=%2Fdashboard");
});

test("member scope keeps shared commitments read-only and states the exact visibility boundary", async ({
  page,
}, testInfo) => {
  const memberHousehold = {
    ...ownerHousehold,
    accessRole: "MEMBER",
    canManage: false,
  };
  await page.route("**/api/bff/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/households"
    ) {
      await fulfillJson(route, {
        items: [memberHousehold],
        nextCursor: null,
      });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/household-invitations"
    ) {
      await fulfillJson(route, { items: [], nextCursor: null });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === `/api/bff/v1/households/${fixtureIds.household}/members`
    ) {
      await fulfillJson(route, {
        items: [
          {
            id: fixtureIds.member,
            userId: fixtureIds.memberUser,
            displayName: "M5 Test Member",
            role: "MEMBER",
            status: "ACTIVE",
            version: 2,
            joinedAt: fixedInstant,
            removedAt: null,
          },
        ],
        nextCursor: null,
      });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === `/api/bff/v1/commitments/${fixtureIds.sharedCommitment}`
    ) {
      await fulfillJson(route, sharedReadOnlyCommitment());
      return;
    }
    await route.fallback();
  });

  await signInAs(
    page,
    "USER",
    `/commitments/${fixtureIds.sharedCommitment}?householdId=${fixtureIds.household}`,
  );
  await expect(
    page.getByRole("heading", { name: "M5 Shared fictional plan" }),
  ).toBeVisible();
  await expect(page.getByText("Read-only household view")).toBeVisible();
  await expect(
    page.getByText(
      /Responsibility is a planning label only\. It does not grant ownership, editing, payment authority, provider access, or notification subscription\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You can view this record, but only the household owner can change it.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("edit-commitment-link")).toHaveCount(0);
  await expect(page.getByTestId("archive-commitment-button")).toHaveCount(0);
  await expect(page.getByTestId("commitment-reminders-link")).toHaveCount(0);
  await expect(page.getByTestId("cancellation-guide-link")).toHaveCount(0);
  await expectNoSeriousAxe(page);

  await page.goto(`/household?householdId=${fixtureIds.household}`);
  await expect(
    page.getByText(
      "You are a read-only member. Totals cover only records visible to you.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Owner controls stay with the founder",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /You cannot invite or remove people, change sharing, edit commitments, move money, or act with a provider\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create invitation code" }),
  ).toHaveCount(0);

  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page, "The M5 member household view");
  await expectNoOverflowAtTwoHundredPercent(
    page,
    testInfo,
    "The M5 member household view",
  );
});

test("owner support-code UI is explicit, one-time, keyboard operable, and conflict safe", async ({
  page,
}, testInfo) => {
  let createAttempts = 0;
  await page.route("**/api/bff/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/households"
    ) {
      await fulfillJson(route, { items: [ownerHousehold], nextCursor: null });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname ===
        `/api/bff/v1/households/${fixtureIds.household}/support-codes`
    ) {
      createAttempts += 1;
      if (createAttempts === 1) {
        await fulfillProblem(
          route,
          409,
          "An active support code already exists.",
        );
      } else {
        await fulfillJson(
          route,
          {
            grant: {
              id: fixtureIds.supportGrant,
              status: "ACTIVE",
              version: 0,
              expiresAt: futureInstant,
              createdAt: fixedInstant,
            },
            supportCode: oneTimeCode,
          },
          201,
        );
      }
      return;
    }
    if (
      request.method() === "DELETE" &&
      url.pathname ===
        `/api/bff/v1/households/${fixtureIds.household}/support-codes/${fixtureIds.supportGrant}`
    ) {
      await fulfillProblem(route, 412, "The support grant changed.");
      return;
    }
    await route.fallback();
  });

  await signInAs(
    page,
    "USER",
    `/settings/support?householdId=${fixtureIds.household}`,
  );
  await expect(
    page.getByRole("heading", { name: "Redacted support diagnostics" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /never names, amounts, notes, targets, credentials, or impersonation/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /No email is sent\. Transfer the code manually\. AutoPay Guard stores only its digest/,
    ),
  ).toBeVisible();

  const acknowledgement = page.getByRole("checkbox", {
    name: /I authorize temporary read-only redacted diagnostics/,
  });
  await acknowledgement.focus();
  await page.keyboard.press("Space");
  await expect(acknowledgement).toBeChecked();

  const generate = page.getByRole("button", {
    name: "Generate one-time support code",
  });
  await generate.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Support access was not changed",
    }),
  ).toContainText("An active support code already exists");

  await generate.click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Support code created. It is shown only on this page.",
    }),
  ).toBeVisible();
  await expect(page.locator("output")).toHaveText(oneTimeCode);
  await expect(
    page.getByText(
      /This plaintext is not persisted and will disappear when you leave or reload this page\. No email was sent\./,
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Revoke now" }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Support access was not changed",
    }),
  ).toContainText("This grant changed elsewhere. Reload before trying again.");
  await expect(page.locator("output")).toHaveText(oneTimeCode);

  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page, "The M5 support-code screen");
  await expectNoOverflowAtTwoHundredPercent(
    page,
    testInfo,
    "The M5 support-code screen",
  );
});

async function mockHouseholdRoutes(page: Page, householdGate: Promise<void>) {
  let invitationCreationAttempts = 0;
  await page.route("**/api/bff/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/households"
    ) {
      await householdGate;
      await fulfillJson(route, {
        items: [ownerHousehold],
        nextCursor: null,
      });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/household-invitations"
    ) {
      await fulfillJson(route, {
        items: [
          {
            id: fixtureIds.invitationExpired,
            householdId: fixtureIds.household,
            householdName: ownerHousehold.name,
            inviteeEmail: "demo@autopayguard.local",
            status: "EXPIRED",
            version: 1,
            expiresAt: expiredInstant,
            createdAt: fixedInstant,
          },
        ],
        nextCursor: null,
      });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === `/api/bff/v1/households/${fixtureIds.household}/members`
    ) {
      if (url.searchParams.has("cursor")) {
        await fulfillProblem(
          route,
          503,
          "The next fake-local member page is unavailable.",
        );
      } else {
        await fulfillJson(route, {
          items: [
            {
              id: fixtureIds.ownerMember,
              userId: fixtureIds.ownerUser,
              displayName: "M5 Test Owner",
              role: "OWNER",
              status: "ACTIVE",
              version: 0,
              joinedAt: fixedInstant,
              removedAt: null,
            },
            {
              id: fixtureIds.member,
              userId: fixtureIds.memberUser,
              displayName: "M5 Test Member",
              role: "MEMBER",
              status: "ACTIVE",
              version: 2,
              joinedAt: fixedInstant,
              removedAt: null,
            },
          ],
          nextCursor: "member-page-2",
        });
      }
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname ===
        `/api/bff/v1/households/${fixtureIds.household}/invitations`
    ) {
      await fulfillJson(route, {
        items: [
          {
            id: fixtureIds.invitationPending,
            householdId: fixtureIds.household,
            householdName: ownerHousehold.name,
            inviteeEmail: "pending@autopayguard.local",
            status: "PENDING",
            version: 0,
            expiresAt: futureInstant,
            createdAt: fixedInstant,
          },
          {
            id: fixtureIds.invitationExpired,
            householdId: fixtureIds.household,
            householdName: ownerHousehold.name,
            inviteeEmail: "expired@autopayguard.local",
            status: "EXPIRED",
            version: 1,
            expiresAt: expiredInstant,
            createdAt: fixedInstant,
          },
        ],
        nextCursor: null,
      });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname ===
        `/api/bff/v1/households/${fixtureIds.household}/invitations`
    ) {
      invitationCreationAttempts += 1;
      if (invitationCreationAttempts === 1) {
        await fulfillProblem(
          route,
          409,
          "Household sharing consent is not current.",
        );
      } else {
        await fulfillJson(
          route,
          {
            invitation: {
              id: fixtureIds.invitationPending,
              householdId: fixtureIds.household,
              householdName: ownerHousehold.name,
              inviteeEmail: "invitee@autopayguard.local",
              status: "PENDING",
              version: 0,
              expiresAt: futureInstant,
              createdAt: fixedInstant,
            },
            invitationCode: oneTimeCode,
            emailSent: false,
          },
          201,
        );
      }
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname === "/api/bff/v1/household-invitations/accept"
    ) {
      await fulfillProblem(route, 410, "The invitation expired.");
      return;
    }
    await route.fallback();
  });
}

async function mockPrivacyRoutes(page: Page, privacyGate: Promise<void>) {
  const privacyRequests = [
    privacyRequest(fixtureIds.privacyReady, "EXPORT", "READY", {
      schemaVersion: "autopay-guard-export-v1",
      sha256: "a".repeat(64),
      byteCount: 2048,
      generatedAt: fixedInstant,
      expiresAt: futureInstant,
    }),
    privacyRequest(fixtureIds.privacyBlocked, "DELETION", "BLOCKED"),
    privacyRequest(fixtureIds.privacyExpired, "EXPORT", "EXPIRED"),
    privacyRequest(
      fixtureIds.privacyFailed,
      "CORRECTION",
      "FAILED",
      null,
      "UTC",
    ),
    privacyRequest(fixtureIds.privacyExecuted, "DELETION", "EXECUTED"),
  ];
  await page.route("**/api/bff/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      await privacyGate;
      if (url.pathname === "/api/bff/v1/privacy/notices/current") {
        await fulfillJson(route, {
          noticeVersion: "privacy-v5",
          contentSha256: "b".repeat(64),
          acknowledgementType: "ACKNOWLEDGED",
        });
        return;
      }
      if (url.pathname === "/api/bff/v1/privacy/notice-acknowledgements") {
        await fulfillJson(route, {
          items: [
            {
              id: "10000000-0000-4000-8000-000000000519",
              noticeVersion: "privacy-v5",
              contentSha256: "b".repeat(64),
              eventType: "ACKNOWLEDGED",
              acknowledgedAt: fixedInstant,
            },
          ],
          nextCursor: null,
        });
        return;
      }
      if (url.pathname === "/api/bff/v1/privacy/consents") {
        await fulfillJson(route, {
          purpose: "HOUSEHOLD_SHARING",
          currentPurposeVersion: "privacy-v5",
          currentAction: "WITHDRAWN",
          events: [
            {
              id: "10000000-0000-4000-8000-000000000520",
              purpose: "HOUSEHOLD_SHARING",
              purposeVersion: "privacy-v5",
              action: "WITHDRAWN",
              occurredAt: fixedInstant,
            },
          ],
          nextCursor: null,
        });
        return;
      }
      if (url.pathname === "/api/bff/v1/privacy/requests") {
        await fulfillJson(route, {
          items: privacyRequests,
          nextCursor: null,
        });
        return;
      }
    }
    if (
      request.method() === "POST" &&
      url.pathname === "/api/bff/v1/privacy/requests"
    ) {
      await fulfillProblem(route, 429, "The local rate limit was reached.");
      return;
    }
    await route.fallback();
  });
}

function privacyRequest(
  id: string,
  requestType: "EXPORT" | "CORRECTION" | "DELETION",
  status: "READY" | "BLOCKED" | "EXPIRED" | "FAILED" | "EXECUTED",
  exportMetadata: {
    schemaVersion: "autopay-guard-export-v1";
    sha256: string;
    byteCount: number;
    generatedAt: string;
    expiresAt: string;
  } | null = null,
  correctionValue: string | null = null,
) {
  return {
    id,
    requestType,
    status,
    correctionField: requestType === "CORRECTION" ? "TIMEZONE" : null,
    correctionValue,
    version: 1,
    createdAt: fixedInstant,
    updatedAt: fixedInstant,
    completedAt: status === "READY" ? null : fixedInstant,
    export: exportMetadata,
  };
}

function sharedReadOnlyCommitment() {
  return {
    id: fixtureIds.sharedCommitment,
    householdId: fixtureIds.household,
    dataOwnerUserId: fixtureIds.ownerUser,
    responsibleMemberId: fixtureIds.member,
    merchantId: null,
    merchantCanonicalName: null,
    displayName: "M5 Shared fictional plan",
    category: "SUBSCRIPTION",
    paymentRail: "CARD_RECURRING",
    amountMinor: 50000,
    estimatedAmountMinor: null,
    currency: "INR",
    frequency: "MONTHLY",
    intervalCount: 1,
    customIntervalUnit: null,
    anchorDate: "2026-07-15",
    monthDayPolicy: "ANCHOR_DAY",
    nextDueDate: "2026-08-15",
    variableAmount: false,
    maskedPaymentLabel: null,
    source: "MANUAL",
    sourceConfidence: null,
    visibility: "HOUSEHOLD",
    status: "ACTIVE",
    version: 3,
    canManage: false,
    reviewActions: ["CANCEL_WITH_PROVIDER"],
    createdAt: fixedInstant,
    updatedAt: fixedInstant,
  };
}
