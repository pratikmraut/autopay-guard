const BFF_PATH_PREFIX = "/api/bff";
const CANONICAL_BFF_PATH = /^\/api\/bff\/v1(?:\/[A-Za-z0-9_-]+)+$/;

/**
 * Extract the original request-target pathname without URL parsing or
 * decoding. WHATWG parsing is intentionally deferred because it normalizes
 * literal and encoded dot segments.
 *
 * @param {string} requestUrl
 * @returns {string | null}
 */
export function rawRequestPathname(requestUrl) {
  let pathnameStart = 0;
  const schemeSeparator = requestUrl.indexOf("://");

  if (schemeSeparator >= 0) {
    const authorityStart = schemeSeparator + 3;
    pathnameStart = requestUrl.indexOf("/", authorityStart);
    if (pathnameStart < 0) {
      return requestUrl.slice(authorityStart).split(/[?#]/, 1)[0] ? "/" : null;
    }
  } else if (!requestUrl.startsWith("/")) {
    return null;
  }

  const queryStart = requestUrl.indexOf("?", pathnameStart);
  const fragmentStart = requestUrl.indexOf("#", pathnameStart);
  const pathnameEnd = Math.min(
    queryStart < 0 ? requestUrl.length : queryStart,
    fragmentStart < 0 ? requestUrl.length : fragmentStart,
  );

  return requestUrl.slice(pathnameStart, pathnameEnd);
}

/**
 * @param {string} requestUrl
 */
export function isRawBffRequest(requestUrl) {
  const pathname = rawRequestPathname(requestUrl);
  if (pathname === null) {
    return false;
  }

  const candidates = new Set([pathname]);
  let decoded = pathname;
  for (let pass = 0; pass < 4; pass += 1) {
    decoded = decodeAsciiPercentBytes(decoded);
    candidates.add(decoded);
  }

  for (const candidate of [...candidates]) {
    const separatorNormalized = candidate
      .replaceAll("\\", "/")
      .replace(/\/{2,}/g, "/");
    candidates.add(separatorNormalized);
    try {
      candidates.add(
        new URL(`http://raw-target.invalid${separatorNormalized}`).pathname,
      );
    } catch {
      // A malformed request target stays non-canonical and is checked below.
    }
  }

  return [...candidates].some(hasBffBoundary);
}

/**
 * BFF paths contain ASCII literal segments only. Query encoding is outside
 * this check and remains governed by operation-specific query allowlists.
 *
 * @param {string} requestUrl
 */
export function isCanonicalRawBffRequest(requestUrl) {
  const pathname = rawRequestPathname(requestUrl);
  return pathname !== null && CANONICAL_BFF_PATH.test(pathname);
}

/**
 * @param {string} requestUrl
 */
export function shouldRejectRawBffRequest(requestUrl) {
  return isRawBffRequest(requestUrl) && !isCanonicalRawBffRequest(requestUrl);
}

/**
 * @param {string} value
 */
function decodeAsciiPercentBytes(value) {
  return value.replace(/%([0-9a-fA-F]{2})/g, (encoded, hexadecimal) => {
    const byte = Number.parseInt(hexadecimal, 16);
    return byte <= 0x7f ? String.fromCharCode(byte) : encoded;
  });
}

/**
 * @param {string} pathname
 */
function hasBffBoundary(pathname) {
  if (!pathname.startsWith(BFF_PATH_PREFIX)) {
    return false;
  }
  const delimiter = pathname[BFF_PATH_PREFIX.length];
  return (
    delimiter === undefined ||
    delimiter === "/" ||
    delimiter === "\\" ||
    delimiter === "%"
  );
}
