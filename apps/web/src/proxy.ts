import { NextRequest, NextResponse } from "next/server";

import { shouldRejectRawBffRequest } from "@/lib/bff-raw-url.mjs";
import { applyRuntimeTransportSecurity } from "@/lib/security-headers";

export function proxy(request: NextRequest) {
  if (
    shouldRejectRawBffRequest(request.url) ||
    shouldRejectRawBffRequest(request.nextUrl.pathname)
  ) {
    return withRuntimeTransportSecurity(
      NextResponse.json(
        {
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "This BFF operation is not available.",
          correlationId: crypto.randomUUID(),
        },
        {
          status: 404,
          headers: {
            "cache-control": "no-store",
            "content-type": "application/problem+json",
            "x-autopay-guard-bff-path-policy": "rejected",
          },
        },
      ),
    );
  }

  return withRuntimeTransportSecurity(NextResponse.next());
}

function withRuntimeTransportSecurity(response: NextResponse): NextResponse {
  applyRuntimeTransportSecurity(
    response.headers,
    process.env.AUTOPAY_GUARD_RUNTIME_MODE,
  );
  return response;
}

export const config = {
  // Matching every request is deliberate: a raw target can normalize from a
  // non-/api prefix into /api/bff before filesystem routing.
  matcher: "/:path*",
};
