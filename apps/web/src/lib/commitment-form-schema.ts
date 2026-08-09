import { z } from "zod";

import {
  commitmentCategories,
  paymentRails,
  recurrenceFrequencies,
} from "@/lib/commitment-options";
import { currencyFractionDigits, parseMajorToMinor } from "@/lib/money";

const categoryValues = commitmentCategories.map(({ value }) => value) as [
  (typeof commitmentCategories)[number]["value"],
  ...(typeof commitmentCategories)[number]["value"][],
];
const railValues = paymentRails.map(({ value }) => value) as [
  (typeof paymentRails)[number]["value"],
  ...(typeof paymentRails)[number]["value"][],
];
const frequencyValues = recurrenceFrequencies.map(({ value }) => value) as [
  (typeof recurrenceFrequencies)[number]["value"],
  ...(typeof recurrenceFrequencies)[number]["value"][],
];

const commitmentFormFields = z.object({
  merchantId: z
    .union([z.literal(""), z.string().uuid()])
    .transform((value) => value || undefined)
    .optional(),
  displayName: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(120, "Use 120 characters or fewer."),
  category: z.enum(categoryValues),
  paymentRail: z.enum(railValues),
  amount: z.string().trim().max(20),
  variableAmount: z.boolean(),
  frequency: z.enum(frequencyValues),
  intervalCount: z.coerce
    .number()
    .int("Use a whole number.")
    .min(1, "Use an interval of at least 1.")
    .max(365, "Use an interval no greater than 365."),
  customIntervalUnit: z.enum(["DAYS", "WEEKS", "MONTHS", "YEARS"]).optional(),
  anchorDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid billing date."),
  monthDayPolicy: z.enum(["ANCHOR_DAY", "LAST_DAY"]),
  maskedPaymentLabel: z.string().trim().max(40).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export function createCommitmentFormSchema(currency = "INR") {
  return commitmentFormFields.superRefine((value, context) => {
    const parsedAmount = value.amount
      ? parseMajorToMinor(value.amount, currency)
      : null;
    if (!value.variableAmount && parsedAmount === null) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: validAmountMessage(currency, false),
      });
    } else if (
      !value.variableAmount &&
      parsedAmount !== null &&
      parsedAmount < 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: `Enter a fixed ${currency} amount greater than 0.`,
      });
    }
    if (value.variableAmount && value.amount && parsedAmount === null) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: validAmountMessage(currency, true),
      });
    } else if (
      value.variableAmount &&
      value.amount &&
      parsedAmount !== null &&
      parsedAmount < 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: `Enter a ${currency} estimate greater than 0 or leave it blank if unknown.`,
      });
    }
    if (value.frequency === "CUSTOM" && !value.customIntervalUnit) {
      context.addIssue({
        code: "custom",
        path: ["customIntervalUnit"],
        message: "Choose days, weeks, months, or years.",
      });
    }
    if (value.frequency !== "CUSTOM" && value.customIntervalUnit) {
      context.addIssue({
        code: "custom",
        path: ["customIntervalUnit"],
        message: "A custom unit is only valid for a custom frequency.",
      });
    }
    if (!isCalendarDate(value.anchorDate)) {
      context.addIssue({
        code: "custom",
        path: ["anchorDate"],
        message: "Choose a real calendar date.",
      });
    }
    if (
      value.monthDayPolicy === "LAST_DAY" &&
      isCalendarDate(value.anchorDate) &&
      !isLastDayOfMonth(value.anchorDate)
    ) {
      context.addIssue({
        code: "custom",
        path: ["monthDayPolicy"],
        message: "Last-day scheduling requires a month-end billing date.",
      });
    }
    if (
      value.monthDayPolicy === "LAST_DAY" &&
      (value.frequency === "WEEKLY" ||
        (value.frequency === "CUSTOM" &&
          ["DAYS", "WEEKS"].includes(value.customIntervalUnit ?? "")))
    ) {
      context.addIssue({
        code: "custom",
        path: ["monthDayPolicy"],
        message:
          "Last-day scheduling is only available for month-based recurrence.",
      });
    }
    if (value.maskedPaymentLabel) {
      const label = value.maskedPaymentLabel;
      if (
        /\b(?:otp|pin|password|passcode)\b/i.test(label) ||
        /\d{8,}/.test(label) ||
        label.includes("@")
      ) {
        context.addIssue({
          code: "custom",
          path: ["maskedPaymentLabel"],
          message:
            "Use a short masked label only—never a PIN, OTP, password, full number, or full UPI ID.",
        });
      }
    }
  });
}

export const commitmentFormSchema = createCommitmentFormSchema();

export type CommitmentFormValues = z.input<typeof commitmentFormSchema>;
export type ValidCommitmentFormValues = z.output<typeof commitmentFormSchema>;

export function isLastDayOfMonth(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isCalendarDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) {
    return false;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function validAmountMessage(currency: string, estimate: boolean) {
  const fractionDigits = currencyFractionDigits(currency);
  const precision =
    fractionDigits === 0
      ? "without decimal places"
      : `with up to ${fractionDigits} decimal place${fractionDigits === 1 ? "" : "s"}`;
  return estimate
    ? `Enter a valid ${currency} estimate ${precision}, or leave it blank if unknown.`
    : `Enter a valid ${currency} amount ${precision}.`;
}
