import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const fakeUserEmail = requiredFakeIdentity("E2E_USER_EMAIL");
const fakeUserPassword = requiredEnvironment("E2E_USER_PASSWORD");

test.setTimeout(420_000);

test("records a cancellation journey without claiming provider action", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  const projectLabel = mobile ? "Mobile" : "Desktop";
  const runToken = alphabeticRunToken(Date.now());
  const flowName = `M4E2E${projectLabel}${runToken}`.padEnd(120, "X");
  const unsafeName = `M4 E2E Unsafe Feedback ${projectLabel} ${runToken}`;
  const flowMerchantId = mobile
    ? "10000000-0000-4000-8000-000000000002"
    : "10000000-0000-4000-8000-000000000001";
  const flowMerchantHost = mobile ? "cloudnest.example" : "streambox.example";
  const flowCategory = mobile ? "SOFTWARE" : "SUBSCRIPTION";
  const unsafeMerchantId = mobile
    ? "10000000-0000-4000-8000-000000000005"
    : "10000000-0000-4000-8000-000000000004";
  const unsafeCategory = mobile ? "MEMBERSHIP" : "SUBSCRIPTION";

  await signIn(page);
  const household = await selectOwnedWorkspace(page);
  const anchorDate = localDateInZone(Date.now(), household.timezone);
  let flowCommitmentId: string | null = null;
  let unsafeCommitmentId: string | null = null;
  let attemptId: string | null = null;
  let cleanedUp = false;

  try {
    const flowCommitment = await createCommitment(page, {
      householdId: household.id,
      merchantId: flowMerchantId,
      category: flowCategory,
      displayName: flowName,
      anchorDate,
    });
    flowCommitmentId = flowCommitment.id;
    const unsafeCommitment = await createCommitment(page, {
      householdId: household.id,
      merchantId: unsafeMerchantId,
      category: unsafeCategory,
      displayName: unsafeName,
      anchorDate,
    });
    unsafeCommitmentId = unsafeCommitment.id;
    const projectionBaseline = await readDashboardSummary(
      page,
      household.id,
      anchorDate.slice(0, 7),
    );

    const month = anchorDate.slice(0, 7);
    await page.goto(`/upcoming?householdId=${household.id}&month=${month}`);
    await expect(
      page.getByRole("heading", { name: "Know what is expected, and when" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Open decision inbox" }).click();
    await expect(
      page.getByRole("heading", { name: "Record what you plan to do" }),
    ).toBeVisible();
    await expect(
      page.getByText(/does not contact a provider, change a payment mandate/),
    ).toBeVisible();
    await expectNoSeriousAxe(page);
    await expectNoHorizontalOverflow(page, "The decision inbox");

    const flowCard = decisionCard(page, flowName);
    await flowCard
      .getByRole("radio", { name: /Plan to cancel with provider/ })
      .check();
    const reviewDecision = flowCard.getByRole("button", {
      name: "Review decision",
    });
    await reviewDecision.focus();
    await expect(reviewDecision).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      flowCard.getByText(/appends a new decision record/),
    ).toBeVisible();
    const decisionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/decisions"),
    );
    await flowCard.getByRole("button", { name: "Record decision" }).click();
    const decisionResponse = await decisionResponsePromise;
    expect(decisionResponse.status()).toBe(201);
    await expect(
      flowCard.getByText("Decision recorded. Tracking continues."),
    ).toBeVisible();

    await flowCard
      .getByRole("link", { name: /Review cancellation guide/ })
      .click();
    await expect(
      page.getByRole("heading", { name: `${flowName} cancellation guide` }),
    ).toBeVisible();
    await expect(
      page.getByText(/Structurally reviewed as a fictional fixture/),
    ).toBeVisible();
    await expect(page.getByLabel("Guide risk notice")).toContainText(
      "Fictional local guidance only.",
    );
    await expect(
      page.getByRole("heading", { name: "Merchant service" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Payment mandate" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "A payment-mandate action does not itself cancel the merchant service.",
      ),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, "The cancellation guide");
    const httpsTarget = page.locator(
      `a[href="https://${flowMerchantHost}/manage/subscription"]`,
    );
    await expect(httpsTarget).toHaveCount(1);
    await expect(httpsTarget).toHaveAttribute("target", "_blank");
    await expect(httpsTarget).toHaveAttribute("rel", "noopener noreferrer");
    await expect(
      page.locator('a[href="autopayguard-demo://mandates/service/manage"]'),
    ).toHaveCount(1);
    await expect(page.getByText(/merchant-verified/i)).toHaveCount(0);
    await expectNoSeriousAxe(page);

    await page.getByRole("button", { name: "Start attempt" }).click();
    await expect(
      page.getByText(/does not open a target, contact a provider/),
    ).toBeVisible();
    const attemptResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/cancellation-attempts$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "Start tracking attempt" }).click();
    const attemptResponse = await attemptResponsePromise;
    expect(attemptResponse.status()).toBe(201);
    const attemptRequest = attemptResponse.request();
    const attemptKey = attemptRequest.headers()["idempotency-key"];
    const attemptBody = attemptRequest.postDataJSON() as AttemptCreateBody;
    expect(attemptKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9._~-]{15,99}$/);
    await expect(page).toHaveURL(/\/cancellation\/attempts\/[0-9a-f-]{36}/i);
    attemptId = attemptIdFromUrl(page.url());

    await assertAttemptIdempotency(
      page,
      flowCommitment.id,
      attemptId,
      attemptKey,
      attemptBody,
    );
    expect(await readSavingsState(page, household.id, attemptId)).toBe(
      "POTENTIAL",
    );
    await expect(
      page.getByText("The follow-up date is", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText(/has no bank feed/)).toBeVisible();
    await expectNoSeriousAxe(page);

    await makeAttemptVersionStale(page, attemptId);
    await page.getByLabel("Merchant-service track").selectOption("CONFIRMED");
    await page.getByLabel("Payment-mandate track").selectOption("CONFIRMED");
    const staleResponsePromise = waitForAttemptPatch(page, attemptId);
    await page.getByRole("button", { name: "Save track progress" }).click();
    expect((await staleResponsePromise).status()).toBe(412);
    const conflict = page.getByRole("alert");
    await expect(
      conflict.getByText("A newer version exists", { exact: true }),
    ).toBeVisible();
    await expectNoSeriousAxe(page);

    const reloadPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname.endsWith(
          `/cancellation-attempts/${attemptId}`,
        ),
    );
    await conflict
      .getByRole("button", { name: "Reload latest version" })
      .click();
    expect((await reloadPromise).ok()).toBe(true);
    await page.getByLabel("Merchant-service track").selectOption("CONFIRMED");
    await page.getByLabel("Payment-mandate track").selectOption("CONFIRMED");
    const saveResponsePromise = waitForAttemptPatch(page, attemptId);
    await page.getByRole("button", { name: "Save track progress" }).click();
    expect((await saveResponsePromise).status()).toBe(200);
    await expect(page.getByText("Track progress saved.")).toBeVisible();

    await page
      .getByRole("radio", { name: /External steps self-reported/ })
      .check();
    await page.getByRole("button", { name: "Review outcome" }).click();
    await expect(
      page.getByText(/your attestation only and does not change/),
    ).toBeVisible();
    const verificationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(
          `/cancellation-attempts/${attemptId}/verify`,
        ),
    );
    await page.getByRole("button", { name: "Record outcome" }).click();
    expect((await verificationResponsePromise).status()).toBe(200);
    await expect(
      page.getByText("External steps recorded as self-reported, not verified."),
    ).toBeVisible();
    await expect(
      page.getByText(/does not archive this commitment/),
    ).toBeVisible();
    expect(await readSavingsState(page, household.id, attemptId)).toBe(
      "SELF_REPORTED",
    );
    expect(
      await readDashboardSummary(page, household.id, anchorDate.slice(0, 7)),
    ).toEqual(projectionBaseline);

    await page.getByRole("link", { name: "Savings records" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Honest savings" }),
    ).toBeVisible();
    await expect(
      page.getByText(/never added into one headline total/),
    ).toBeVisible();
    const savingsRecord = page
      .locator(".savings-records li")
      .filter({ hasText: flowName });
    await expect(savingsRecord).toHaveCount(1);
    await expect(
      savingsRecord.getByText("External steps self-reported"),
    ).toBeVisible();
    await expect(page.getByText("Potential only").first()).toBeVisible();
    await expect(
      page.getByText("External steps self-reported").first(),
    ).toBeVisible();
    await expect(page.getByText(/total saved/i)).toHaveCount(0);
    await expectNoSeriousAxe(page);
    await expectNoHorizontalOverflow(page, "The savings page");
    await expectContractMaximumSavingsToFit(page);

    const unsafeDecision = await createCancellationDecision(
      page,
      household.id,
      unsafeCommitment.id,
      anchorDate,
    );
    await page.goto(
      `/commitments/${unsafeCommitment.id}/cancellation?householdId=${household.id}`,
    );
    await expect(
      page.getByRole("heading", { name: `${unsafeName} cancellation guide` }),
    ).toBeVisible();
    const unsafeGuide = await readGuide(page, unsafeCommitment.id);
    {
      testInfo.annotations.push({
        type: "unsafe-guide-state",
        description: unsafeGuide.targetsSuppressed
          ? "Guide began owner-suppressed from an earlier run; feedback create, replay, and mismatch were exercised again."
          : "Guide began unsuppressed; feedback create, replay, and mismatch were exercised.",
      });
      await page.getByLabel("Feedback").selectOption("UNSAFE_LINK");
      const feedbackResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/cancellation-guides\/[0-9a-f-]{36}\/feedback$/i.test(
            new URL(response.url()).pathname,
          ),
      );
      await page.getByRole("button", { name: "Submit guide feedback" }).click();
      const feedbackResponse = await feedbackResponsePromise;
      expect(feedbackResponse.status()).toBe(204);
      const feedbackRequest = feedbackResponse.request();
      const feedbackKey = feedbackRequest.headers()["idempotency-key"];
      const feedbackBody = feedbackRequest.postDataJSON() as FeedbackCreateBody;
      expect(feedbackKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9._~-]{15,99}$/);
      await assertFeedbackIdempotency(
        page,
        unsafeGuide.id,
        feedbackKey,
        feedbackBody,
      );
    }
    await expect(page.getByText("Guide targets withheld")).toBeVisible();
    await expect(page.locator(".guide-target-link")).toHaveCount(0);
    await expect(page.getByText("External demo target withheld")).toHaveCount(
      2,
    );
    await assertUnsafeGuideBlocksAttempt(page, {
      commitmentId: unsafeCommitment.id,
      occurrenceId: unsafeDecision.occurrenceId,
      decisionId: unsafeDecision.id,
      guideId: unsafeGuide.id,
      guideVersion: unsafeGuide.version,
    });
    await expectNoSeriousAxe(page);

    await cleanupCreatedCommitments(page, household.id, [
      flowCommitment.id,
      unsafeCommitment.id,
    ]);
    cleanedUp = true;

    const browserStorage = await page.evaluate(() => {
      const entries = (storage: Storage) =>
        Array.from({ length: storage.length }, (_, index) => {
          const key = storage.key(index) ?? "";
          return [key, storage.getItem(key)] as const;
        });
      return {
        local: entries(localStorage),
        session: entries(sessionStorage),
      };
    });
    expect(browserStorage).toEqual({ local: [], session: [] });

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    for (const protectedPath of [
      `/upcoming/decisions?householdId=${household.id}`,
      `/commitments/${flowCommitment.id}/cancellation?householdId=${household.id}`,
      `/commitments/${flowCommitment.id}/cancellation/attempts/${attemptId}?householdId=${household.id}`,
      `/dashboard/savings?householdId=${household.id}`,
    ]) {
      await page.goto(protectedPath);
      await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fdashboard$/);
    }
  } finally {
    if (!cleanedUp) {
      await cleanupCreatedCommitments(
        page,
        household.id,
        [flowCommitmentId, unsafeCommitmentId].filter(
          (commitmentId): commitmentId is string => commitmentId !== null,
        ),
      );
    }
  }
});

