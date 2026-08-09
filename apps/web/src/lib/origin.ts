export function isExpectedRequestOrigin(
  requestOrigin: string | null,
  configuredAuthUrl: string,
): boolean {
  if (!requestOrigin) {
    return false;
  }

  try {
    return new URL(requestOrigin).origin === new URL(configuredAuthUrl).origin;
  } catch {
    return false;
  }
}
