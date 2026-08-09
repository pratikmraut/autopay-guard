const MAX_AMOUNT_MINOR = 999_999_999_999;
const DECIMAL_AMOUNT = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

export function parseMajorToMinor(
  value: string,
  currency = "INR",
): number | null {
  const normalized = value.trim();
  const match = DECIMAL_AMOUNT.exec(normalized);
  if (!match) {
    return null;
  }

  const fractionDigits = currencyFractionDigits(currency);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (
    fraction.length > fractionDigits ||
    (fractionDigits === 0 && fraction.length > 0)
  ) {
    return null;
  }
  const minor = Number(`${whole}${fraction.padEnd(fractionDigits, "0")}`);

  return Number.isSafeInteger(minor) && minor <= MAX_AMOUNT_MINOR
    ? minor
    : null;
}

export function minorToMajorInput(
  minor: number | null | undefined,
  currency = "INR",
) {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) {
    return "";
  }

  const fractionDigits = currencyFractionDigits(currency);
  const scale = 10 ** fractionDigits;
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / scale);
  if (fractionDigits === 0) {
    return `${sign}${whole}`;
  }
  const fraction = String(absolute % scale).padStart(fractionDigits, "0");
  return `${sign}${whole}.${fraction}`;
}

export function formatMinorMoney(minor: number, currency = "INR") {
  if (!Number.isSafeInteger(minor)) {
    return "—";
  }

  const normalizedCurrency = currency.toUpperCase();
  const fractionDigits = currencyFractionDigits(normalizedCurrency);
  const scale = 10 ** fractionDigits;
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / scale);
  const minorFraction = absolute % scale;
  const grouped = groupIndianDigits(String(whole));
  const fraction =
    minorFraction === 0
      ? ""
      : `.${String(minorFraction).padStart(fractionDigits, "0")}`;
  const symbol = currencyInputPrefix(normalizedCurrency);
  const separator = symbol.length === 1 ? "" : " ";

  return `${sign}${symbol}${separator}${grouped}${fraction}`;
}

export function currencyFractionDigits(currency: string): number {
  try {
    const digits =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2;
    return Number.isInteger(digits) && digits >= 0 && digits <= 6 ? digits : 2;
  } catch {
    return 2;
  }
}

export function currencyInputPrefix(currency: string): string {
  const normalized = currency.toUpperCase();
  return normalized === "INR" ? "₹" : normalized;
}

export function currencyAmountPlaceholder(currency: string): string {
  const fractionDigits = currencyFractionDigits(currency);
  return fractionDigits === 0 ? "499" : `499.${"0".repeat(fractionDigits)}`;
}

function groupIndianDigits(value: string) {
  if (value.length <= 3) {
    return value;
  }

  const lastThree = value.slice(-3);
  const leading = value.slice(0, -3);
  const groups: string[] = [];
  for (let index = leading.length; index > 0; index -= 2) {
    groups.unshift(leading.slice(Math.max(0, index - 2), index));
  }
  return `${groups.join(",")},${lastThree}`;
}
