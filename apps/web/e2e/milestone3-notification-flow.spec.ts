import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const fakeUserEmail = requiredFakeIdentity("E2E_USER_EMAIL");
const fakeUserPassword = requiredEnvironment("E2E_USER_PASSWORD");

test.setTimeout(420_000);

test("uses real OIDC and BFF flows for notification consent and rules", async ({
  page,
}, testInfo) => {
  const projectLabel =
    testInfo.project.name === "mobile-chromium" ? "Mobile" : "Desktop";
  await signIn(page);
  const householdId = await selectOwnedWorkspace(page);
  const initial = await readInitialConfiguration(page, householdId);
  const isolatedCommitment = await createIsolatedCommitment(
    page,
    householdId,
    initial.household.timezone,
    projectLabel,
  );
  let notificationToRestore: NotificationReadState | null = null;

  try {
    await page.goto(`/settings/notifications?householdId=${householdId}`);
    await expect(
      page.getByRole("heading", { name: "Notification settings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Delivery diagnostics" }),
    ).toBeVisible();
    await expectNoSeriousAxe(page);

    await page
      .getByRole("radio", { name: /No reminders/i })
      .first()
      .check();
    await saveThroughUi(
      page,
      page.getByRole("button", { name: "Save reminder rules" }),
      `/v1/households/${householdId}/reminder-rules`,
    );
    await expect(
      page.getByText("Workspace reminder defaults saved."),
    ).toBeVisible();

    await page.getByRole("checkbox", { name: /Enable reminders/i }).check();
    await page.getByRole("checkbox", { name: /In-app inbox/i }).check();
    await page.getByRole("checkbox", { name: /Local test email/i }).uncheck();
    await saveThroughUi(
      page,
      page.getByRole("button", { name: "Save preferences" }),
      "/v1/notification-preferences",
    );
    await expect(
      page.getByText("Notification preferences saved."),
    ).toBeVisible();

    await page.getByRole("checkbox", { name: /Enable reminders/i }).uncheck();
    await saveThroughUi(
      page,
      page.getByRole("button", { name: "Save preferences" }),
      "/v1/notification-preferences",
    );
    await expect(
      page.getByText("Notification preferences saved."),
    ).toBeVisible();

    await page
      .getByRole("radio", { name: /Use custom rules/i })
      .first()
      .check();
    await page
      .getByText("Suggested starting points")
      .locator("..")
      .getByRole("button")
      .first()
      .click();
    await saveThroughUi(
      page,
      page.getByRole("button", { name: "Save reminder rules" }),
      `/v1/households/${householdId}/reminder-rules`,
    );
    await expect(
      page.getByText("Workspace reminder defaults saved."),
    ).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.goto(
      `/commitments/${isolatedCommitment.id}?householdId=${householdId}`,
    );
    await page.getByTestId("commitment-reminders-link").click();
    await expect(
      page.getByRole("heading", {
        name: `${isolatedCommitment.displayName} reminders`,
      }),
    ).toBeVisible();
    await page.getByRole("radio", { name: /Use workspace defaults/i }).check();
    await saveThroughUi(
      page,
      page.getByRole("button", { name: "Save reminder rules" }),
      `/v1/commitments/${isolatedCommitment.id}/reminder-rules`,
    );
    await expect(
      page.getByText("Commitment reminder rules saved."),
    ).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.goto(`/settings/notifications?householdId=${householdId}`);
    await expect(
      page.getByRole("heading", { name: "Notification settings" }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: /Enable reminders/i }).check();
    await page.getByRole("checkbox", { name: /In-app inbox/i }).check();
    await page.getByRole("checkbox", { name: /Local test email/i }).uncheck();
    await page.getByRole("checkbox", { name: /Use quiet hours/i }).uncheck();
    await saveThroughUi(
      page,
      page.getByRole("button", { name: "Save preferences" }),
      "/v1/notification-preferences",
    );
    await expect(
      page.getByText("Notification preferences saved."),
    ).toBeVisible();

    await page.goto(
      `/commitments/${isolatedCommitment.id}/reminders?householdId=${householdId}`,
    );
    await expect(
      page.getByRole("heading", {
        name: `${isolatedCommitment.displayName} reminders`,
      }),
    ).toBeVisible();
    const dueReminder = buildDueReminderPlan(
      initial.household.timezone,
      isolatedCommitment.nextDueDate,
    );
    const notificationBaseline = await matchingNotifications(page, {
      householdId,
      commitmentId: isolatedCommitment.id,
      scheduledDate: isolatedCommitment.nextDueDate,
      offsetDays: dueReminder.offsetDays,
    });
    expect(notificationBaseline).toEqual([]);
    await page.getByRole("radio", { name: /Use custom rules/i }).check();
    await page.getByRole("button", { name: "Add reminder" }).click();
    await page.getByLabel("Channel").selectOption("IN_APP");
    await page.getByLabel("Days before").fill(String(dueReminder.offsetDays));
    await page.getByLabel("Send time").fill(dueReminder.localSendTime);
    await page.getByLabel("Enabled").check();
    await saveThroughUi(
      page,
      page.getByRole("button", { name: "Save reminder rules" }),
      `/v1/commitments/${isolatedCommitment.id}/reminder-rules`,
    );
    await expect(
      page.getByText("Commitment reminder rules saved."),
    ).toBeVisible();

    const generatedNotification = await waitForNotification(page, {
      householdId,
      commitmentId: isolatedCommitment.id,
      scheduledDate: isolatedCommitment.nextDueDate,
      offsetDays: dueReminder.offsetDays,
      targetEpochMs: dueReminder.targetEpochMs,
    });
    const originalNotification = await readNotification(
      page,
      generatedNotification.id,
    );
    assertNotificationScope(originalNotification, {
      householdId,
      commitmentId: isolatedCommitment.id,
      scheduledDate: isolatedCommitment.nextDueDate,
      offsetDays: dueReminder.offsetDays,
    });
    await assertSingleNotificationAfterAnotherSchedulerRun(page, {
      householdId,
      commitmentId: isolatedCommitment.id,
      scheduledDate: isolatedCommitment.nextDueDate,
      offsetDays: dueReminder.offsetDays,
      expectedNotificationId: generatedNotification.id,
    });
    notificationToRestore = {
      id: originalNotification.id,
      read: originalNotification.read,
    };
    await setNotificationReadState(page, originalNotification.id, false);

    await page.goto(`/notifications?householdId=${householdId}`);
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.getByRole("link", { name: "Unread", exact: true }).click();
    await expect(page).toHaveURL(/filter=UNREAD/);
    await expect(
      page.getByRole("link", { name: "Unread", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Failed", exact: true }).click();
    await expect(page).toHaveURL(/filter=FAILED/);
    await expectNoSeriousAxe(page);
    await expect(
      page.getByRole("button", { name: /retry delivery/i }),
    ).toHaveCount(0);

    await page.goto(
      `/notifications/${generatedNotification.id}?householdId=${householdId}`,
    );
    await expect(
      page.getByRole("heading", { name: "Reminder details" }),
    ).toBeVisible();
    await expect(page.getByText("Unread", { exact: true })).toBeVisible();
    await expectNoSeriousAxe(page);

    await patchThroughUi(
      page,
      page.getByRole("button", { name: "Mark read" }),
      generatedNotification.id,
      200,
    );
    await expect(page.getByText("Notification marked read.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark unread" }),
    ).toBeVisible();

    await makeNotificationVersionStale(page, generatedNotification.id);
    await patchThroughUi(
      page,
      page.getByRole("button", { name: "Mark unread" }),
      generatedNotification.id,
      412,
    );
    const conflict = page.getByRole("alert");
    await expect(
      conflict.getByText("A newer version exists", { exact: true }),
    ).toBeVisible();
    await expectNoSeriousAxe(page);

    const reloadResponse = page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === "GET" &&
        new URL(response.url()).pathname ===
          `/api/bff/v1/notifications/${generatedNotification.id}`
      );
    });
    await conflict
      .getByRole("button", { name: "Reload latest version" })
      .click();
    expect((await reloadResponse).ok()).toBe(true);
    await expect(
      page.getByRole("button", { name: "Mark unread" }),
    ).toBeVisible();

    await patchThroughUi(
      page,
      page.getByRole("button", { name: "Mark unread" }),
      generatedNotification.id,
      200,
    );
    await expect(page.getByText("Notification marked unread.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark read" })).toBeVisible();
  } finally {
    try {
      if (notificationToRestore) {
        await setNotificationReadState(
          page,
          notificationToRestore.id,
          notificationToRestore.read,
        );
      }
    } finally {
      try {
        await restoreConfiguration(page, householdId, initial);
      } finally {
        await archiveCommitment(page, isolatedCommitment.id);
      }
    }
  }

  if (!notificationToRestore) {
    throw new Error("The notification journey did not select a record.");
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(
    `/notifications/${notificationToRestore.id}?householdId=${householdId}`,
  );
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fdashboard$/);
  await page.goto(`/notifications?householdId=${householdId}`);
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fdashboard$/);
  await page.goto(`/settings/notifications?householdId=${householdId}`);
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fdashboard$/);
});

