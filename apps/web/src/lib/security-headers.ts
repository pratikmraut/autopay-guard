export interface SecurityHeader {
  key: string;
  value: string;
}

export function securityHeaders(
  nodeEnvironment: string | undefined,
): SecurityHeader[] {
  const scriptSource =
    nodeEnvironment === "development"
      ? "'self' 'unsafe-inline' 'unsafe-eval'"
      : "'self' 'unsafe-inline'";
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSource}`,
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    {
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin-allow-popups",
    },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];
}

export function applyRuntimeTransportSecurity(
  headers: Headers,
  runtimeMode: string | undefined,
): void {
  if (runtimeMode === "PRODUCTION") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
}
