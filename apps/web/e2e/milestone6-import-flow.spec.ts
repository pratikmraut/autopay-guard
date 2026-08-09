import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  api,
  apiJson,
  assertM6CleanBaseline,
  canonicalBaseUrl,
  cleanupM6ImportFixtures,
  createRealSession,
  etag,
  expectBrowserStorageEmpty,
  expectRealUiQuality,
  idempotencyKey,
  listCommitments,
  resolveCanonicalHousehold,
  responseJson,
  signInRealIdentity,
  signOutAndProtect,
  type RealIdentity,
} from "./milestone5-real-support";

const enabled = process.env.M6_REAL_OIDC_UI === "true";
const acknowledgement = "I_ACKNOWLEDGE_LOCAL_FAKE_M6_ACCEPTANCE";
const header =
  "name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label";

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);
test.skip(
  !enabled,
  "Set M6_REAL_OIDC_UI=true and the guarded fake-local acknowledgement to run the real import journey.",
);

test("M6 owner downloads, previews, confirms, and discards controlled CSV imports", async ({
  browser,
  page,
}, testInfo) => {
  const baseUrl = String(testInfo.project.use.baseURL ?? canonicalBaseUrl);
  if (
    baseUrl !== canonicalBaseUrl ||
    process.env.M6_LIVE_ACCEPTANCE_ACK !== acknowledgement
  ) {
    throw new Error(
      `The guarded M6 suite requires ${canonicalBaseUrl} and M6_LIVE_ACCEPTANCE_ACK=${acknowledgement}.`,
    );
  }

  await signInRealIdentity(page, "owner", "/commitments");
  const household = await resolveCanonicalHousehold(page);
  await assertM6CleanBaseline(household.id);
  const suffix = alphabeticRunToken();
  const existingFixture = await resolveExistingDuplicateFixture(
    page,
    household.id,
  );
  const catalogFixture = await resolveCatalogFixture(page);
  const projectionMonth = nextProjectionMonth(household.timezone);
  const baselineDashboard = await dashboardSummary(
    page,
    household.id,
    projectionMonth,
  );
  const firstName = `M6 UI Import ${suffix} A`;
  const duplicateName = `M6 UI Import ${suffix} B`;
  const importedNames = new Set([
    firstName,
    duplicateName,
    catalogFixture.alias,
  ]);
  const importJobIds: string[] = [];
  let staleOwnerTab: Page | undefined;
  let primaryFailure: unknown;
  let cleanupFailure: unknown;
  let stalePreviewEtag = "";
  let staleSelectedItemIds: string[] = [];

  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/imports?householdId=${encodeURIComponent(household.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("heading", {
        name: "Review every row before it becomes a commitment",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Raw CSV content is processed in bounded request memory and is not committed to storage.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Unconfirmed previews expire no later than 24 hours after upload.",
        { exact: true },
      ),
    ).toBeVisible();
    await expectReducedMotion(page);

    const documentResponse = await page.request.get(
      `${baseUrl}/imports?householdId=${encodeURIComponent(household.id)}`,
    );
    expect(documentResponse.headers()["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(documentResponse.headers()["cross-origin-opener-policy"]).toBe(
      "same-origin-allow-popups",
    );
    expect(documentResponse.headers()["cross-origin-resource-policy"]).toBe(
      "same-origin",
    );
    expect(documentResponse.headers()["cross-origin-embedder-policy"]).toBe(
      undefined,
    );

    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "Download exact CSV template" })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      "autopay-guard-import-template-v1.csv",
    );
    const downloadPath = await download.path();
    if (!downloadPath) {
      throw new Error("The controlled CSV template was not downloaded.");
    }
    expect(await readFile(downloadPath, "utf8")).toBe(`${header}\n`);

    const csv = [
      header,
      csvRow([
        firstName,
        "SUBSCRIPTION",
        "275",
        "INR",
        "MONTHLY",
        dateInMonth(projectionMonth, 26),
        "UPI_AUTOPAY",
        "",
      ]),
      csvRow([
        duplicateName,
        "SOFTWARE",
        "125",
        "INR",
        "MONTHLY",
        dateInMonth(projectionMonth, 15),
        "CARD_RECURRING",
        "",
      ]),
      csvRow([
        duplicateName,
        "SOFTWARE",
        "125",
        "INR",
        "MONTHLY",
        dateInMonth(projectionMonth, 15),
        "CARD_RECURRING",
        "",
      ]),
      csvRow(existingFixture.csvFields),
      csvRow([
        catalogFixture.alias,
        catalogFixture.category,
        "60",
        "INR",
        "MONTHLY",
        dateInMonth(projectionMonth, 10),
        "CASH_OR_MANUAL",
        "",
      ]),
      csvRow([
        `M6 UI Invalid ${suffix}`,
        "SOFTWARE",
        "1e3",
        "inr",
        "CUSTOM",
        `${projectionMonth}-1`,
        "bad",
        "",
      ]),
    ].join("\n");
    await page.getByLabel("CSV file").setInputFiles({
      name: "m6-owner-fixture.CSV",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    const createImportOutcomePromise = Promise.race([
      page
        .waitForResponse(isImportCreateResponse)
        .then((response) => ({ response })),
      page
        .waitForEvent("requestfailed", {
          predicate: isImportCreateRequest,
        })
        .then((request) => ({
          failure:
            request.failure()?.errorText ?? "unknown browser request failure",
        })),
      page
        .getByRole("alert")
        .filter({ hasText: "Import action not completed" })
        .waitFor({ state: "visible" })
        .then(() => ({ clientError: true as const })),
    ]);
    const previewResponseResultPromise = page
      .waitForResponse(isImportPreviewResponse)
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      );
    await page.getByRole("button", { name: "Upload and preview" }).focus();
    await page.keyboard.press("Enter");
    const createImportOutcome = await createImportOutcomePromise;
    if ("clientError" in createImportOutcome) {
      throw new Error(
        "The import client surfaced an error before receiving a response.",
      );
    }
    if ("failure" in createImportOutcome) {
      throw new Error(
        `The import upload request failed before a response: ${createImportOutcome.failure}.`,
      );
    }
    const createImportResponse = createImportOutcome.response;
    expect(createImportResponse.status()).toBe(201);
    const createImport = (await createImportResponse.json()) as ImportJobDto;
    requireUuid(createImport.id, "created import");
    expect(createImport.householdId).toBe(household.id);
    importJobIds.push(createImport.id);

    const previewResponseResult = await previewResponseResultPromise;
    if ("error" in previewResponseResult) {
      throw previewResponseResult.error;
    }
    const previewResponse = previewResponseResult.response;
    expect(previewResponse.status()).toBe(200);
    expect(new URL(previewResponse.url()).pathname).toBe(
      `/api/bff/v1/imports/${createImport.id}`,
    );
    const preview = (await previewResponse.json()) as ImportPreviewDto;
    expect(preview.id).toBe(createImport.id);
    const existingItem = preview.items.find(
      (item) => item.preview?.name === existingFixture.displayName,
    );
    expect(existingItem?.duplicateKind).toBe("EXISTING");
    const catalogItem = preview.items.find(
      (item) => item.preview?.name === catalogFixture.alias,
    );
    expect(catalogItem?.duplicateKind).toBe("NONE");
    expect(catalogItem?.preview?.merchantId).toBe(catalogFixture.id);
    stalePreviewEtag = previewResponse.headers().etag ?? "";
    expect(stalePreviewEtag).toBe(`"${preview.version}"`);
    staleSelectedItemIds = preview.items
      .filter((item) => item.valid && item.duplicateKind === "NONE")
      .map((item) => item.id);
    expect(staleSelectedItemIds).toHaveLength(3);

    await expect(
      page.getByRole("heading", {
        name: "Select valid normalized rows",
      }),
    ).toBeVisible();
    await expect(page.getByText("Duplicate in this file")).toBeVisible();
    await expect(page.getByText("Matches an active commitment")).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Row 4" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Row 5" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Row 7 — invalid" }),
    ).toBeDisabled();
    await expect(
      page.getByText(catalogFixture.alias, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("1e3", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(
        "Preview only. Nothing is created until you confirm selected rows.",
      ),
    ).toBeVisible();

    const before = await listCommitments(page, household.id);
    expect(
      before.filter((item) => importedNames.has(item.displayName)),
    ).toEqual([]);
    expect(
      before.filter(
        (item) =>
          item.displayName === existingFixture.displayName &&
          item.status === "ACTIVE",
      ),
    ).toHaveLength(1);

    await expectRealUiQuality(page, testInfo, "M6 import preview");
    await expectBrowserStorageEmpty(page);

    staleOwnerTab = await page.context().newPage();
    await staleOwnerTab.goto(
      `/imports?householdId=${encodeURIComponent(household.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    const staleRead = await api(
      staleOwnerTab,
      "GET",
      `/v1/imports/${createImport.id}`,
    );
    const staleReadBody = await responseJson<ImportPreviewDto>(staleRead);
    expect(staleReadBody.version).toBe(preview.version);
    expect(etag(staleRead, staleReadBody.version)).toBe(stalePreviewEtag);

    const firstSelectedRow = page.getByRole("checkbox", { name: "Row 2" });
    await firstSelectedRow.focus();
    await page.keyboard.press("Space");
    await expect(firstSelectedRow).not.toBeChecked();
    await page.keyboard.press("Space");
    await expect(firstSelectedRow).toBeChecked();
    const reviewButton = page.getByRole("button", {
      name: "Review 3 selected rows",
    });
    await reviewButton.focus();
    await page.keyboard.press("Enter");
    const confirmationAcknowledgement = page.getByRole("checkbox", {
      name: /I reviewed the selected rows/,
    });
    await confirmationAcknowledgement.focus();
    await page.keyboard.press("Space");
    await expect(confirmationAcknowledgement).toBeChecked();
    const confirmResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/bff/v1/imports/${createImport.id}/confirm`,
    );
    const createButton = page.getByRole("button", {
      name: "Create selected commitments",
    });
    await createButton.focus();
    await page.keyboard.press("Enter");
    const confirmResponse = await confirmResponsePromise;
    expect(confirmResponse.status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        name: "Your selected rows are now tracked",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/Confirmation operated only on the normalized preview/),
    ).toBeVisible();

    const created = (await listCommitments(page, household.id)).filter((item) =>
      importedNames.has(item.displayName),
    );
    expect(created).toHaveLength(3);
    for (const commitment of created) {
      const response = await api(
        page,
        "GET",
        `/v1/commitments/${commitment.id}`,
      );
      const detail = await responseJson<{
        version: number;
        visibility: string;
        source: string;
        merchantId: string | null;
      }>(response);
      expect(detail.visibility).toBe("PRIVATE");
      expect(detail.source).toBe("CSV");
      if (commitment.displayName === catalogFixture.alias) {
        expect(detail.merchantId).toBe(catalogFixture.id);
      }
      etag(response, detail.version);
    }
    const existingAfterConfirm = (
      await listCommitments(page, household.id)
    ).filter(
      (item) =>
        item.displayName === existingFixture.displayName &&
        item.status === "ACTIVE",
    );
    expect(existingAfterConfirm).toHaveLength(1);
    const existingResponse = await api(
      page,
      "GET",
      `/v1/commitments/${existingAfterConfirm[0]!.id}`,
    );
    const existingDetail = await responseJson<{ source: string }>(
      existingResponse,
    );
    expect(existingDetail.source).toBe("MANUAL");

    const staleConflict = await api(
      staleOwnerTab,
      "POST",
      `/v1/imports/${createImport.id}/confirm`,
      {
        data: { selectedItemIds: staleSelectedItemIds },
        expectedStatus: 412,
        headers: {
          "idempotency-key": idempotencyKey("m6-real-stale-confirm"),
          "if-match": stalePreviewEtag,
        },
      },
    );
    expect(staleConflict.status()).toBe(412);
    const afterConflict = await listCommitments(page, household.id);
    for (const displayName of importedNames) {
      expect(
        afterConflict.filter((item) => item.displayName === displayName),
      ).toHaveLength(1);
    }
    await expectDashboardAndOccurrenceReconciliation({
      baseline: baselineDashboard,
      created,
      householdId: household.id,
      page,
      preview,
      projectionMonth,
    });
    await expectImportAccessDenied({
      browser,
      householdId: household.id,
      importId: createImport.id,
      oldEtag: stalePreviewEtag,
      testInfo,
    });
    await staleOwnerTab.close();
    staleOwnerTab = undefined;

    await page.goto(
      `/imports?householdId=${encodeURIComponent(household.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    const discardCsv = [
      header,
      `M6 UI Discard ${suffix},MEMBERSHIP,50,INR,MONTHLY,${dateInMonth(
        projectionMonth,
        20,
      )},CASH_OR_MANUAL,`,
    ].join("\n");
    await page.getByLabel("CSV file").setInputFiles({
      name: "m6-discard.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(discardCsv, "utf8"),
    });
    const discardCreateResponsePromise = page.waitForResponse(
      isImportCreateResponse,
    );
    const discardPreviewResponsePromise = page.waitForResponse(
      isImportPreviewResponse,
    );
    await page.getByRole("button", { name: "Upload and preview" }).click();
    const discardCreateResponse = await discardCreateResponsePromise;
    expect(discardCreateResponse.status()).toBe(201);
    const discardImport = (await discardCreateResponse.json()) as ImportJobDto;
    requireUuid(discardImport.id, "discard import");
    expect(discardImport.householdId).toBe(household.id);
    importJobIds.push(discardImport.id);
    const discardPreviewResponse = await discardPreviewResponsePromise;
    expect(discardPreviewResponse.status()).toBe(200);
    expect(new URL(discardPreviewResponse.url()).pathname).toBe(
      `/api/bff/v1/imports/${discardImport.id}`,
    );
    await page.getByRole("button", { name: "Discard preview" }).click();
    await expect(
      page.getByRole("heading", { name: "Discard this preview?" }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Discard normalized preview" })
      .click();
    await expect(
      page.getByText(
        "Preview discarded. No commitment was created. Discard operated only on the normalized preview.",
      ),
    ).toBeVisible();
    await expectBrowserStorageEmpty(page);
  } catch (error) {
    primaryFailure = error;
  } finally {
    await staleOwnerTab?.close().catch(() => undefined);
    try {
      await cleanupM6ImportFixtures({
        householdId: household.id,
        importJobIds,
        runToken: suffix,
      });
      await assertM6CleanBaseline(household.id);
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (primaryFailure || cleanupFailure) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure].filter(Boolean),
      "The M6 real-OIDC import journey or its exact cleanup failed.",
    );
  }

  await signOutAndProtect(
    page,
    `/imports?householdId=${encodeURIComponent(household.id)}`,
  );
});

interface ImportJobDto {
  id: string;
  householdId: string;
}

interface ImportPreviewDto extends ImportJobDto {
  version: number;
  items: Array<{
    id: string;
    valid: boolean;
    duplicateKind: "NONE" | "IN_FILE" | "EXISTING" | null;
    preview: {
      name: string;
      amountMinor: number;
      currency: string;
      frequency: string;
      nextDueDate: string;
      merchantId: string | null;
    } | null;
  }>;
}

interface CanonicalCommitmentDto {
  id: string;
  householdId: string;
  displayName: string;
  category: string;
  paymentRail: string;
  amountMinor: number | null;
  currency: string;
  frequency: string;
  anchorDate: string;
  nextDueDate: string | null;
  variableAmount: boolean;
  source: string;
  status: string;
}

interface DashboardSummaryDto {
  householdId: string;
  month: string;
  activeCommitmentCount: number;
  monthlyProjection: ProjectionPeriodDto;
  annualizedProjection: ProjectionPeriodDto;
}

interface ProjectionPeriodDto {
  occurrenceCount: number;
  totals: Array<{
    currency: string;
    fixedAmountMinor: number;
    knownTotalMinor: number;
  }>;
}

async function resolveExistingDuplicateFixture(
  page: Page,
  householdId: string,
) {
  const summaries = (await listCommitments(page, householdId))
    .filter((item) => item.status === "ACTIVE")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const summary of summaries) {
    const response = await api(page, "GET", `/v1/commitments/${summary.id}`);
    const detail = await responseJson<CanonicalCommitmentDto>(response);
    if (
      detail.householdId === householdId &&
      detail.status === "ACTIVE" &&
      detail.source === "MANUAL" &&
      detail.variableAmount === false &&
      Number.isSafeInteger(detail.amountMinor) &&
      (detail.amountMinor ?? 0) > 0 &&
      ["WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"].includes(
        detail.frequency,
      ) &&
      typeof detail.nextDueDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(detail.nextDueDate)
    ) {
      return {
        displayName: detail.displayName,
        csvFields: [
          detail.displayName,
          detail.category,
          minorToCsv(detail.amountMinor!),
          detail.currency,
          detail.frequency,
          detail.nextDueDate,
          detail.paymentRail,
          "",
        ],
      };
    }
  }
  throw new Error(
    "No fixed canonical commitment was available for the EXISTING duplicate fixture.",
  );
}

async function resolveCatalogFixture(page: Page) {
  const alias = "cloud nest";
  const initial = await apiJson<{
    items: Array<{
      id: string;
      canonicalName: string;
      category: string;
      websiteHost: string;
    }>;
  }>(
    page,
    "GET",
    `/v1/merchants/search?${new URLSearchParams({
      q: alias,
      limit: "20",
    }).toString()}`,
  );
  if (initial.items.length !== 1) {
    throw new Error(
      "The bundled merchant alias did not resolve to exactly one catalog item.",
    );
  }
  const merchant = initial.items[0]!;
  requireUuid(merchant.id, "catalog merchant");
  expect(merchant.websiteHost.endsWith(".example")).toBe(true);
  const compatible = await apiJson<typeof initial>(
    page,
    "GET",
    `/v1/merchants/search?${new URLSearchParams({
      q: alias,
      category: merchant.category,
      limit: "20",
    }).toString()}`,
  );
  expect(compatible.items).toHaveLength(1);
  expect(compatible.items[0]?.id).toBe(merchant.id);
  return {
    alias,
    category: merchant.category,
    id: merchant.id,
  };
}

async function dashboardSummary(
  page: Page,
  householdId: string,
  month: string,
) {
  return apiJson<DashboardSummaryDto>(
    page,
    "GET",
    `/v1/dashboard/summary?${new URLSearchParams({
      householdId,
      month,
    }).toString()}`,
  );
}

async function expectDashboardAndOccurrenceReconciliation({
  baseline,
  created,
  householdId,
  page,
  preview,
  projectionMonth,
}: {
  baseline: DashboardSummaryDto;
  created: Array<{ id: string; displayName: string }>;
  householdId: string;
  page: Page;
  preview: ImportPreviewDto;
  projectionMonth: string;
}) {
  const selected = preview.items.filter(
    (item) => item.valid && item.duplicateKind === "NONE" && item.preview,
  );
  expect(selected).toHaveLength(created.length);
  const selectedAmountMinor = selected.reduce(
    (total, item) => total + (item.preview?.amountMinor ?? 0),
    0,
  );
  expect(
    selected.every(
      (item) =>
        item.preview?.currency === "INR" &&
        item.preview.frequency === "MONTHLY" &&
        item.preview.nextDueDate.startsWith(`${projectionMonth}-`),
    ),
  ).toBe(true);

  const updated = await dashboardSummary(page, householdId, projectionMonth);
  expect(updated.activeCommitmentCount).toBe(
    baseline.activeCommitmentCount + created.length,
  );
  expect(updated.monthlyProjection.occurrenceCount).toBe(
    baseline.monthlyProjection.occurrenceCount + created.length,
  );
  expect(updated.annualizedProjection.occurrenceCount).toBe(
    baseline.annualizedProjection.occurrenceCount + created.length * 12,
  );
  const baselineMonthly = currencyTotal(baseline.monthlyProjection, "INR");
  const updatedMonthly = currencyTotal(updated.monthlyProjection, "INR");
  expect(updatedMonthly.fixedAmountMinor).toBe(
    baselineMonthly.fixedAmountMinor + selectedAmountMinor,
  );
  expect(updatedMonthly.knownTotalMinor).toBe(
    baselineMonthly.knownTotalMinor + selectedAmountMinor,
  );
  const baselineAnnual = currencyTotal(baseline.annualizedProjection, "INR");
  const updatedAnnual = currencyTotal(updated.annualizedProjection, "INR");
  expect(updatedAnnual.fixedAmountMinor).toBe(
    baselineAnnual.fixedAmountMinor + selectedAmountMinor * 12,
  );
  expect(updatedAnnual.knownTotalMinor).toBe(
    baselineAnnual.knownTotalMinor + selectedAmountMinor * 12,
  );

  const range = monthRange(projectionMonth);
  for (const commitment of created) {
    const expectedPreview = selected.find(
      (item) => item.preview?.name === commitment.displayName,
    )?.preview;
    if (!expectedPreview) {
      throw new Error("A created commitment had no selected preview row.");
    }
    const occurrences = await apiJson<{
      from: string;
      to: string;
      items: Array<{
        commitmentId: string;
        scheduledDate: string;
        expectedAmountMinor: number | null;
        currency: string;
        amountKind: string;
        state: string;
      }>;
    }>(
      page,
      "GET",
      `/v1/commitments/${commitment.id}/occurrences?${new URLSearchParams(
        range,
      ).toString()}`,
    );
    expect(occurrences.items).toEqual([
      expect.objectContaining({
        commitmentId: commitment.id,
        scheduledDate: expectedPreview.nextDueDate,
        expectedAmountMinor: expectedPreview.amountMinor,
        currency: expectedPreview.currency,
        amountKind: "FIXED",
        state: "UPCOMING",
      }),
    ]);
  }

  await page.goto(
    `/dashboard?${new URLSearchParams({
      householdId,
      month: projectionMonth,
    }).toString()}`,
    { waitUntil: "domcontentloaded" },
  );
  const activeCard = page
    .locator(".summary-card")
    .filter({ hasText: "Active commitments" });
  await expect(
    activeCard.getByText(String(updated.activeCommitmentCount), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".projection-panel").first().locator('[data-currency="INR"]'),
  ).toContainText(formatMinorForAssertion(updatedMonthly.knownTotalMinor));

  await page.goto(
    `/upcoming?${new URLSearchParams({
      householdId,
      month: projectionMonth,
    }).toString()}`,
    { waitUntil: "domcontentloaded" },
  );
  for (const commitment of created) {
    await expect(
      page.getByText(commitment.displayName, { exact: true }),
    ).toHaveCount(1);
  }
}

async function expectImportAccessDenied({
  browser,
  householdId,
  importId,
  oldEtag,
  testInfo,
}: {
  browser: Browser;
  householdId: string;
  importId: string;
  oldEtag: string;
  testInfo: TestInfo;
}) {
  const identities: Array<{
    identity: RealIdentity;
    returnTo: string;
  }> = [
    { identity: "member", returnTo: "/settings/privacy" },
    { identity: "foreign", returnTo: "/household" },
    { identity: "guideAdmin", returnTo: "/admin/guides" },
    { identity: "privacyAdmin", returnTo: "/admin/privacy" },
    { identity: "auditRead", returnTo: "/admin/audit" },
    { identity: "supportRead", returnTo: "/support/diagnostics" },
  ];
  const missingImportId = randomUUID();
  for (const { identity, returnTo } of identities) {
    const session = await createRealSession(
      browser,
      identity,
      testInfo,
      returnTo,
    );
    try {
      const knownRead = await api(
        session.page,
        "GET",
        `/v1/imports/${importId}`,
        { expectedStatus: [403, 404] },
      );
      const missingRead = await api(
        session.page,
        "GET",
        `/v1/imports/${missingImportId}`,
        { expectedStatus: [403, 404] },
      );
      expect(knownRead.status()).toBe(missingRead.status());

      const knownDiscard = await api(
        session.page,
        "DELETE",
        `/v1/imports/${importId}`,
        {
          expectedStatus: [403, 404],
          headers: { "if-match": oldEtag },
        },
      );
      const missingDiscard = await api(
        session.page,
        "DELETE",
        `/v1/imports/${missingImportId}`,
        {
          expectedStatus: [403, 404],
          headers: { "if-match": oldEtag },
        },
      );
      expect(knownDiscard.status()).toBe(missingDiscard.status());
      expect(await knownRead.text()).not.toContain(householdId);
    } finally {
      await session.context.close();
    }
  }
}

async function expectReducedMotion(page: Page) {
  const state = await page
    .getByRole("button", { name: "Upload and preview" })
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        animationDuration: Number.parseFloat(style.animationDuration),
        animationIterationCount: style.animationIterationCount,
        transitionDuration: Number.parseFloat(style.transitionDuration),
      };
    });
  expect(state.matches).toBe(true);
  expect(state.animationDuration).toBeLessThanOrEqual(0.001);
  expect(state.animationIterationCount).toBe("1");
  expect(state.transitionDuration).toBeLessThanOrEqual(0.001);
}

function currencyTotal(period: ProjectionPeriodDto, currency: string) {
  const total = period.totals.find((item) => item.currency === currency);
  if (!total) {
    throw new Error(`The ${currency} projection total was missing.`);
  }
  return total;
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) {
    throw new Error("The projection month was invalid.");
  }
  const lastDay = new Date(Date.UTC(year, monthNumber, 0))
    .getUTCDate()
    .toString()
    .padStart(2, "0");
  return {
    from: `${month}-01`,
    to: `${month}-${lastDay}`,
  };
}

function nextProjectionMonth(timeZone: string, epochMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(epochMs));
  const year = Number(parts.find(({ type }) => type === "year")?.value);
  const month = Number(parts.find(({ type }) => type === "month")?.value);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error("Could not derive the household-local projection month.");
  }
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  if (nextYear > 2200) {
    throw new Error(
      "The next projection month exceeds the supported date range.",
    );
  }
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

function dateInMonth(month: string, day: number) {
  const range = monthRange(month);
  const lastDay = Number(range.to.slice(-2));
  if (!Number.isInteger(day) || day < 1 || day > lastDay) {
    throw new Error("The fixture day is outside the projection month.");
  }
  return `${month}-${String(day).padStart(2, "0")}`;
}

function csvRow(fields: string[]) {
  if (fields.length !== 8) {
    throw new Error("An M6 fixture row did not contain exactly eight fields.");
  }
  return fields
    .map((field) => {
      if (/[\r\n]/.test(field)) {
        throw new Error("An M6 fixture field contained a line break.");
      }
      return /[",]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
    })
    .join(",");
}

function minorToCsv(minor: number) {
  if (!Number.isSafeInteger(minor) || minor < 1) {
    throw new Error("The canonical fixed amount was invalid.");
  }
  const whole = Math.floor(minor / 100);
  const fraction = minor % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, "0")}`;
}

function formatMinorForAssertion(minor: number) {
  const amount = minorToCsv(minor);
  const [whole, fraction] = amount.split(".");
  const lastThree = whole!.slice(-3);
  const leading = whole!.slice(0, -3);
  const groups: string[] = [];
  for (let index = leading.length; index > 0; index -= 2) {
    groups.unshift(leading.slice(Math.max(0, index - 2), index));
  }
  return `${groups.length > 0 ? `${groups.join(",")},` : ""}${lastThree}${
    fraction ? `.${fraction}` : ""
  }`;
}

function isImportCreateResponse(response: {
  request(): { method(): string };
  url(): string;
}) {
  return (
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/bff/v1/imports"
  );
}

function isImportCreateRequest(request: { method(): string; url(): string }) {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/bff/v1/imports"
  );
}

function isImportPreviewResponse(response: {
  request(): { method(): string };
  url(): string;
}) {
  return (
    response.request().method() === "GET" &&
    /^\/api\/bff\/v1\/imports\/[0-9a-f-]{36}$/.test(
      new URL(response.url()).pathname,
    )
  );
}

function alphabeticRunToken() {
  return randomUUID()
    .replaceAll("-", "")
    .slice(0, 8)
    .split("")
    .map((hexCharacter) =>
      String.fromCharCode(
        "a".charCodeAt(0) + Number.parseInt(hexCharacter, 16),
      ),
    )
    .join("");
}

function requireUuid(value: string, label: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`The ${label} identifier was invalid.`);
  }
}
