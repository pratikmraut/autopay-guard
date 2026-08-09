type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function fetchWithoutRedirects(
  input: RequestInfo | URL,
  init: RequestInit,
  fetchImplementation: FetchImplementation = fetch,
): Promise<Response> {
  return fetchImplementation(input, { ...init, redirect: "error" });
}