interface HouseholdScope {
  id: string;
  timezone: string;
}

interface CreatedCommitment {
  id: string;
  version: number;
}

interface AttemptCreateBody {
  occurrenceId: string;
  decisionId: string;
  guideId: string;
  guideVersion: number;
  note: string | null;
}

interface GuideSummary {
  id: string;
  version: number;
  targetsSuppressed: boolean;
}

interface FeedbackCreateBody {
  commitmentId: string;
  guideVersion: number;
  outcome: "WORKED" | "OUTDATED" | "MERCHANT_CHANGED_FLOW" | "UNSAFE_LINK";
  note: string | null;
}

function alphabeticRunToken(value: number) {
  return value
    .toString(36)
    .replace(/[0-9]/g, (digit) =>
      String.fromCharCode("a".charCodeAt(0) + Number(digit)),
    );
}

function decisionCard(page: Page, displayName: string) {
  return page.locator("article.decision-card").filter({
    has: page.getByRole("heading", { name: displayName, exact: true }),
  });
}

async function createCommitment(
  page: Page,
  input: {
    householdId: string;
    merchantId: string;
    category: "SUBSCRIPTION" | "MEMBERSHIP" | "SOFTWARE";
    displayName: string;
    anchorDate: string;
  },
): Promise<CreatedCommitment> {
  return page.evaluate(async (request) => {
    const response = await fetch("/api/bff/v1/commitments", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        householdId: request.householdId,
        merchantId: request.merchantId,
        displayName: request.displayName,
        category: request.category,
        paymentRail: "CARD_RECURRING",
        amountMinor: 49900,
        estimatedAmountMinor: null,
        currency: "INR",
        frequency: "MONTHLY",
        intervalCount: 1,
        customIntervalUnit: null,
        anchorDate: request.anchorDate,
        monthDayPolicy: "ANCHOR_DAY",
        variableAmount: false,
        maskedPaymentLabel: null,
      }),
    });
    if (response.status !== 201) {
      let problemSummary = "";
      try {
        const problem = (await response.json()) as {
          title?: unknown;
          detail?: unknown;
        };
        problemSummary = [problem.title, problem.detail]
          .filter((value): value is string => typeof value === "string")
          .join(": ")
          .slice(0, 240);
      } catch {
        // The status remains sufficient when the response is not Problem Details.
      }
      throw new Error(
        `M4 commitment creation failed with ${response.status}${
          problemSummary ? `: ${problemSummary}` : ""
        }.`,
      );
    }
    const body = (await response.json()) as {
      id: string;
      householdId: string;
      displayName: string;
      version: number;
    };
    if (
      body.householdId !== request.householdId ||
      body.displayName !== request.displayName ||
      !Number.isSafeInteger(body.version)
    ) {
      throw new Error("M4 commitment creation returned unexpected state.");
    }
    return { id: body.id, version: body.version };
  }, input);
}

