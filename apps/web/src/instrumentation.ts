export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnvironment } = await import("@/lib/env");
    getServerEnvironment();
  }
}
