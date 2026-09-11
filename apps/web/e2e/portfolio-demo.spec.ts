import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("isolates the sample per tab and reconciles every working action without API calls", async ({
  page,
  context,
}) => {
  const apiRequests: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.goto("/demo");
  await expect(page.getByLabel("Monthly sample total")).toHaveText("₹4,500");
  await expect(
    page.getByText(
      /Sample data only. Changes stay in this tab and reset on refresh/,
    ),
  ).toBeVisible();
  const otherTab = await context.newPage();
  await otherTab.goto("/demo");

  await page.getByRole("button", { name: "Add sample commitment" }).click();
  await page
    .getByLabel("Fictional commitment name")
    .fill("Portfolio Browser Sample");
  await page.getByLabel("Amount (INR)").fill("250");
  await page.getByRole("button", { name: "Add to this sample" }).click();
  await expect(page.getByLabel("Monthly sample total")).toHaveText("₹4,750");
  await expect(otherTab.getByLabel("Monthly sample total")).toHaveText(
    "₹4,500",
  );

  await page
    .getByRole("button", { name: "Edit Portfolio Browser Sample" })
    .click();
  await page.getByLabel("Amount (INR)").fill("275");
  await page.getByRole("button", { name: "Save sample changes" }).click();
  await expect(page.getByLabel("12-month sample total")).toHaveText("₹57,300");
  await page
    .getByRole("button", { name: "Archive Portfolio Browser Sample" })
    .click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.getByLabel("Monthly sample total")).toHaveText("₹4,500");
  await expect(page.getByLabel("12-month sample total")).toHaveText("₹54,000");

  await page.getByRole("button", { name: "Archive StreamBox Demo" }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.getByLabel("Monthly sample total")).toHaveText("₹4,000");
  await page.getByRole("button", { name: "Reset sample" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByLabel("Monthly sample total")).toHaveText("₹4,500");

  await page.getByRole("button", { name: "Archive StreamBox Demo" }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await page.reload();
  await expect(page.getByLabel("Monthly sample total")).toHaveText("₹4,500");
  expect(apiRequests).toEqual([]);
  await otherTab.close();
});

test("supports mobile layouts, keyboard editing, validation, and accessible sample content", async ({
  page,
}) => {
  await page.goto("/demo");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  let accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  const add = page.getByRole("button", { name: "Add sample commitment" });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Fictional commitment name")).toBeFocused();
  await page.getByRole("button", { name: "Add to this sample" }).click();
  // Next.js also renders a route-announcer alert outside the editor. Assert
  // focus on the form's validation summary without matching that live region.
  await expect(
    page
      .getByRole("form", { name: "Add a fictional commitment" })
      .getByRole("alert"),
  ).toBeFocused();
  accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(add).toBeFocused();
});