interface Preferences {
  enabled: boolean;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  version: number;
}

interface RuleSet {
  mode: "INHERIT" | "CUSTOM" | "DISABLED";
  rules: Array<{
    channel: "IN_APP" | "EMAIL";
    offsetDays: number;
    localSendTime: string;
    enabled: boolean;
  }>;
  version: number;
}

interface InitialConfiguration {
  preferences: Preferences;
  householdRules: RuleSet;
  household: { id: string; timezone: string };
  commitment: { id: string; displayName: string; nextDueDate: string };
  commitmentRules: RuleSet;
}

interface IsolatedCommitment {
  id: string;
  displayName: string;
  nextDueDate: string;
}

interface NotificationRecord {
  id: string;
  householdId: string;
  commitmentId: string;
  scheduledDate: string;
  channel: "IN_APP" | "EMAIL";
  offsetDays: number;
  read: boolean;
  version: number;
}

interface NotificationReadState {
  id: string;
  read: boolean;
}

async function createIsolatedCommitment(
  page: Page,
  householdId: string,
  timezone: string,
  projectLabel: string,
): Promise<IsolatedCommitment> {
  const displayName = `M3 E2E Reminder ${projectLabel}`;
  const anchorDate = localDateInZone(Date.now() + 30 * 86_400_000, timezone);
  return page.evaluate(
    async ({
      selectedHouseholdId,
      isolatedDisplayName,
      isolatedAnchorDate,
    }) => {
      type ListedCommitment = {
        id: string;
        displayName: string;
        version: number;
      };
      type CreatedCommitment = ListedCommitment & {
        householdId: string;
        nextDueDate: string | null;
        status: string;
      };
      const query = new URLSearchParams({
        householdId: selectedHouseholdId,
        includeArchived: "false",
        limit: "100",
      });
      const listed = await fetch(`/api/bff/v1/commitments?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!listed.ok) {
        throw new Error(
          `Isolated-commitment preflight failed with ${listed.status}.`,
        );
      }
      const existing = (await listed.json()) as {
        items: ListedCommitment[];
      };
      for (const commitment of existing.items) {
        if (commitment.displayName !== isolatedDisplayName) {
          continue;
        }
        if (
          !Number.isSafeInteger(commitment.version) ||
          commitment.version < 0
        ) {
          throw new Error(
            "Isolated-commitment preflight returned an invalid version.",
          );
        }
        const archived = await fetch(
          `/api/bff/v1/commitments/${encodeURIComponent(commitment.id)}`,
          {
            method: "DELETE",
            credentials: "same-origin",
            headers: { "if-match": `"${commitment.version}"` },
          },
        );
        if (archived.status !== 204) {
          throw new Error(
            `Isolated-commitment preflight archive failed with ${archived.status}.`,
          );
        }
      }

      const created = await fetch("/api/bff/v1/commitments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId: selectedHouseholdId,
          merchantId: null,
          displayName: isolatedDisplayName,
          category: "SOFTWARE",
          paymentRail: "UNKNOWN",
          amountMinor: 100,
          estimatedAmountMinor: null,
          currency: "INR",
          frequency: "MONTHLY",
          intervalCount: 1,
          customIntervalUnit: null,
          anchorDate: isolatedAnchorDate,
          monthDayPolicy: "ANCHOR_DAY",
          variableAmount: false,
          maskedPaymentLabel: null,
        }),
      });
      if (created.status !== 201) {
        throw new Error(
          `Isolated-commitment creation failed with ${created.status}.`,
        );
      }
      const body = (await created.json()) as CreatedCommitment;
      if (
        body.householdId !== selectedHouseholdId ||
        body.displayName !== isolatedDisplayName ||
        body.nextDueDate !== isolatedAnchorDate ||
        body.status !== "ACTIVE" ||
        !Number.isSafeInteger(body.version) ||
        body.version < 0 ||
        created.headers.get("etag") !== `"${body.version}"`
      ) {
        throw new Error(
          "Isolated-commitment creation returned unexpected state.",
        );
      }
      return {
        id: body.id,
        displayName: body.displayName,
        nextDueDate: body.nextDueDate,
      };
    },
    {
      selectedHouseholdId: householdId,
      isolatedDisplayName: displayName,
      isolatedAnchorDate: anchorDate,
    },
  );
}

async function archiveCommitment(page: Page, commitmentId: string) {
  await page.evaluate(async (selectedCommitmentId) => {
    const path = `/api/bff/v1/commitments/${encodeURIComponent(selectedCommitmentId)}`;
    const current = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (current.status === 404) {
      return;
    }
    if (!current.ok) {
      throw new Error(
        `Isolated-commitment cleanup GET failed with ${current.status}.`,
      );
    }
    const body = (await current.json()) as {
      id: string;
      status: string;
      version: number;
    };
    if (
      body.id !== selectedCommitmentId ||
      !Number.isSafeInteger(body.version) ||
      body.version < 0
    ) {
      throw new Error(
        "Isolated-commitment cleanup GET returned unexpected state.",
      );
    }
    if (body.status === "ARCHIVED") {
      return;
    }
    const archived = await fetch(path, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "if-match": `"${body.version}"` },
    });
    if (archived.status !== 204) {
      throw new Error(
        `Isolated-commitment cleanup DELETE failed with ${archived.status}.`,
      );
    }
  }, commitmentId);
}

async function readInitialConfiguration(
  page: Page,
  householdId: string,
): Promise<InitialConfiguration> {
  return page.evaluate(async (selectedHouseholdId) => {
    const getJson = async <T>(path: string): Promise<T> => {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Configuration preflight failed with ${response.status}.`,
        );
      }
      return (await response.json()) as T;
    };
    const [preferences, householdRules, households, commitments] =
      await Promise.all([
        getJson<Preferences>("/api/bff/v1/notification-preferences"),
        getJson<RuleSet>(
          `/api/bff/v1/households/${encodeURIComponent(selectedHouseholdId)}/reminder-rules`,
        ),
        getJson<{
          items: Array<{ id: string; timezone: string }>;
        }>("/api/bff/v1/households"),
        getJson<{
          items: Array<{
            id: string;
            displayName: string;
            nextDueDate: string | null;
          }>;
        }>(
          `/api/bff/v1/commitments?householdId=${encodeURIComponent(selectedHouseholdId)}&includeArchived=false&limit=20`,
        ),
      ]);
    const household = households.items.find(
      ({ id }) => id === selectedHouseholdId,
    );
    if (!household) {
      throw new Error("The selected workspace is not owned by this user.");
    }
    const commitment = commitments.items.find(
      ({ displayName }) => displayName === "M2 Fixture CloudNest Demo",
    );
    if (!commitment) {
      throw new Error(
        "Milestone 3 browser flow requires `make seed` and its CloudNest fixture.",
      );
    }
    if (!commitment.nextDueDate) {
      throw new Error(
        "The CloudNest fixture must have a next due date for reminder generation.",
      );
    }
    const commitmentRules = await getJson<RuleSet>(
      `/api/bff/v1/commitments/${encodeURIComponent(commitment.id)}/reminder-rules`,
    );
    if (
      preferences.version === 0 ||
      householdRules.version === 0 ||
      commitmentRules.version === 0
    ) {
      throw new Error(
        "Milestone 3 browser flow requires persisted configuration from `make seed`.",
      );
    }
    return {
      preferences,
      householdRules,
      household,
      commitment: {
        id: commitment.id,
        displayName: commitment.displayName,
        nextDueDate: commitment.nextDueDate,
      },
      commitmentRules,
    };
  }, householdId);
}

