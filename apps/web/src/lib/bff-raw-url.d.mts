export function rawRequestPathname(requestUrl: string): string | null;
export function isRawBffRequest(requestUrl: string): boolean;
export function isCanonicalRawBffRequest(requestUrl: string): boolean;
export function shouldRejectRawBffRequest(requestUrl: string): boolean;
