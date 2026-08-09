const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function resolveCorrelationId(
  candidate: string | null,
  fallback: () => string = () => crypto.randomUUID(),
) {
  return candidate && SAFE_CORRELATION_ID.test(candidate)
    ? candidate
    : fallback();
}
