import { NextResponse } from "next/server";

const BODYLESS_RESPONSE_STATUSES: ReadonlySet<number> = new Set([
  204, 205, 304,
]);

export function createBffProxyResponse(
  status: number,
  headers: Headers,
  body: Uint8Array,
): NextResponse {
  const responseBody = BODYLESS_RESPONSE_STATUSES.has(status)
    ? null
    : copyToArrayBuffer(body);
  return new NextResponse(responseBody, {
    status,
    headers,
  });
}

function copyToArrayBuffer(body: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}
