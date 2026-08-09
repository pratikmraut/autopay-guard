import { describe, expect, it } from "vitest";

import {
  isJsonMediaType,
  readBoundedRequestBody,
  requestBodyHasBytes,
} from "@/lib/bff-request";

describe("BFF JSON request media type", () => {
  it.each([
    "application/json",
    "APPLICATION/JSON",
    "application/json; charset=utf-8",
    " application/json ; charset=UTF-8",
  ])("accepts exact JSON media type %s", (value) => {
    expect(isJsonMediaType(value)).toBe(true);
  });

  it.each([
    null,
    "",
    "application/jsonp",
    "application/json-evil",
    "application/problem+json",
    "text/json",
  ])("rejects non-JSON media type %s", (value) => {
    expect(isJsonMediaType(value)).toBe(false);
  });

  it("distinguishes null and empty request streams from body bytes", async () => {
    const empty = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const nonEmpty = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });

    await expect(requestBodyHasBytes(null)).resolves.toBe(false);
    await expect(requestBodyHasBytes(empty)).resolves.toBe(false);
    await expect(requestBodyHasBytes(nonEmpty)).resolves.toBe(true);
  });

  it("conservatively rejects a body stream that stalls", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });

    await expect(requestBodyHasBytes(stalled, { timeoutMs: 5 })).resolves.toBe(
      true,
    );
  });

  it("reads a request body only within the byte limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":'));
        controller.enqueue(new TextEncoder().encode("true}"));
        controller.close();
      },
    });

    const result = await readBoundedRequestBody(body, {
      maximumBytes: 11,
      timeoutMs: 50,
    });

    expect(result.kind).toBe("complete");
    if (result.kind === "complete") {
      expect(new TextDecoder().decode(result.bytes)).toBe('{"ok":true}');
    }
  });

  it("rejects a request body that crosses the byte limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":true}'));
        controller.close();
      },
    });

    await expect(
      readBoundedRequestBody(body, {
        maximumBytes: 10,
        timeoutMs: 50,
      }),
    ).resolves.toEqual({ kind: "too-large" });
  });

  it("interrupts a slow request body at the total read deadline", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });

    await expect(
      readBoundedRequestBody(stalled, {
        maximumBytes: 64 * 1024,
        timeoutMs: 5,
      }),
    ).resolves.toEqual({ kind: "interrupted" });
  });
});
