export type SafeGuideTargetKind = "HTTPS" | "DEMO_APP";

export interface SafeGuideTarget {
  href: string;
  kind: SafeGuideTargetKind;
  displayHost: string;
}

const ENCODED_DELIMITER_OR_TRAVERSAL = /%(?:2e|2f|3a|40|5c)/i;

export function parseSafeGuideTarget(value: string): SafeGuideTarget | null {
  if (
    value.length < 1 ||
    value.length > 2_048 ||
    /[^\x21-\x7e]/.test(value) ||
    value.includes("\\") ||
    ENCODED_DELIMITER_OR_TRAVERSAL.test(value)
  ) {
    return null;
  }

  const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)(?:\/|$)/);
  if (!authority || authority[1] !== authority[1].toLowerCase()) {
    return null;
  }

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return null;
  }
  if (
    target.username ||
    target.password ||
    target.port ||
    target.search ||
    target.hash ||
    target.href !== value ||
    !isNormalizedPath(target.pathname)
  ) {
    return null;
  }

  if (
    target.protocol === "https:" &&
    isReservedExampleHost(target.hostname) &&
    target.pathname === "/manage/subscription"
  ) {
    return {
      href: target.href,
      kind: "HTTPS",
      displayHost: target.hostname,
    };
  }
  if (
    target.protocol === "autopayguard-demo:" &&
    target.hostname === "mandates" &&
    target.pathname === "/service/manage"
  ) {
    return {
      href: target.href,
      kind: "DEMO_APP",
      displayHost: "AutoPay Guard demo app",
    };
  }
  return null;
}

function isReservedExampleHost(hostname: string) {
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.at(-1) !== "example" ||
    labels.some(
      (label) =>
        !label ||
        label.startsWith("xn--") ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return false;
  }
  return true;
}

function isNormalizedPath(pathname: string) {
  if (!pathname.startsWith("/") || pathname.includes("//")) {
    return false;
  }
  return pathname
    .split("/")
    .every((segment) => segment !== "." && segment !== "..");
}
