import { expect, test, type Page } from "@playwright/test";

import {
  expectEmptyBrowserStorage,
  expectNoHorizontalOverflow,
  expectNoOverflowAtTwoHundredPercent,
  expectNoSeriousAxe,
  fixedInstant,
  fixtureIds,
  fulfillJson,
  fulfillProblem,
  futureInstant,
  oneTimeCode,
  signInAs,
} from "./milestone5-test-support";

test.setTimeout(240_000);

test("GUIDE_ADMIN sees only bounded guide UI, immutable history, and stale-write recovery", async ({
  page,
}, testInfo) => {
  let releaseCatalog: (() => void) | undefined;
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  await mockGuideAdminRoutes(page, catalogGate);
  await signInAs(page, "GUIDE_ADMIN", "/admin/guides");

  await expect(page.getByRole("status")).toContainText(
    "Loading fictional guide administration",
  );
  releaseCatalog?.();

  await expect(
    page.getByRole("heading", { name: "Fictional guide administration" }),
  ).toBeVisible();
  await expectOnlyStaffNavigation(page, "Guide admin");
  await expect(
    page.getByText(
      /Publishing makes a fictional local guide current; it does not verify a merchant or link, and no provider is contacted\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /It never displays a note, user, household, commitment, identity, amount, or guide target\./,
    ),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Mark resolved" }).check();
  await page
    .getByRole("checkbox", {
      name: /I confirm this changes only the redacted feedback review disposition/,
    })
    .check();
  const saveReview = page.getByRole("button", {
    name: "Save feedback review",
  });
  await saveReview.focus();
  await expect(saveReview).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Feedback review was not saved",
    }),
  ).toContainText("This record changed in another session");
  await expectNoSeriousAxe(page);

  await page
    .getByRole("link", { name: "Open guide and immutable history" })
    .click();
  await expect(
    page.getByRole("heading", { name: "M5 Fictional StreamBox" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Earlier published versions and attempts pinned to them remain unchanged\./,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more guide versions" }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "More guide history could not be loaded",
    }),
  ).toBeVisible();
  await expectNoSeriousAxe(page);

  await page.getByRole("link", { name: "Edit allowed draft fields" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit fictional guide text" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /All identifiers, merchant data, versions, status, timestamps, tracks, sequence, action types, targets, allowlists, and catalog-head state remain immutable and server controlled\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /It never means a merchant or link was verified, and it does not contact a provider\./,
    ),
  ).toBeVisible();
  await page
    .getByLabel("Risk notice")
    .fill("Updated fictional local risk notice for a stale-write test.");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Save or discard editable changes before publishing.",
    }),
  ).toBeVisible();
  const saveDraft = page.getByRole("button", { name: "Save draft text" });
  await saveDraft.focus();
  await page.keyboard.press("Enter");
  const staleDraft = page.getByRole("alert").filter({
    hasText: "Draft operation was not completed",
  });
  await expect(staleDraft).toContainText(
    "This draft changed in another session. Your unsaved text remains on screen",
  );
  await expect(page.getByLabel("Risk notice")).toHaveValue(
    "Updated fictional local risk notice for a stale-write test.",
  );
  await expect(
    staleDraft.getByRole("button", { name: "Reload latest draft" }),
  ).toBeVisible();

  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page, "The M5 guide-admin draft");
  await expectNoOverflowAtTwoHundredPercent(
    page,
    testInfo,
    "The M5 guide-admin draft",
  );
  await signOutAndExpectProtectedRedirect(
    page,
    `/admin/guides/drafts/${fixtureIds.draft}`,
  );
});