async function restoreConfiguration(
  page: Page,
  householdId: string,
  initial: InitialConfiguration,
) {
  await page.evaluate(
    async ({ householdId: selectedHouseholdId, initialConfiguration }) => {
      type JsonRecord = Record<string, unknown>;
      type RestoreBody =
        | Omit<Preferences, "version">
        | Omit<RuleSet, "version">;
      type RuleScope = {
        householdId: string;
        commitmentId: string | null;
      };

      const readJson = async (path: string, operation: string) => {
        const response = await fetch(path, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`${operation} failed with ${response.status}.`);
        }
        return (await response.json()) as JsonRecord;
      };
      const versionOf = (value: JsonRecord, operation: string) => {
        const version = value.version;
        if (
          typeof version !== "number" ||
          !Number.isInteger(version) ||
          version < 0
        ) {
          throw new Error(`${operation} returned an invalid version.`);
        }
        return version;
      };
      const preferenceProjection = (value: JsonRecord) => ({
        enabled: value.enabled,
        inAppEnabled: value.inAppEnabled,
        emailEnabled: value.emailEnabled,
        timezone: value.timezone,
        quietHoursEnabled: value.quietHoursEnabled,
        quietStart: value.quietStart,
        quietEnd: value.quietEnd,
      });
      const ruleProjection = (value: JsonRecord) => ({
        mode: value.mode,
        rules: value.rules,
      });
      const assertEqual = (
        operation: string,
        actual: unknown,
        expected: unknown,
      ) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`${operation} returned unexpected state.`);
        }
      };
      const assertRuleScope = (
        operation: string,
        value: JsonRecord,
        scope: RuleScope,
      ) => {
        if (
          value.householdId !== scope.householdId ||
          value.commitmentId !== scope.commitmentId
        ) {
          throw new Error(`${operation} returned a different rule scope.`);
        }
      };
      const restore = async (
        path: string,
        body: RestoreBody,
        operation: string,
        scope: RuleScope | null,
      ) => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const current = await readJson(path, `${operation} preflight GET`);
          const version = versionOf(current, `${operation} preflight GET`);
          const updated = await fetch(path, {
            method: "PUT",
            credentials: "same-origin",
            headers: {
              "content-type": "application/json",
              "if-match": `"${version}"`,
            },
            body: JSON.stringify(body),
          });
          if (updated.ok) {
            const restored = (await updated.json()) as JsonRecord;
            const restoredVersion = versionOf(restored, `${operation} PUT`);
            if (restoredVersion < version) {
              throw new Error(`${operation} PUT regressed the version.`);
            }
            if (updated.headers.get("etag") !== `"${restoredVersion}"`) {
              throw new Error(`${operation} PUT returned an invalid ETag.`);
            }
            if (scope) {
              assertRuleScope(`${operation} PUT`, restored, scope);
              assertEqual(`${operation} PUT`, ruleProjection(restored), body);
            } else {
              assertEqual(
                `${operation} PUT`,
                preferenceProjection(restored),
                body,
              );
            }
            return;
          }
          if (updated.status !== 412 || attempt === 3) {
            throw new Error(`${operation} PUT failed with ${updated.status}.`);
          }
        }
      };

      const preferenceBody = {
        enabled: initialConfiguration.preferences.enabled,
        inAppEnabled: initialConfiguration.preferences.inAppEnabled,
        emailEnabled: initialConfiguration.preferences.emailEnabled,
        timezone: initialConfiguration.preferences.timezone,
        quietHoursEnabled: initialConfiguration.preferences.quietHoursEnabled,
        quietStart: initialConfiguration.preferences.quietStart,
        quietEnd: initialConfiguration.preferences.quietEnd,
      };
      const householdRuleBody = {
        mode: initialConfiguration.householdRules.mode,
        rules: initialConfiguration.householdRules.rules,
      };

      await restore(
        `/api/bff/v1/households/${encodeURIComponent(selectedHouseholdId)}/reminder-rules`,
        householdRuleBody,
        "Household-rule cleanup",
        {
          householdId: selectedHouseholdId,
          commitmentId: null,
        },
      );
      await restore(
        "/api/bff/v1/notification-preferences",
        preferenceBody,
        "Preference cleanup",
        null,
      );

      const [restoredHouseholdRules, restoredPrefs] = await Promise.all([
        readJson(
          `/api/bff/v1/households/${encodeURIComponent(selectedHouseholdId)}/reminder-rules`,
          "Household-rule cleanup verification GET",
        ),
        readJson(
          "/api/bff/v1/notification-preferences",
          "Preference cleanup verification GET",
        ),
      ]);
      versionOf(
        restoredHouseholdRules,
        "Household-rule cleanup verification GET",
      );
      versionOf(restoredPrefs, "Preference cleanup verification GET");
      assertRuleScope(
        "Household-rule cleanup verification GET",
        restoredHouseholdRules,
        {
          householdId: selectedHouseholdId,
          commitmentId: null,
        },
      );
      assertEqual(
        "Household-rule cleanup verification GET",
        ruleProjection(restoredHouseholdRules),
        householdRuleBody,
      );
      assertEqual(
        "Preference cleanup verification GET",
        preferenceProjection(restoredPrefs),
        preferenceBody,
      );
    },
    { householdId, initialConfiguration: initial },
  );
}

