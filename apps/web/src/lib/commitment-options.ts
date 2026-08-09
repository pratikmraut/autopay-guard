export const commitmentCategories = [
  { value: "SUBSCRIPTION", label: "Subscription" },
  { value: "UTILITY", label: "Utility or telecom" },
  { value: "MEMBERSHIP", label: "Membership" },
  { value: "SOFTWARE", label: "Software" },
  { value: "EMI_LOAN", label: "EMI or loan" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "INVESTMENT_COMMITMENT", label: "Investment commitment" },
  { value: "EDUCATION", label: "Education" },
  { value: "OTHER", label: "Other recurring commitment" },
] as const;

export type CommitmentCategory = (typeof commitmentCategories)[number]["value"];

const pauseSafeCategories: ReadonlySet<CommitmentCategory> = new Set([
  "SUBSCRIPTION",
  "MEMBERSHIP",
  "SOFTWARE",
]);

export function categoryCanPauseTracking(category: CommitmentCategory) {
  return pauseSafeCategories.has(category);
}

export const paymentRails = [
  { value: "UPI_AUTOPAY", label: "UPI AutoPay" },
  { value: "CARD_RECURRING", label: "Recurring card payment" },
  { value: "NACH_ENACH", label: "NACH or eNACH" },
  { value: "APP_STORE", label: "App store" },
  { value: "MERCHANT_DIRECT", label: "Merchant-direct billing" },
  { value: "CASH_OR_MANUAL", label: "Cash or manual payment" },
  { value: "UNKNOWN", label: "Not sure yet" },
] as const;

export type PaymentRail = (typeof paymentRails)[number]["value"];

export const recurrenceFrequencies = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "HALF_YEARLY", label: "Every 6 months" },
  { value: "YEARLY", label: "Yearly" },
  { value: "CUSTOM", label: "Custom interval" },
] as const;

export type RecurrenceFrequency =
  (typeof recurrenceFrequencies)[number]["value"];

export const categoryGuidance: Record<
  CommitmentCategory,
  { title: string; body: string; tone: "control" | "caution" }
> = {
  SUBSCRIPTION: {
    title: "Review your options",
    body: "Keep, pause, switch, downgrade, or cancel only after checking the service and its payment instruction.",
    tone: "control",
  },
  UTILITY: {
    title: "Protect essential access",
    body: "Review the bill, compare providers, or switch when appropriate. Check continuity before changing an essential service.",
    tone: "caution",
  },
  MEMBERSHIP: {
    title: "Review your options",
    body: "Keep, pause, switch, downgrade, or cancel after checking the membership terms.",
    tone: "control",
  },
  SOFTWARE: {
    title: "Review your options",
    body: "Check current use, renewal terms, and data-export needs before changing the plan.",
    tone: "control",
  },
  EMI_LOAN: {
    title: "Due-date readiness only",
    body: "Track the due date and confirm payment readiness. AutoPay Guard does not recommend cancelling or stopping a loan payment.",
    tone: "caution",
  },
  INSURANCE: {
    title: "Review coverage carefully",
    body: "Use this as a renewal prompt. AutoPay Guard does not recommend discontinuing insurance coverage.",
    tone: "caution",
  },
  INVESTMENT_COMMITMENT: {
    title: "Tracking, not advice",
    body: "Record your own decision only. AutoPay Guard does not provide investment advice or recommend stopping an investment commitment.",
    tone: "caution",
  },
  EDUCATION: {
    title: "Review continuity first",
    body: "Check course access, learning continuity, and applicable terms before making a change.",
    tone: "caution",
  },
  OTHER: {
    title: "Review before acting",
    body: "Confirm what the charge covers and which payment instruction is responsible before making a change.",
    tone: "control",
  },
};

export function labelForOption<
  T extends readonly { value: string; label: string }[],
>(options: T, value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}
