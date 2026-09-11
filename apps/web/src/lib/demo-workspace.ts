import { monthRange } from "@/lib/local-date";
import { parseMajorToMinor } from "@/lib/money";

export const DEMO_MONTH = "2026-09";
export const DEMO_MAX_COMMITMENTS = 50;
export const DEMO_MAX_AMOUNT_MINOR = 100_000_000;

export type DemoCommitment = {
  id: string;
  name: string;
  amountMinor: number;
  estimated: boolean;
  day: number;
  archived: boolean;
};

export type DemoDraft = {
  name: string;
  amount: string;
  kind: string;
  day: string;
};

export type DemoDraftErrors = Partial<Record<keyof DemoDraft, string>>;

/** Fresh records on every call: never share mutable state between visitors. */
export function createDemoCommitments(): DemoCommitment[] {
  return [
    {
      id: "sample-stream",
      name: "StreamBox Demo",
      amountMinor: 50_000,
      day: 31,
      estimated: false,
      archived: false,
    },
    {
      id: "sample-cloud",
      name: "CloudNest Demo",
      amountMinor: 120_000,
      day: 15,
      estimated: false,
      archived: false,
    },
    {
      id: "sample-fitness",
      name: "FitClub Demo",
      amountMinor: 80_000,
      day: 5,
      estimated: false,
      archived: false,
    },
    {
      id: "sample-utility",
      name: "Monsoon Utility Demo",
      amountMinor: 200_000,
      day: 25,
      estimated: true,
      archived: false,
    },
  ];
}

export function validateDemoDraft(
  draft: DemoDraft,
):
  | { valid: true; value: Omit<DemoCommitment, "id" | "archived"> }
  | { valid: false; errors: DemoDraftErrors } {
  const errors: DemoDraftErrors = {};
  const name = draft.name.trim();
  if (
    name.length < 2 ||
    name.length > 60 ||
    !/^[\p{L}\p{N} &()'/-]+$/u.test(name) ||
    !/\p{L}/u.test(name) ||
    name.replace(/\D/g, "").length > 6
  ) {
    errors.name =
      "Use a fictional name of 2–60 characters, without links or contact details.";
  }
  const amountMinor = parseMajorToMinor(draft.amount, "INR");
  if (
    amountMinor === null ||
    amountMinor <= 0 ||
    amountMinor > DEMO_MAX_AMOUNT_MINOR
  ) {
    errors.amount =
      "Enter an amount from ₹0.01 to ₹10,00,000, using at most two decimal places and no commas.";
  }
  if (draft.kind !== "fixed" && draft.kind !== "estimated") {
    errors.kind = "Choose a fixed amount or an estimated variable amount.";
  }
  if (!/^(?:[1-9]|[12]\d|3[01])$/.test(draft.day)) {
    errors.day = "Enter a whole day from 1 to 31.";
  }
  if (Object.keys(errors).length > 0 || amountMinor === null) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    value: {
      name,
      amountMinor,
      estimated: draft.kind === "estimated",
      day: Number(draft.day),
    },
  };
}

/** A monthly-only illustrative schedule, with no proration or payment history. */
export function demoDueDate(yearMonth: string, day: number): string {
  if (
    !/^(?:20\d{2})-(?:0[1-9]|1[0-2])$/.test(yearMonth) ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  ) {
    throw new RangeError("Invalid demo month or anchor day.");
  }
  const lastDay = Number(monthRange(yearMonth).to.slice(-2));
  return `${yearMonth}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function demoProjection(
  commitments: DemoCommitment[],
  months: 1 | 12 = 1,
) {
  const active = commitments.filter((item) => !item.archived);
  const fixedMinor = active
    .filter((item) => !item.estimated)
    .reduce((sum, item) => sum + item.amountMinor * months, 0);
  const estimatedMinor = active
    .filter((item) => item.estimated)
    .reduce((sum, item) => sum + item.amountMinor * months, 0);
  return {
    fixedMinor,
    estimatedMinor,
    knownMinor: fixedMinor + estimatedMinor,
    occurrences: active.length * months,
    activeCount: active.length,
  };
}

export function demoUpcoming(commitments: DemoCommitment[], yearMonth: string) {
  return commitments
    .filter((item) => !item.archived)
    .map((item) => ({ ...item, dueDate: demoDueDate(yearMonth, item.day) }))
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name),
    );
}

export function archiveDemoCommitment(
  commitments: DemoCommitment[],
  id: string,
) {
  return commitments.map((item) =>
    item.id === id ? { ...item, archived: true } : item,
  );
}