async function saveThroughUi(page: Page, button: Locator, bffPath: string) {
  const expectedPath = `/api/bff${bffPath}`;
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "PUT" &&
      new URL(response.url()).pathname === expectedPath
    );
  });
  await button.click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
}

async function patchThroughUi(
  page: Page,
  button: Locator,
  notificationId: string,
  expectedStatus: number,
) {
  const expectedPath = `/api/bff/v1/notifications/${notificationId}`;
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "PATCH" &&
      new URL(response.url()).pathname === expectedPath
    );
  });
  await button.click();
  expect((await responsePromise).status()).toBe(expectedStatus);
}

interface NotificationCriteria {
  householdId: string;
  commitmentId: string;
  scheduledDate: string;
  offsetDays: number;
}

interface DueNotificationCriteria extends NotificationCriteria {
  targetEpochMs: number;
}

async function waitForNotification(
  page: Page,
  criteria: DueNotificationCriteria,
): Promise<NotificationRecord> {
  const deadline = Math.max(
    Date.now() + 15_000,
    criteria.targetEpochMs + 75_000,
  );
  while (Date.now() <= deadline) {
    const matches = await matchingNotifications(page, criteria);
    if (matches.length > 1) {
      throw new Error(
        "Repeated scheduling created more than one logical notification.",
      );
    }
    if (matches.length === 1) {
      return matches[0];
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(
    "The real notification generator did not create the scheduled in-app reminder.",
  );
}

async function matchingNotifications(
  page: Page,
  criteria: NotificationCriteria,
): Promise<NotificationRecord[]> {
  return page.evaluate(async (expected) => {
    const matches: NotificationRecord[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
      const query = new URLSearchParams({
        householdId: expected.householdId,
        filter: "ALL",
        limit: "100",
      });
      if (cursor) {
        query.set("cursor", cursor);
      }
      const response = await fetch(
        `/api/bff/v1/notifications?${query.toString()}`,
        {
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error(`Notification poll failed with ${response.status}.`);
      }
      const body = (await response.json()) as {
        householdId: string;
        filter: string;
        items: NotificationRecord[];
        nextCursor: string | null;
      };
      if (
        body.householdId !== expected.householdId ||
        body.filter !== "ALL" ||
        body.items.some(
          ({ householdId }) => householdId !== expected.householdId,
        )
      ) {
        throw new Error(
          "Notification poll returned a different workspace scope.",
        );
      }
      matches.push(
        ...body.items.filter(
          (candidate) =>
            candidate.commitmentId === expected.commitmentId &&
            candidate.scheduledDate === expected.scheduledDate &&
            candidate.channel === "IN_APP" &&
            candidate.offsetDays === expected.offsetDays,
        ),
      );
      if (!body.nextCursor) {
        return matches;
      }
      cursor = body.nextCursor;
    }
    throw new Error("Notification poll exceeded the pagination limit.");
  }, criteria);
}

async function assertSingleNotificationAfterAnotherSchedulerRun(
  page: Page,
  criteria: NotificationCriteria & { expectedNotificationId: string },
) {
  const nextMinute = Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
  await page.waitForTimeout(Math.max(0, nextMinute + 15_000 - Date.now()));
  const matches = await matchingNotifications(page, criteria);
  expect(matches.map(({ id }) => id)).toEqual([
    criteria.expectedNotificationId,
  ]);
}

async function readNotification(
  page: Page,
  notificationId: string,
): Promise<NotificationRecord> {
  return page.evaluate(async (selectedNotificationId) => {
    const response = await fetch(
      `/api/bff/v1/notifications/${encodeURIComponent(selectedNotificationId)}`,
      {
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw new Error(`Notification GET failed with ${response.status}.`);
    }
    return (await response.json()) as NotificationRecord;
  }, notificationId);
}

async function setNotificationReadState(
  page: Page,
  notificationId: string,
  read: boolean,
) {
  await page.evaluate(
    async ({ selectedNotificationId, expectedRead }) => {
      type ReadRecord = { id: string; read: boolean; version: number };
      const path = `/api/bff/v1/notifications/${encodeURIComponent(selectedNotificationId)}`;
      const getCurrent = async () => {
        const response = await fetch(path, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(
            `Notification read-state cleanup GET failed with ${response.status}.`,
          );
        }
        return (await response.json()) as ReadRecord;
      };

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const current = await getCurrent();
        if (current.id !== selectedNotificationId) {
          throw new Error(
            "Notification read-state cleanup returned a different record.",
          );
        }
        if (current.read === expectedRead) {
          return;
        }
        const updated = await fetch(path, {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "if-match": `"${current.version}"`,
          },
          body: JSON.stringify({ read: expectedRead }),
        });
        if (updated.status === 412 && attempt < 3) {
          continue;
        }
        if (!updated.ok) {
          throw new Error(
            `Notification read-state cleanup PATCH failed with ${updated.status}.`,
          );
        }
        const body = (await updated.json()) as ReadRecord;
        if (
          body.id !== selectedNotificationId ||
          body.read !== expectedRead ||
          !Number.isInteger(body.version) ||
          body.version <= current.version ||
          updated.headers.get("etag") !== `"${body.version}"`
        ) {
          throw new Error(
            "Notification read-state cleanup PATCH returned unexpected state.",
          );
        }
        const verified = await getCurrent();
        if (
          verified.id !== selectedNotificationId ||
          verified.read !== expectedRead ||
          verified.version !== body.version
        ) {
          throw new Error(
            "Notification read-state cleanup verification GET did not preserve the requested state.",
          );
        }
        return;
      }
    },
    { selectedNotificationId: notificationId, expectedRead: read },
  );
}

async function makeNotificationVersionStale(
  page: Page,
  notificationId: string,
) {
  await page.evaluate(async (selectedNotificationId) => {
    type ReadRecord = { id: string; read: boolean; version: number };
    const path = `/api/bff/v1/notifications/${encodeURIComponent(selectedNotificationId)}`;
    const getCurrent = async () => {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Stale-notification setup GET failed with ${response.status}.`,
        );
      }
      return (await response.json()) as ReadRecord;
    };
    const patch = async (current: ReadRecord, read: boolean) => {
      const response = await fetch(path, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "if-match": `"${current.version}"`,
        },
        body: JSON.stringify({ read }),
      });
      if (!response.ok) {
        throw new Error(
          `Stale-notification setup PATCH failed with ${response.status}.`,
        );
      }
      const updated = (await response.json()) as ReadRecord;
      if (
        updated.id !== selectedNotificationId ||
        updated.read !== read ||
        !Number.isInteger(updated.version) ||
        updated.version <= current.version ||
        response.headers.get("etag") !== `"${updated.version}"`
      ) {
        throw new Error(
          "Stale-notification setup PATCH returned unexpected state.",
        );
      }
      return updated;
    };

    const current = await getCurrent();
    if (current.id !== selectedNotificationId || !current.read) {
      throw new Error(
        "Stale-notification setup requires the UI to mark the record read first.",
      );
    }
    const unread = await patch(current, false);
    const readAgain = await patch(unread, true);
    const verified = await getCurrent();
    if (
      verified.id !== selectedNotificationId ||
      !verified.read ||
      verified.version !== readAgain.version
    ) {
      throw new Error(
        "Stale-notification setup verification GET returned unexpected state.",
      );
    }
  }, notificationId);
}

function assertNotificationScope(
  notification: NotificationRecord,
  expected: NotificationCriteria,
) {
  if (
    notification.householdId !== expected.householdId ||
    notification.commitmentId !== expected.commitmentId ||
    notification.scheduledDate !== expected.scheduledDate ||
    notification.channel !== "IN_APP" ||
    notification.offsetDays !== expected.offsetDays
  ) {
    throw new Error(
      "The notification detail preflight returned another scope.",
    );
  }
  if (!Number.isInteger(notification.version) || notification.version < 0) {
    throw new Error("The notification detail preflight returned no version.");
  }
}

function buildDueReminderPlan(
  timezone: string,
  scheduledDate: string,
): {
  offsetDays: number;
  localSendTime: string;
  targetEpochMs: number;
} {
  const now = Date.now();
  let targetEpochMs = Math.floor(now / 60_000) * 60_000 + 60_000;
  if (targetEpochMs - now < 45_000) {
    targetEpochMs += 60_000;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(targetEpochMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    if (!value) {
      throw new Error(`Could not resolve reminder ${type} in ${timezone}.`);
    }
    return value;
  };
  const targetLocalDate = `${part("year")}-${part("month")}-${part("day")}`;
  const localSendTime = `${part("hour")}:${part("minute")}`;
  const parseDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Invalid local date ${value}.`);
    }
    return Date.parse(`${value}T00:00:00Z`);
  };
  const offsetDays =
    (parseDate(scheduledDate) - parseDate(targetLocalDate)) / 86_400_000;
  if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 90) {
    throw new Error(
      `The fixture due date requires unsupported reminder offset ${offsetDays}.`,
    );
  }
  return { offsetDays, localSendTime, targetEpochMs };
}

function localDateInZone(epochMs: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(epochMs);
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (!part) {
      throw new Error(`Could not resolve ${type} in ${timezone}.`);
    }
    return part;
  };
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function signIn(page: Page) {
  await page.goto("/signin");
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
      const body = (await response.json()) as { items: Array<{ id: string }> };
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
        .getByRole("checkbox", { name: /I have read and accept/i })
        .check();
      await page.getByRole("button", { name: "Create my workspace" }).click();
    }
  }
}

async function selectOwnedWorkspace(page: Page) {
  const selected = new URL(page.url()).searchParams.get("householdId");
  if (selected) {
    return selected;
  }
  await page
    .getByRole("heading", { name: "Select an owned workspace" })
    .locator("..")
    .getByRole("button")
    .first()
    .click();
  await expect(page).toHaveURL(/householdId=/);
  const householdId = new URL(page.url()).searchParams.get("householdId");
  if (!householdId) {
    throw new Error("The UI did not preserve the explicit household scope.");
  }
  return householdId;
}

async function expectNoSeriousAxe(page: Page) {
  // Next.js may finish a client transition's visible body before committing
  // its streamed route metadata. Audit only after the document title exists.
  await expect(page).toHaveTitle(/\S+/);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(({ impact }) =>
      impact ? ["serious", "critical"].includes(impact) : false,
    ),
  ).toEqual([]);
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
