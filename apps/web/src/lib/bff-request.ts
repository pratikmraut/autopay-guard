export function isJsonMediaType(value: string | null): boolean {
  const mediaType = (value ?? "").split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

type BoundedBodyReadResult =
  | { kind: "complete"; bytes: Uint8Array }
  | { kind: "interrupted" }
  | { kind: "too-large" };

export async function readBoundedRequestBody(
  body: ReadableStream<Uint8Array>,
  {
    maximumBytes,
    signal,
    timeoutMs,
  }: {
    maximumBytes: number;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<BoundedBodyReadResult> {
  if (signal?.aborted) {
    return { kind: "interrupted" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
    if (signal) {
      onAbort = resolve;
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  try {
    while (true) {
      const outcome = await Promise.race([
        reader.read().then(
          (value) => ({ kind: "read" as const, value }),
          () => ({ kind: "interrupted" as const }),
        ),
        interrupted.then(() => ({ kind: "interrupted" as const })),
      ]);
      if (outcome.kind === "interrupted") {
        void reader.cancel().catch(() => undefined);
        return { kind: "interrupted" };
      }

      const { done, value } = outcome.value;
      if (done) {
        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return { kind: "complete", bytes };
      }

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        void reader.cancel().catch(() => undefined);
        return { kind: "too-large" };
      }
      chunks.push(value);
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
    try {
      reader.releaseLock();
    } catch {
      // A timed-out read keeps the lock until cancellation settles.
    }
  }
}

export async function requestBodyHasBytes(
  body: ReadableStream<Uint8Array> | null,
  {
    signal,
    timeoutMs = 1_000,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  if (!body) {
    return false;
  }
  if (signal?.aborted) {
    return true;
  }

  const reader = body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
    if (signal) {
      onAbort = resolve;
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  try {
    while (true) {
      const outcome = await Promise.race([
        reader.read().then(
          (value) => ({ kind: "read" as const, value }),
          () => ({ kind: "interrupted" as const }),
        ),
        interrupted.then(() => ({ kind: "interrupted" as const })),
      ]);
      if (outcome.kind === "interrupted") {
        void reader.cancel().catch(() => undefined);
        return true;
      }
      const { done, value } = outcome.value;
      if (done) {
        return false;
      }
      if (value.byteLength > 0) {
        await reader.cancel();
        return true;
      }
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
    try {
      reader.releaseLock();
    } catch {
      // A timed-out read keeps the lock until cancellation settles.
    }
  }
}