test("PRIVACY_ADMIN handles conflict then blocked execution without deletion claims", async ({
  page,
}, testInfo) => {
  let releaseQueue: (() => void) | undefined;
  const queueGate = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  let executeAttempts = 0;
  let blocked = false;

  await page.route("**/api/bff/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/admin/privacy/requests"
    ) {
      await queueGate;
      await fulfillJson(route, {
        items: [privacyAdminRequest(blocked ? "BLOCKED" : "REQUESTED")],
        nextCursor: null,
      });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname ===
        `/api/bff/v1/admin/privacy/requests/${fixtureIds.privacyBlocked}/execute`
    ) {
      executeAttempts += 1;
      if (executeAttempts === 1) {
        await fulfillProblem(route, 412, "The request changed elsewhere.");
      } else {
        blocked = true;
        await fulfillJson(route, privacyAdminRequest("BLOCKED"));
      }
      return;
    }
    await route.fallback();
  });

  await signInAs(page, "PRIVACY_ADMIN", "/admin/privacy");
  await expect(page.getByRole("status")).toContainText(
    "Loading privacy request queue",
  );
  releaseQueue?.();

  await expect(
    page.getByRole("heading", { name: "Privacy request queue" }),
  ).toBeVisible();
  await expectOnlyStaffNavigation(page, "Privacy queue");
  await expect(
    page.getByText(
      /This authority does not grant export download, household membership, audit access, support access, or identity-provider deletion\./,
    ),
  ).toBeVisible();

  await page
    .getByRole("radio", { name: "Select for conditional execution" })
    .check();
  const execute = page.getByRole("button", {
    name: "Execute conditional local operation",
  });
  await expect(execute).toBeDisabled();
  await page.getByLabel("Type EXECUTE DELETION").fill("EXECUTE DELETION");
  await execute.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Request not executed" }),
  ).toContainText(
    "The request changed in another session. Refresh before executing.",
  );

  await execute.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(
    "Execution was safely blocked; household and user data were preserved.",
  );
  await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Select for conditional execution" }),
  ).toHaveCount(0);

  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page, "The M5 privacy-admin queue");
  await expectNoOverflowAtTwoHundredPercent(
    page,
    testInfo,
    "The M5 privacy-admin queue",
  );
  await signOutAndExpectProtectedRedirect(page, "/admin/privacy");
});

test("AUDIT_READ sees empty, ready, and pagination-error states with redacted fields only", async ({
  page,
}, testInfo) => {
  let releaseAudit: (() => void) | undefined;
  const auditGate = new Promise<void>((resolve) => {
    releaseAudit = resolve;
  });
  let auditState: "empty" | "ready" = "empty";

  await page.route("**/api/bff/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/admin/audit-events"
    ) {
      await auditGate;
      if (url.searchParams.has("cursor")) {
        await fulfillProblem(
          route,
          503,
          "The older redacted audit page is unavailable.",
        );
      } else if (auditState === "empty") {
        await fulfillJson(route, { items: [], nextCursor: null });
      } else {
        await fulfillJson(route, {
          items: [
            {
              id: fixtureIds.audit,
              occurredAt: fixedInstant,
              actorRole: "USER",
              action: "PRIVACY_EXPORT_DOWNLOADED",
              resourceType: "PRIVACY_REQUEST",
              resourceId: fixtureIds.privacyReady,
              outcome: "SUCCEEDED",
              correlationId: fixtureIds.correlation,
            },
          ],
          nextCursor: "older-audit-page",
        });
      }
      return;
    }
    await route.fallback();
  });

  await signInAs(page, "AUDIT_READ", "/admin/audit");
  await expect(page.getByRole("status")).toContainText(
    "Loading redacted audit events",
  );
  releaseAudit?.();

  await expect(
    page.getByRole("heading", { name: "Local application audit" }),
  ).toBeVisible();
  await expectOnlyStaffNavigation(page, "Local audit");
  await expect(page.getByText("No audit events")).toBeVisible();
  await expect(
    page.getByText("The bounded local event view is empty."),
  ).toBeVisible();

  auditState = "ready";
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "PRIVACY_EXPORT_DOWNLOADED" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /it contains no identity, title, amount, note, request body, target, token, code, digest, or export content\./i,
    ),
  ).toBeVisible();
  await expect(page.getByText("M5 Test Owner")).toHaveCount(0);
  await expect(page.locator("#main-content")).not.toContainText("₹");

  await page.getByRole("button", { name: "Load older events" }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "The older redacted audit page is unavailable.",
    }),
  ).toContainText("The older redacted audit page is unavailable.");

  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page, "The M5 redacted audit table");
  await expectNoOverflowAtTwoHundredPercent(
    page,
    testInfo,
    "The M5 redacted audit table",
  );
  await signOutAndExpectProtectedRedirect(page, "/admin/audit");
});

