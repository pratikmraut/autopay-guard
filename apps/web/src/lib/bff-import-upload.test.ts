import { describe, expect, it } from "vitest";

import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_MULTIPART_BYTES,
  normalizeImportUpload,
} from "@/lib/bff-import-upload";

const householdId = "00000000-0000-4000-8000-000000000123";

describe("import multipart BFF boundary", () => {
  it.each(["fixture.csv", "fixture.CSV", "fixture.CsV"])(
    "accepts one bounded exact multipart upload with %s",
    async (filename) => {
      const request = multipartRequest([
        { name: "householdId", value: householdId },
        {
          name: "file",
          value: "safe,fake,csv",
          filename,
          type: "text/csv",
        },
      ]);

      const result = await normalizeImportUpload(request);

      expect(result.accepted).toBe(true);
      if (!result.accepted) {
        return;
      }
      expect([...result.body.keys()]).toEqual(["householdId", "file"]);
      expect(result.body.get("householdId")).toBe(householdId);
      const file = result.body.get("file");
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe("import.csv");
      expect((file as File).type).toBe("text/csv");
      expect((file as File).size).toBe(
        new TextEncoder().encode("safe,fake,csv").byteLength,
      );
    },
  );

  it.each([
    ["wrong extension", "fixture.txt", "text/csv"],
    ["traversal filename", "../fixture.csv", "text/csv"],
    ["path filename", "folder\\fixture.csv", "text/csv"],
    ["wrong media type", "fixture.csv", "application/csv"],
    ["media parameters", "fixture.csv", "text/csv; charset=utf-8"],
  ])("rejects a %s", async (_label, filename, type) => {
    const result = await normalizeImportUpload(
      multipartRequest([
        { name: "householdId", value: householdId },
        { name: "file", value: "safe", filename, type },
      ]),
    );
    expect(result).toMatchObject({ accepted: false, status: 415 });
  });

  it("rejects empty and oversized raw files", async () => {
    const empty = await normalizeImportUpload(
      multipartRequest([
        { name: "householdId", value: householdId },
        { name: "file", value: "", filename: "empty.csv", type: "text/csv" },
      ]),
    );
    expect(empty).toMatchObject({ accepted: false, status: 400 });

    const oversized = await normalizeImportUpload(
      multipartRequest([
        { name: "householdId", value: householdId },
        {
          name: "file",
          value: new Uint8Array(MAX_IMPORT_FILE_BYTES + 1),
          filename: "large.csv",
          type: "text/csv",
        },
      ]),
    );
    expect(oversized).toMatchObject({ accepted: false, status: 413 });
  });

  it.each([
    [
      "missing household",
      [{ name: "file", value: "x", filename: "x.csv", type: "text/csv" }],
    ],
    [
      "invalid household",
      [
        { name: "householdId", value: "not-a-uuid" },
        { name: "file", value: "x", filename: "x.csv", type: "text/csv" },
      ],
    ],
    [
      "duplicate household",
      [
        { name: "householdId", value: householdId },
        { name: "householdId", value: householdId },
        { name: "file", value: "x", filename: "x.csv", type: "text/csv" },
      ],
    ],
    [
      "extra field",
      [
        { name: "householdId", value: householdId },
        { name: "file", value: "x", filename: "x.csv", type: "text/csv" },
        { name: "filename", value: "secret.csv" },
      ],
    ],
  ] satisfies Array<[string, MultipartEntry[]]>)(
    "rejects %s",
    async (_label, entries) => {
      const result = await normalizeImportUpload(multipartRequest(entries));
      expect(result).toMatchObject({ accepted: false, status: 400 });
    },
  );

  it("rejects content encoding, malformed media, and an oversized declared envelope", async () => {
    const encoded = multipartRequest([
      { name: "householdId", value: householdId },
      { name: "file", value: "x", filename: "x.csv", type: "text/csv" },
    ]);
    encoded.headers.set("content-encoding", "gzip");
    await expect(normalizeImportUpload(encoded)).resolves.toMatchObject({
      accepted: false,
      status: 415,
    });

    const malformed = new Request("http://local.test/api/bff/v1/imports", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=bad boundary" },
      body: "body",
    });
    await expect(normalizeImportUpload(malformed)).resolves.toMatchObject({
      accepted: false,
      status: 415,
    });

    const declared = multipartRequest([
      { name: "householdId", value: householdId },
      { name: "file", value: "x", filename: "x.csv", type: "text/csv" },
    ]);
    declared.headers.set(
      "content-length",
      String(MAX_IMPORT_MULTIPART_BYTES + 1),
    );
    await expect(normalizeImportUpload(declared)).resolves.toMatchObject({
      accepted: false,
      status: 413,
    });
  });
});

interface MultipartEntry {
  name: string;
  value: string | Uint8Array;
  filename?: string;
  type?: string;
}

function multipartRequest(entries: MultipartEntry[]) {
  const boundary = "m6-test-boundary";
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const disposition = entry.filename
      ? `Content-Disposition: form-data; name="${entry.name}"; filename="${entry.filename}"\r\nContent-Type: ${entry.type ?? "application/octet-stream"}`
      : `Content-Disposition: form-data; name="${entry.name}"`;
    chunks.push(
      encoder.encode(`--${boundary}\r\n${disposition}\r\n\r\n`),
      typeof entry.value === "string"
        ? encoder.encode(entry.value)
        : entry.value,
      encoder.encode("\r\n"),
    );
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request("http://local.test/api/bff/v1/imports", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: bytes.buffer,
  });
}
