import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const fakeUserEmail = requiredFakeIdentity("E2E_USER_EMAIL");
const fakeUserPassword = requiredEnvironment("E2E_USER_PASSWORD");
const legacyTestNames = ["E2E Web Flow Demo", "E2E Web Flow Demo Edited"];

test.setTimeout(90_000);

test("uses the real OIDC and BFF flow for recurring commitments", async ({
  page,
}, testInfo) => {
  const projectLabel =
    testInfo.project.name === "mobile-chromium" ? "Mobile" : "Desktop";
  const editableName = `E2E Web Flow Demo ${projectLabel}`;
  const editedName = `${editableName} Edited`;
  const cleanupNames = [...legacyTestNames, editableName, editedName];

  await signIn(page);
  const householdId = await selectOwnedWorkspace(page);
  await archivePriorTestRows(page, householdId, cleanupNames);
  await page.reload();

  await expect(
    page.getByRole("heading", { name: /Good to see you/i }),
  ).toBeVisible();
  const activeCard = page.getByText("Active commitments").locator("..");
  await expect(activeCard.getByText("4", { exact: true })).toBeVisible();
  await expect(page.getByText("₹4,500", { exact: true })).toBeVisible();
  await expect(page.getByText("₹54,000", { exact: true })).toBeVisible();
  await expect(page.getByText("Not prorated", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No FX conversion", { exact: true }),
  ).toBeVisible();

  await expectNoSeriousAxe(page);

  let created = false;
  try {
    await page
      .getByRole("link", { name: "Commitments", exact: true })
      .first()
      .click();
    await expect(page.getByText("M2 Fixture StreamBox Demo")).toBeVisible();
    await page.getByTestId("add-commitment-link").click();
    await expectNoSeriousAxe(page);

    const merchantSearch = page.getByLabel("Find a known merchant (optional)");
    await merchantSearch.fill("StreamBox");
    await page
      .getByRole("list", { name: "Merchant search results" })
      .getByRole("button", { name: /StreamBox/i })
      .click();
    await expect(page.getByText("Catalog merchant selected")).toBeVisible();
    await page.getByRole("button", { name: "Clear match" }).click();

    const displayName = page.getByLabel("Display name");
    const category = page.getByRole("combobox", { name: /^Category/ });
    await displayName.focus();
    await page.keyboard.press("Tab");
    await expect(category).toBeFocused();
    await displayName.fill(editableName);
    await category.selectOption("EMI_LOAN");
    await expect(page.getByText("Due-date readiness only")).toBeVisible();
    await page.getByLabel("Fixed amount").fill("123.45");
    await page.getByLabel("Frequency").selectOption("CUSTOM");
    await page.getByLabel("Custom unit").selectOption("YEARS");
    await page.getByLabel("Payment rail").selectOption("CASH_OR_MANUAL");
    await page.getByLabel("Masked payment label").fill("Card ending 42");
    const createButton = page.getByRole("button", {
      name: "Add recurring commitment",
    });
    await createButton.focus();
    await page.keyboard.press("Enter");
    created = true;

    await expect(
      page.getByRole("heading", { name: editableName }),
    ).toBeVisible();
    await expect(page.getByText("Due-date readiness only")).toBeVisible();
    await expect(
      page.getByText("Check due-date readiness", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Cancel with provider", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Review actions are guidance only. AutoPay Guard cannot execute, cancel, switch, or change a provider service.",
      ),
    ).toBeVisible();
    await expectNoSeriousAxe(page);

    await page
      .getByRole("link", { name: "Upcoming", exact: true })
      .first()
      .click();
    await expect(page.getByText(editableName, { exact: true })).toBeVisible();
    await expect(page.getByText("Fixed", { exact: true }).last()).toBeVisible();
    await expectNoSeriousAxe(page);
    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(
      page.getByRole("link", { name: new RegExp(editableName) }),
    ).toBeVisible();
    await expectNoSeriousAxe(page);

    await page
      .getByRole("link", { name: new RegExp(editableName) })
      .first()
      .click();
    await expectNoSeriousAxe(page);
    await page.getByTestId("edit-commitment-link").click();
    await expect(
      page.getByRole("heading", { name: editableName }),
    ).toBeVisible();
    await expectNoSeriousAxe(page);
    await page.getByLabel("Display name").fill(editedName);
    await page.getByLabel("Fixed amount").fill("124.45");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: editedName })).toBeVisible();
    await expect(page.getByText("₹124.45", { exact: true })).toBeVisible();
    await expectNoSeriousAxe(page);

    const archiveButton = page.getByTestId("archive-commitment-button");
    await archiveButton.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: `Archive ${editedName}?` }),
    ).toBeVisible();
    await expect(page.getByRole("alertdialog")).toBeFocused();
    await expectNoSeriousAxe(page);
    const confirmArchive = page.getByRole("button", {
      name: "Archive commitment",
      exact: true,
    });
    await confirmArchive.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/commitments\?/);
    await expect(page.getByText(editedName, { exact: true })).toHaveCount(0);
    created = false;
  } finally {
    if (created) {
      await archivePriorTestRows(page, householdId, cleanupNames);
    }
  }

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
  const browserSessionEndpoint = await page.request.get("/api/auth/session");
  expect(browserSessionEndpoint.status()).toBe(404);
  await expect(
    page.getByText(
      "We never ask for your UPI PIN, bank password, OTP, or full payment credentials.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fdashboard$/);
});

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
          `Existing-workspace preflight failed with HTTP ${response.status}.`,
        );
      }
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
        .getByRole("checkbox", {
          name: /I have read and accept the privacy notice/i,
        })
        .check();
      await page.getByRole("button", { name: "Create my workspace" }).click();
    }
  }
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