async function readDashboardSummary(
  page: Page,
  householdId: string,
  month: string,
) {
  return page.evaluate(
    async ({ householdId, month }) => {
      const query = new URLSearchParams({ householdId, month });
      const response = await fetch(
        `/api/bff/v1/dashboard/summary?${query.toString()}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`Dashboard comparison failed with ${response.status}.`);
      }
      return (await response.json()) as Record<string, unknown>;
    },
    { householdId, month },
  );
}

async function readSavingsState(
  page: Page,
  householdId: string,
  attemptId: string,
) {
  return page.evaluate(
    async ({ householdId, attemptId }) => {
      const query = new URLSearchParams({ householdId, limit: "100" });
      const response = await fetch(`/api/bff/v1/savings?${query.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Savings preflight failed with ${response.status}.`);
      }
      const body = (await response.json()) as {
        items: Array<{ attemptId: string; state: string }>;
      };
      const item = body.items.find(
        (candidate) => candidate.attemptId === attemptId,
      );
      if (!item) {
        throw new Error("The expected savings item was not returned.");
      }
      return item.state;
    },
    { householdId, attemptId },
  );
}

async function assertAttemptIdempotency(
  page: Page,
  commitmentId: string,
  expectedAttemptId: string,
  idempotencyKey: string,
  body: AttemptCreateBody,
) {
  const result = await page.evaluate(
    async ({ commitmentId, expectedAttemptId, idempotencyKey, body }) => {
      const path = `/api/bff/v1/commitments/${encodeURIComponent(commitmentId)}/cancellation-attempts`;
      const send = async (payload: AttemptCreateBody) => {
        const response = await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(payload),
        });
        const responseBody = (await response.json().catch(() => null)) as {
          id?: string;
        } | null;
        return { status: response.status, id: responseBody?.id ?? null };
      };
      return {
        replay: await send(body),
        mismatch: await send({
          ...body,
          note: "Different safe retry payload.",
        }),
        expectedAttemptId,
      };
    },
    { commitmentId, expectedAttemptId, idempotencyKey, body },
  );
  expect(result.replay).toEqual({ status: 201, id: expectedAttemptId });
  expect(result.mismatch.status).toBe(409);
}

async function makeAttemptVersionStale(page: Page, attemptId: string) {
  await page.evaluate(async (selectedAttemptId) => {
    const path = `/api/bff/v1/cancellation-attempts/${encodeURIComponent(selectedAttemptId)}`;
    const current = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!current.ok) {
      throw new Error(`Attempt preflight failed with ${current.status}.`);
    }
    const body = (await current.json()) as {
      id: string;
      version: number;
      serviceStatus: string;
      paymentMandateStatus: string;
    };
    const updated = await fetch(path, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "if-match": `"${body.version}"`,
      },
      body: JSON.stringify({
        serviceStatus: "REQUESTED",
        paymentMandateStatus: "REQUESTED",
        abandoned: false,
      }),
    });
    if (updated.status !== 200) {
      throw new Error(
        `Attempt stale-writer setup failed with ${updated.status}.`,
      );
    }
  }, attemptId);
}

function waitForAttemptPatch(page: Page, attemptId: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.endsWith(
        `/cancellation-attempts/${attemptId}`,
      ),
  );
}

async function createCancellationDecision(
  page: Page,
  householdId: string,
  commitmentId: string,
  scheduledDate: string,
) {
  return page.evaluate(
    async ({ householdId, commitmentId, scheduledDate }) => {
      const query = new URLSearchParams({
        householdId,
        from: scheduledDate,
        to: scheduledDate,
        limit: "100",
      });
      const inbox = await fetch(
        `/api/bff/v1/decisions/inbox?${query.toString()}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!inbox.ok) {
        throw new Error(`Decision preflight failed with ${inbox.status}.`);
      }
      const page = (await inbox.json()) as {
        items: Array<{ occurrenceId: string; commitmentId: string }>;
      };
      const item = page.items.find(
        (candidate) => candidate.commitmentId === commitmentId,
      );
      if (!item) {
        throw new Error("The unsafe-guide occurrence was not generated.");
      }
      const response = await fetch(
        `/api/bff/v1/occurrences/${encodeURIComponent(item.occurrenceId)}/decisions`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `unsafe-decision-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ decision: "CANCEL_WITH_PROVIDER" }),
        },
      );
      if (response.status !== 201) {
        throw new Error(
          `Unsafe-guide decision failed with ${response.status}.`,
        );
      }
      return (await response.json()) as {
        id: string;
        occurrenceId: string;
      };
    },
    { householdId, commitmentId, scheduledDate },
  );
}

async function readGuide(
  page: Page,
  commitmentId: string,
): Promise<GuideSummary> {
  return page.evaluate(async (selectedCommitmentId) => {
    const response = await fetch(
      `/api/bff/v1/commitments/${encodeURIComponent(selectedCommitmentId)}/cancellation-guide`,
      { credentials: "same-origin", cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`Guide preflight failed with ${response.status}.`);
    }
    return (await response.json()) as GuideSummary;
  }, commitmentId);
}

async function assertUnsafeGuideBlocksAttempt(
  page: Page,
  input: {
    commitmentId: string;
    occurrenceId: string;
    decisionId: string;
    guideId: string;
    guideVersion: number;
  },
) {
  const result = await page.evaluate(async (request) => {
    const response = await fetch(
      `/api/bff/v1/commitments/${encodeURIComponent(request.commitmentId)}/cancellation-attempts`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `unsafe-attempt-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          occurrenceId: request.occurrenceId,
          decisionId: request.decisionId,
          guideId: request.guideId,
          guideVersion: request.guideVersion,
          note: null,
        }),
      },
    );
    const rawBody = await response.text();
    let problem: {
      type?: unknown;
      title?: unknown;
      status?: unknown;
      detail?: unknown;
      correlationId?: unknown;
    } | null = null;
    try {
      problem = JSON.parse(rawBody) as typeof problem;
    } catch {
      // The assertions below require a JSON problem response.
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      correlationId: response.headers.get("x-correlation-id"),
      rawBody,
      problem,
    };
  }, input);
  expect(result.status).toBe(409);
  expect(result.contentType).toContain("application/problem+json");
  expect(result.correlationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(result.problem).toMatchObject({
    type: "https://autopayguard.local/problems/conflict",
    title: expect.any(String),
    status: 409,
    detail: expect.any(String),
    correlationId: result.correlationId,
  });
  expect(result.rawBody).not.toMatch(
    /autopayguard-demo:\/\/|\.example\b|\/manage\/subscription/i,
  );
}

