export function acquireLocalRunLock(
  name: string,
  options?: { temporaryRoot?: string; suite?: string },
): Promise<() => Promise<void>>;