async function selectOwnedWorkspace(page: Page) {
  const selected = new URL(page.url()).searchParams.get("householdId");
  if (selected) {
    return selected;
  }
  const workspacePicker = page
    .getByRole("heading", { name: "Select an owned workspace" })
    .locator("..");
  const workspaceButton = workspacePicker.getByRole("button").first();
  await expect(workspaceButton).toBeVisible();
  await workspaceButton.click();
  await expect(page).toHaveURL(/householdId=/);
  const householdId = new URL(page.url()).searchParams.get("householdId");
  if (!householdId) {
    throw new Error("The UI did not preserve the explicit household scope.");
  }
  return householdId;
}

async function archivePriorTestRows(
  page: Page,
  householdId: string,
  names: string[],
) {
  await page.evaluate(
    async ({ householdId: selectedHouseholdId, names }) => {
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
        throw new Error(`Preflight list failed with HTTP ${listed.status}.`);
      }
      const body = (await listed.json()) as {
        items: Array<{ id: string; displayName: string; version: number }>;
      };
      for (const item of body.items) {
        if (!names.includes(item.displayName)) {
          continue;
        }
        if (!Number.isSafeInteger(item.version) || item.version < 0) {
          throw new Error("Preflight list returned an invalid version.");
        }
        const archived = await fetch(
          `/api/bff/v1/commitments/${encodeURIComponent(item.id)}`,
          {
            method: "DELETE",
            credentials: "same-origin",
            headers: { "if-match": `"${item.version}"` },
          },
        );
        if (!archived.ok) {
          const problem = await archived.text();
          throw new Error(
            `Preflight archive failed with HTTP ${archived.status}: ${problem}`,
          );
        }
      }
    },
    { householdId, names },
  );
}

function seriousViolations(violations: Array<{ impact?: string | null }>) {
  return violations.filter(({ impact }) =>
    impact ? ["serious", "critical"].includes(impact) : false,
  );
}

async function expectNoSeriousAxe(page: Page) {
  // Next.js streams route metadata independently of the visible page body.
  // Wait for the route title before auditing so Axe does not inspect the
  // transient head between a completed client transition and metadata commit.
  await expect(page).toHaveTitle(/\S+/);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(seriousViolations(accessibility.violations)).toEqual([]);
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
