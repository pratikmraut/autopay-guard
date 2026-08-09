export function createIdempotencyKey(scope: string) {
  const normalizedScope = scope
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (!normalizedScope) {
    throw new Error("An idempotency-key scope is required.");
  }
  return `${normalizedScope}-${crypto.randomUUID()}`;
}
