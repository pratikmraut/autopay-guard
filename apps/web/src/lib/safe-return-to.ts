const ALLOWED_RETURN_PATHS = new Set([
  "/dashboard",
  "/dashboard/savings",
  "/onboarding",
  "/more",
  "/household",
  "/commitments",
  "/commitments/new",
  "/notifications",
  "/settings/notifications",
  "/settings/privacy",
  "/settings/support",
  "/upcoming",
  "/upcoming/decisions",
  "/admin/privacy",
  "/admin/guides",
  "/admin/audit",
  "/support/diagnostics",
]);

const UUID_SEGMENT =
  "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}";
const ALLOWED_DYNAMIC_RETURN_PATHS = [
  new RegExp(`^/admin/guides/${UUID_SEGMENT}$`),
  new RegExp(`^/admin/guides/drafts/${UUID_SEGMENT}$`),
  new RegExp(`^/commitments/${UUID_SEGMENT}$`),
  new RegExp(`^/commitments/${UUID_SEGMENT}/edit$`),
  new RegExp(`^/commitments/${UUID_SEGMENT}/reminders$`),
  new RegExp(`^/commitments/${UUID_SEGMENT}/cancellation$`),
  new RegExp(
    `^/commitments/${UUID_SEGMENT}/cancellation/attempts/${UUID_SEGMENT}$`,
  ),
  new RegExp(`^/notifications/${UUID_SEGMENT}$`),
];

export function safeReturnTo(candidate: string | string[] | undefined) {
  if (typeof candidate !== "string" || candidate.includes("\\")) {
    return "/onboarding";
  }

  try {
    const parsed = new URL(candidate, "https://autopay-guard.invalid");
    if (
      parsed.origin !== "https://autopay-guard.invalid" ||
      !isAllowedReturnPath(parsed.pathname)
    ) {
      return "/onboarding";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/onboarding";
  }
}

function isAllowedReturnPath(pathname: string) {
  return (
    ALLOWED_RETURN_PATHS.has(pathname) ||
    ALLOWED_DYNAMIC_RETURN_PATHS.some((pattern) => pattern.test(pathname))
  );
}