test("SUPPORT_READ needs the owner code and exposes only bounded diagnostics", async ({
  page,
}, testInfo) => {
  let resolveAttempts = 0;
  await page.route("**/api/bff/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.pathname === "/api/bff/v1/support/diagnostics/resolve"
    ) {
      resolveAttempts += 1;
      if (resolveAttempts === 1) {
        await fulfillProblem(route, 410, "The support grant expired.");
      } else {
        await fulfillJson(route, {
          schemaVersion: "support-diagnostics-v1",
          status: "HEALTHY",
          activeCommitmentCount: 4,
          failedNotificationCount: 0,
          pendingPrivacyRequestCount: 1,
          latestCommitmentVersion: 7,
          generatedAt: fixedInstant,
          grantExpiresAt: futureInstant,
        });
      }
      return;
    }
    await route.fallback();
  });

  await signInAs(page, "SUPPORT_READ", "/support/diagnostics");
  await expect(
    page.getByRole("heading", { name: "Redacted local diagnostics" }),
  ).toBeVisible();
  await expectOnlyStaffNavigation(page, "Support diagnostics");
  await expect(
    page.getByText(
      /no account search, impersonation, raw logs, message retry, resend, or household mutation/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("and it is not proof of incident resolution.", {
      exact: false,
    }),
  ).toBeVisible();

  const codeInput = page.getByLabel("Owner-provided support code");
  const resolve = page.getByRole("button", {
    name: "Open redacted diagnostics",
  });
  await expect(async () => {
    await codeInput.press("ControlOrMeta+A");
    await codeInput.press("Backspace");
    await codeInput.pressSequentially(oneTimeCode);
    await expect(resolve).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await resolve.press("Enter");
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "The role/code pair is invalid, revoked, expired, or unavailable.",
    }),
  ).toHaveText(
    "The role/code pair is invalid, revoked, expired, or unavailable.",
  );
  await expect(
    page.getByRole("heading", { name: "Bounded workspace state" }),
  ).toHaveCount(0);

  await resolve.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Bounded workspace state" }),
  ).toBeVisible();
  await expect(page.getByText("Active commitments")).toBeVisible();
  await expect(page.getByText("4", { exact: true })).toBeVisible();
  await expect(codeInput).toHaveValue("");
  await expect(page.getByText("M5 Test Owner")).toHaveCount(0);
  await expect(page.locator("#main-content")).not.toContainText("₹");

  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page, "The M5 support diagnostics");
  await expectNoOverflowAtTwoHundredPercent(
    page,
    testInfo,
    "The M5 support diagnostics",
  );
  await signOutAndExpectProtectedRedirect(page, "/support/diagnostics");
});

