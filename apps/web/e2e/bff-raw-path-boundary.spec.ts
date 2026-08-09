import http from "node:http";
import https from "node:https";

import { expect, test } from "@playwright/test";

interface RawHttpResponse {
  body: string;
  headers: http.IncomingHttpHeaders;
  status: number;
}

const traversalTargets = [
  "/api/bff/v1/privacy/%2e%2e/me",
  "/api/bff/v1/privacy/%2E%2E/me",
  "/api/bff/v1/privacy/%2e./me",
  "/api/bff/v1/privacy/../me",
  "/api/bff/v1/privacy/./me",
  "/api/bff/v1/privacy/%252e%252e/me",
  "/api/bff/v1/privacy/%2f..%2fme",
  String.raw`/api/bff/v1/privacy\..\me`,
  "/api/bff/v1/privacy%5c..%5cme",
  "/api/bff%2Fv1%2Fme",
  "/api%2Fbff/v1/me",
  "/api/%62ff/v1/me",
  String.raw`/api/bff\v1\me`,
  "/api/bff%5Cv1%5Cme",
  "/api/foo/../bff/v1/me",
  "/api/foo/%2e%2e/bff/v1/me",
  "/foo/../api/bff/v1/me",
  "/foo/%2e%2e/api/bff/v1/me",
  "/api/bffx/../bff/v1/me",
  "/api/bffx/%2e%2e/bff/v1/me",
  "/api//bff/v1/me",
  "//api/bff/v1/me",
  "/api/bff/v1/me/.",
  "/api/bff/v1/me/%2e",
] as const;

test("raw traversal near-misses are rejected before the BFF or upstream", async ({
  request,
}, testInfo) => {
  const baseUrl = String(testInfo.project.use.baseURL);

  const canonical = await request.get("/api/bff/v1/me", {
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  expect(canonical.status()).toBe(401);
  expect(
    canonical.headers()["x-autopay-guard-bff-path-policy"],
  ).toBeUndefined();

  for (const target of traversalTargets) {
    const response = await rawGet(baseUrl, target);

    expect(response.status, target).toBe(404);
    expect(response.headers["x-autopay-guard-bff-path-policy"], target).toBe(
      "rejected",
    );
    expect(response.headers.location, target).toBeUndefined();
    expect(response.headers["cache-control"], target).toBe("no-store");
    expect(response.headers["content-type"], target).toContain(
      "application/problem+json",
    );
    expect(JSON.parse(response.body), target).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "This BFF operation is not available.",
    });
  }
});

async function rawGet(
  baseUrl: string,
  target: string,
): Promise<RawHttpResponse> {
  const base = new URL(baseUrl);
  const client = base.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port,
        method: "GET",
        path: target,
        headers: {
          accept: "application/problem+json",
          host: base.host,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          }),
        );
      },
    );

    request.once("error", reject);
    request.end();
  });
}
