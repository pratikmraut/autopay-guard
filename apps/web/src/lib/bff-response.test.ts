import { describe, expect, it } from "vitest";

import { createBffProxyResponse } from "@/lib/bff-response";

describe("BFF proxy response construction", () => {
  it.each([204, 205, 304])(
    "constructs HTTP %s with the body omitted",
    (status) => {
      const response = createBffProxyResponse(
        status,
        new Headers({ "x-correlation-id": "test-correlation" }),
        new Uint8Array(),
      );

      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(response.headers.get("x-correlation-id")).toBe("test-correlation");
    },
  );

  it("preserves bounded bytes for responses that permit a body", async () => {
    const bytes = new TextEncoder().encode('{"ok":true}');
    const response = createBffProxyResponse(
      200,
      new Headers({ "content-type": "application/json" }),
      bytes,
    );

    expect(await response.text()).toBe('{"ok":true}');
  });
});
