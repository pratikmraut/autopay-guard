import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  IMPORT_TEMPLATE_FILENAME,
  IMPORT_TEMPLATE_HEADER,
  ImportApi,
  ImportApiError,
} from "@/lib/import-api";

const householdId = "00000000-0000-4000-8000-000000000123";
const importId = "10000000-0000-4000-8000-000000000001";

describe("ImportApi", () => {
  it("binds the default browser fetch receiver before making requests", async () => {
    const fetchApi = vi.fn<typeof fetch>(function (this: typeof globalThis) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        Response.json(uploadDto(), {
          status: 201,
          headers: { etag: '"0"' },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchApi);

    try {
      await new ImportApi().upload(
        householdId,
        new File(["fake"], "fixture.csv", { type: "text/csv" }),
        "csv-upload-00000000-0000-4000-8000-000000000001",
      );
      expect(fetchApi).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uploads exactly householdId and file without setting a caller boundary", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(uploadDto(), {
        status: 201,
        headers: { etag: '"0"' },
      }),
    );
    const file = new File(["fake"], "fixture.csv", { type: "text/csv" });

    const result = await new ImportApi(fetchApi).upload(
      householdId,
      file,
      "csv-upload-00000000-0000-4000-8000-000000000001",
    );

    expect(result).toMatchObject({ etag: '"0"', value: { id: importId } });
    const [url, init] = fetchApi.mock.calls[0] ?? [];
    expect(url).toBe("/api/bff/v1/imports");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    const headers = new Headers(init?.headers);
    expect(headers.has("content-type")).toBe(false);
    expect(headers.get("idempotency-key")).toBe(
      "csv-upload-00000000-0000-4000-8000-000000000001",
    );
    expect([...(init?.body as FormData).keys()]).toEqual([
      "householdId",
      "file",
    ]);
  });

  it("sends exact conditional confirmation and bodyless discard requests", async () => {
    const fetchApi = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            importId,
            status: "CONFIRMED",
            selectedItemCount: 1,
            createdCommitmentCount: 1,
            commitmentIds: ["30000000-0000-4000-8000-000000000001"],
            rawProcessedAt: "2026-07-29T10:05:00Z",
            version: 1,
          },
          { headers: { etag: '"1"' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new ImportApi(fetchApi);

    await api.confirm(
      importId,
      ["20000000-0000-4000-8000-000000000001"],
      '"0"',
      "csv-confirm-00000000-0000-4000-8000-000000000001",
    );
    await api.discard(importId, '"1"');

    const confirm = fetchApi.mock.calls[0]?.[1];
    expect(JSON.parse(String(confirm?.body))).toEqual({
      selectedItemIds: ["20000000-0000-4000-8000-000000000001"],
    });
    expect(new Headers(confirm?.headers).get("if-match")).toBe('"0"');
    expect(new Headers(confirm?.headers).get("idempotency-key")).toBe(
      "csv-confirm-00000000-0000-4000-8000-000000000001",
    );
    const discard = fetchApi.mock.calls[1]?.[1];
    expect(discard?.method).toBe("DELETE");
    expect(discard?.body).toBeUndefined();
    expect(new Headers(discard?.headers).get("content-type")).toBeNull();
    expect(new Headers(discard?.headers).get("if-match")).toBe('"1"');
  });

  it("rejects missing, unsafe, or body-mismatched ETags", async () => {
    const fetchApi = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(uploadDto()))
      .mockResolvedValueOnce(
        Response.json(
          { ...uploadDto(), version: 2 },
          {
            headers: { etag: '"1"' },
          },
        ),
      );
    const api = new ImportApi(fetchApi);

    await expect(api.get(importId)).rejects.toMatchObject({
      status: 502,
    });
    await expect(api.get(importId)).rejects.toMatchObject({
      status: 502,
    });
  });

  it("maps upstream problem text to a bounded status-only message", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          title: "Unsafe parser detail",
          detail: "=HYPERLINK(secret)",
          correlationId: "safe-correlation",
        },
        { status: 422 },
      ),
    );

    await expect(new ImportApi(fetchApi).get(importId)).rejects.toEqual(
      expect.objectContaining<Partial<ImportApiError>>({
        status: 422,
        message:
          "The CSV could not be accepted. Use the exact template and review the file limits.",
        correlationId: "safe-correlation",
      }),
    );
  });
});

describe("controlled import template", () => {
  it("has the fixed name and exact ordered header only", () => {
    const template = readFileSync(
      join(process.cwd(), "public", IMPORT_TEMPLATE_FILENAME),
      "utf8",
    );
    expect(template).toBe(`${IMPORT_TEMPLATE_HEADER}\n`);
  });
});

function uploadDto() {
  return {
    id: importId,
    householdId,
    status: "PREVIEW_READY",
    rawByteCount: 100,
    expiresAt: "2026-07-30T10:00:00Z",
    totalItemCount: 1,
    validItemCount: 1,
    invalidItemCount: 0,
    duplicateItemCount: 0,
    version: 0,
    createdAt: "2026-07-29T10:00:00Z",
    updatedAt: "2026-07-29T10:00:00Z",
  };
}