async function assertFeedbackIdempotency(
  page: Page,
  guideId: string,
  idempotencyKey: string,
  body: FeedbackCreateBody,
) {
  const result = await page.evaluate(
    async ({ guideId, idempotencyKey, body }) => {
      const path = `/api/bff/v1/cancellation-guides/${encodeURIComponent(guideId)}/feedback`;
      const send = async (payload: FeedbackCreateBody) => {
        const response = await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(payload),
        });
        return {
          status: response.status,
          correlationId: response.headers.get("x-correlation-id"),
        };
      };
      return {
        replay: await send(body),
        mismatch: await send({
          ...body,
          note: "Different safe feedback payload.",
        }),
      };
    },
    { guideId, idempotencyKey, body },
  );
  expect(result.replay.status).toBe(204);
  expect(result.replay.correlationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(result.mismatch.status).toBe(409);
  expect(result.mismatch.correlationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
}

async function cleanupCommitment(
  page: Page,
  householdId: string,
  commitmentId: string,
) {
  await page.evaluate(
    async ({ householdId, commitmentId }) => {
      const canonicalFixtureNames = new Set([
        "M2 Fixture StreamBox Demo",
        "M2 Fixture CloudNest Demo",
        "M2 Fixture FitClub Demo",
        "M2 Fixture Monsoon Utility Demo",
      ]);
      const path = `/api/bff/v1/commitments/${encodeURIComponent(commitmentId)}`;
      const preflight = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (preflight.status === 404) {
        return;
      }
      if (!preflight.ok) {
        throw new Error(
          `M4 commitment cleanup preflight failed with ${preflight.status}.`,
        );
      }
      const preflightCommitment = (await preflight.json()) as {
        displayName: string;
      };
      if (canonicalFixtureNames.has(preflightCommitment.displayName)) {
        throw new Error(
          `Refusing to alter canonical fixture ${preflightCommitment.displayName}.`,
        );
      }

      const attemptQuery = new URLSearchParams({
        householdId,
        limit: "100",
      });
      const attemptsResponse = await fetch(
        `/api/bff/v1/commitments/${encodeURIComponent(commitmentId)}/cancellation-attempts?${attemptQuery.toString()}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (attemptsResponse.ok) {
        const attempts = (await attemptsResponse.json()) as {
          items: Array<{
            id: string;
            version: number;
            serviceStatus: string;
            paymentMandateStatus: string;
            verificationStatus: string;
            abandoned: boolean;
          }>;
        };
        for (const attempt of attempts.items) {
          if (attempt.abandoned || attempt.verificationStatus === "DISPUTED") {
            continue;
          }
          const abandoned = await fetch(
            `/api/bff/v1/cancellation-attempts/${encodeURIComponent(attempt.id)}`,
            {
              method: "PATCH",
              credentials: "same-origin",
              headers: {
                "content-type": "application/json",
                "if-match": `"${attempt.version}"`,
              },
              body: JSON.stringify({
                serviceStatus: attempt.serviceStatus,
                paymentMandateStatus: attempt.paymentMandateStatus,
                abandoned: true,
              }),
            },
          );
          if (abandoned.status !== 200 && abandoned.status !== 409) {
            throw new Error(
              `M4 attempt cleanup failed with ${abandoned.status}.`,
            );
          }
        }
      } else if (attemptsResponse.status !== 404) {
        throw new Error(
          `M4 attempt cleanup list failed with ${attemptsResponse.status}.`,
        );
      }

      const current = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (current.status === 404) {
        return;
      }
      if (!current.ok) {
        throw new Error(
          `M4 commitment cleanup GET failed with ${current.status}.`,
        );
      }
      const commitment = (await current.json()) as {
        status: string;
        version: number;
      };
      if (commitment.status === "ARCHIVED") {
        return;
      }
      const archived = await fetch(path, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "if-match": `"${commitment.version}"` },
      });
      if (archived.status !== 204) {
        throw new Error(
          `M4 commitment cleanup DELETE failed with ${archived.status}.`,
        );
      }
    },
    { householdId, commitmentId },
  );
}

async function cleanupCreatedCommitments(
  page: Page,
  householdId: string,
  commitmentIds: string[],
) {
  const failures: unknown[] = [];
  for (const commitmentId of commitmentIds) {
    try {
      await cleanupCommitment(page, householdId, commitmentId);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more temporary M4 commitments could not be cleaned up.",
    );
  }
}

function attemptIdFromUrl(value: string) {
  const match = new URL(value).pathname.match(
    /\/cancellation\/attempts\/([0-9a-f-]{36})$/i,
  );
  if (!match?.[1]) {
    throw new Error("The attempt route did not contain a UUID.");
  }
  return match[1];
}

async function signIn(page: Page) {
  await page.goto("/signin");
  await expect(
    page.getByRole("heading", { name: "Sign in to AutoPay Guard" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue securely" }).click();
  await page.locator("#username").fill(fakeUserEmail);
  await page.locator("#password").fill(fakeUserPassword);
  await page.locator("#kc-login").click();
  await expect(page).toHaveURL(/\/(?:onboarding|dashboard)(?:\?.*)?$/);

  if (new URL(page.url()).pathname === "/onboarding") {
    const existingHouseholdId = await page.evaluate(async () => {
      const response = await fetch("/api/bff/v1/households", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Existing-workspace preflight failed with ${response.status}.`,
        );
      }
      const body = (await response.json()) as {
        items: Array<{ id: string }>;
      };
      return body.items[0]?.id ?? null;
    });
    if (existingHouseholdId) {
      await page.goto(`/dashboard?householdId=${existingHouseholdId}`);
    } else {
      await page.getByLabel("Workspace name").fill("Demo household");
      await page
        .getByRole("checkbox", { name: /I confirm that I am 18 or older/i })
        .check();
      await page
        .getByRole("checkbox", {
          name: /I have read and accept the privacy notice/i,
        })
        .check();
      await page.getByRole("button", { name: "Create my workspace" }).click();
    }
  }
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

