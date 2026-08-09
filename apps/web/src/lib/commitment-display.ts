import type {
  Commitment,
  CurrencyProjection,
  UpcomingItem,
} from "@autopay-guard/contracts";

import {
  labelForOption,
  recurrenceFrequencies,
} from "@/lib/commitment-options";
import { formatMinorMoney } from "@/lib/money";

const customUnitLabels: Record<string, [string, string]> = {
  DAYS: ["day", "days"],
  WEEKS: ["week", "weeks"],
  MONTHS: ["month", "months"],
  YEARS: ["year", "years"],
};

const recurrenceUnitLabels: Record<string, [string, string]> = {
  WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"],
  QUARTERLY: ["quarter", "quarters"],
  HALF_YEARLY: ["6-month period", "6-month periods"],
  YEARLY: ["year", "years"],
};

export function formatRecurrence(
  commitment: Pick<
    Commitment,
    "frequency" | "intervalCount" | "customIntervalUnit" | "monthDayPolicy"
  >,
) {
  let frequency: string;
  if (commitment.frequency === "CUSTOM" && commitment.customIntervalUnit) {
    const labels = customUnitLabels[commitment.customIntervalUnit] ?? [
      commitment.customIntervalUnit.toLowerCase(),
      commitment.customIntervalUnit.toLowerCase(),
    ];
    const unit = commitment.intervalCount === 1 ? labels[0] : labels[1];
    frequency = `Every ${commitment.intervalCount} ${unit}`;
  } else {
    if (commitment.intervalCount === 1) {
      frequency = labelForOption(recurrenceFrequencies, commitment.frequency);
    } else {
      const labels = recurrenceUnitLabels[commitment.frequency] ?? [
        "period",
        "periods",
      ];
      frequency = `Every ${commitment.intervalCount} ${labels[1]}`;
    }
  }
  return commitment.monthDayPolicy === "LAST_DAY"
    ? `${frequency}, on month end`
    : frequency;
}

export function upcomingAmountLabel(
  item: Pick<UpcomingItem, "amountKind" | "expectedAmountMinor" | "currency">,
) {
  if (
    item.amountKind === "UNKNOWN_VARIABLE" ||
    item.expectedAmountMinor === null
  ) {
    return { value: "Unknown", note: "Variable amount" };
  }
  const value = formatMinorMoney(item.expectedAmountMinor, item.currency);
  return item.amountKind === "ESTIMATED"
    ? { value: `≈ ${value}`, note: "Estimated variable" }
    : { value, note: "Fixed" };
}

export function projectionKnownTotal(
  projection: Pick<CurrencyProjection, "knownTotalMinor" | "currency">,
) {
  return formatMinorMoney(projection.knownTotalMinor, projection.currency);
}