async function signOutAndExpectProtectedRedirect(
  page: Page,
  protectedPath: string,
) {
  await expectEmptyBrowserStorage(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await expectEmptyBrowserStorage(page);
  await page.goto(protectedPath);
  await expect(page).toHaveURL("/signin?callbackUrl=%2Fdashboard");
}

async function expectOnlyStaffNavigation(page: Page, expected: string) {
  await expect(page.getByRole("link", { name: expected })).toHaveCount(1);
  for (const unavailable of [
    "Dashboard",
    "Commitments",
    "Upcoming",
    "Notifications",
    "Household",
    "Guide admin",
    "Privacy queue",
    "Local audit",
    "Support diagnostics",
  ]) {
    if (unavailable !== expected) {
      await expect(page.getByRole("link", { name: unavailable })).toHaveCount(
        0,
      );
    }
  }
}

async function mockGuideAdminRoutes(page: Page, catalogGate: Promise<void>) {
  await page.route("**/api/bff/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/admin/cancellation-guides"
    ) {
      await catalogGate;
      await fulfillJson(route, { items: [guideSummary()] });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === "/api/bff/v1/admin/cancellation-guide-feedback"
    ) {
      await fulfillJson(route, {
        items: [
          {
            id: fixtureIds.feedback,
            guideId: fixtureIds.guide,
            guideVersion: 3,
            outcome: "OUTDATED",
            createdAt: fixedInstant,
            disposition: "PENDING",
            version: 0,
          },
        ],
        nextCursor: null,
      });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname ===
        `/api/bff/v1/admin/cancellation-guide-feedback/${fixtureIds.feedback}/review`
    ) {
      await fulfillProblem(route, 412, "The feedback changed elsewhere.");
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname ===
        `/api/bff/v1/admin/cancellation-guides/${fixtureIds.guide}`
    ) {
      await fulfillJson(route, guideSummary());
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname ===
        `/api/bff/v1/admin/cancellation-guides/${fixtureIds.guide}/versions`
    ) {
      if (url.searchParams.has("cursor")) {
        await fulfillProblem(
          route,
          503,
          "The next immutable-history page is unavailable.",
        );
      } else {
        await fulfillJson(route, {
          items: [
            {
              guideId: fixtureIds.guide,
              guideVersion: 3,
              status: "DRAFT",
              riskNotice: "Fictional local guidance only.",
              structuralReviewedAt: fixedInstant,
              reviewIntervalDays: 45,
              publishedAt: null,
              createdAt: fixedInstant,
              draftId: fixtureIds.draft,
              draftVersion: 2,
            },
            {
              guideId: fixtureIds.guide,
              guideVersion: 2,
              status: "PUBLISHED",
              riskNotice: "Fictional local guidance only.",
              structuralReviewedAt: fixedInstant,
              reviewIntervalDays: 45,
              publishedAt: fixedInstant,
              createdAt: fixedInstant,
              draftId: null,
              draftVersion: null,
            },
          ],
          nextCursor: "next-version-page",
        });
      }
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname ===
        `/api/bff/v1/admin/cancellation-guide-drafts/${fixtureIds.draft}`
    ) {
      await fulfillJson(route, guideDraft());
      return;
    }
    if (
      request.method() === "PATCH" &&
      url.pathname ===
        `/api/bff/v1/admin/cancellation-guide-drafts/${fixtureIds.draft}`
    ) {
      await fulfillProblem(route, 412, "The draft changed elsewhere.");
      return;
    }
    await route.fallback();
  });
}

function guideSummary() {
  return {
    guideId: fixtureIds.guide,
    merchantId: "10000000-0000-4000-8000-000000000521",
    merchantName: "M5 Fictional StreamBox",
    merchantCategory: "SUBSCRIPTION",
    state: "ACTIVE",
    currentPublishedVersion: 2,
    version: 7,
    updatedAt: fixedInstant,
  };
}

function guideDraft() {
  return {
    draftId: fixtureIds.draft,
    guideId: fixtureIds.guide,
    guideVersion: 3,
    status: "DRAFT",
    riskNotice: "Fictional local guidance only.",
    structuralReviewedAt: fixedInstant,
    reviewIntervalDays: 45,
    steps: [
      draftStep("SERVICE", 1, "Open the fake merchant page"),
      draftStep("SERVICE", 2, "Record the fake merchant result"),
      draftStep("PAYMENT_MANDATE", 1, "Review the fake mandate"),
      draftStep("PAYMENT_MANDATE", 2, "Record the fake mandate result"),
    ],
    version: 2,
    createdAt: fixedInstant,
    updatedAt: fixedInstant,
  };
}

function draftStep(
  track: "SERVICE" | "PAYMENT_MANDATE",
  sequenceNumber: number,
  title: string,
) {
  return {
    track,
    sequenceNumber,
    actionType: "INFORMATION",
    title,
    instruction:
      "Use only the fictional local fixture and record what you observe.",
    targetKey: null,
    targetUri: null,
  };
}

function privacyAdminRequest(status: "REQUESTED" | "BLOCKED") {
  return {
    id: fixtureIds.privacyBlocked,
    requestType: "DELETION",
    status,
    correctionField: null,
    correctionValue: null,
    version: status === "REQUESTED" ? 0 : 1,
    createdAt: fixedInstant,
    updatedAt: fixedInstant,
    completedAt: status === "BLOCKED" ? fixedInstant : null,
    export: null,
  };
}