async function selectOwnedWorkspace(page: Page): Promise<HouseholdScope> {
  let householdId = new URL(page.url()).searchParams.get("householdId");
  if (!householdId) {
    const workspacePicker = page
      .getByRole("heading", { name: "Select an owned workspace" })
      .locator("..");
    await workspacePicker.getByRole("button").first().click();
    await expect(page).toHaveURL(/householdId=/);
    householdId = new URL(page.url()).searchParams.get("householdId");
  }
  if (!householdId) {
    throw new Error("The UI did not preserve the explicit household scope.");
  }
  return page.evaluate(async (selectedHouseholdId) => {
    const response = await fetch("/api/bff/v1/households", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Workspace preflight failed with ${response.status}.`);
    }
    const body = (await response.json()) as {
      items: Array<{ id: string; timezone: string }>;
    };
    const household = body.items.find(({ id }) => id === selectedHouseholdId);
    if (!household) {
      throw new Error("The selected workspace is not owned by this user.");
    }
    return household;
  }, householdId);
}

function localDateInZone(epochMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const value = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, part]),
  );
  if (!value.year || !value.month || !value.day) {
    throw new Error("Could not derive the household-local date.");
  }
  return `${value.year}-${value.month}-${value.day}`;
}

async function expectNoSeriousAxe(page: Page) {
  await expect(page).toHaveTitle(/\S+/);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(({ impact }) =>
      impact ? ["serious", "critical"].includes(impact) : false,
    ),
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, context: string) {
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(
    viewport.scrollWidth,
    `${context} must not overflow the viewport horizontally.`,
  ).toBeLessThanOrEqual(viewport.clientWidth);
}

async function expectContractMaximumSavingsToFit(page: Page) {
  const originalViewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 760, height: 900 });
    const stressedAmountCount = await page.evaluate(() => {
      const amounts = document.querySelectorAll(
        ".savings-amount-bucket > strong",
      );
      amounts.forEach((amount) => {
        amount.textContent = "₹9,00,71,99,25,47,409.91";
      });
      return amounts.length;
    });
    expect(stressedAmountCount).toBeGreaterThan(0);
    const stateCardWidths = await page
      .locator(".savings-state-grid article")
      .evaluateAll((cards) =>
        cards.map((card, index) => ({
          index,
          clientWidth: card.clientWidth,
          scrollWidth: card.scrollWidth,
          amountBuckets: Array.from(
            card.querySelectorAll<HTMLElement>(".savings-amount-bucket"),
          ).map((bucket) => ({
            clientWidth: bucket.clientWidth,
            scrollWidth: bucket.scrollWidth,
          })),
        })),
      );
    expect(stateCardWidths).toHaveLength(4);
    stateCardWidths.forEach((card) => {
      expect(
        card.scrollWidth,
        `Savings state card ${card.index + 1} must contain the contract-maximum amount.`,
      ).toBeLessThanOrEqual(card.clientWidth);
      card.amountBuckets.forEach((bucket, bucketIndex) => {
        expect(
          bucket.scrollWidth,
          `Amount bucket ${bucketIndex + 1} in savings state card ${card.index + 1} must not overflow.`,
        ).toBeLessThanOrEqual(bucket.clientWidth);
      });
    });
    await expectNoHorizontalOverflow(page, "The contract-maximum savings page");
  } finally {
    if (originalViewport) {
      await page.setViewportSize(originalViewport);
    }
  }
}

function requiredFakeIdentity(name: string) {
  const value = requiredEnvironment(name);
  if (
    !value.endsWith("@autopayguard.local") &&
    !value.endsWith(".example.test")
  ) {
    throw new Error(`${name} must identify a seeded fake local user.`);
  }
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the real-OIDC smoke test.`);
  }
  return value;
}
