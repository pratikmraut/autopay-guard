export const IMPORT_TEMPLATE_PATH = "/autopay-guard-import-template-v1.csv";
export const IMPORT_TEMPLATE_FILENAME = "autopay-guard-import-template-v1.csv";
export const IMPORT_TEMPLATE_HEADER =
  "name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label";
export const MAX_IMPORT_FILE_BYTES = 256 * 1024;

export type ImportStatus =
  | "PREVIEW_READY"
  | "CONFIRMED"
  | "DISCARDED"
  | "EXPIRED";
export type ImportDuplicateKind = "NONE" | "IN_FILE" | "EXISTING";

export interface ImportUploadDto {
  id: string;
  householdId: string;
  status: ImportStatus;
  rawByteCount: number;
  expiresAt: string;
  totalItemCount: number;
  validItemCount: number;
  invalidItemCount: number;
  duplicateItemCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportItemErrorDto {
  code: string;
  message: string;
}

export interface ImportPreviewDto {
  name: string;
  category: string;
  amountMinor: number | null;
  currency: string;
  frequency: string;
  nextDueDate: string;
  monthDayPolicy: string;
  paymentRail: string | null;
  maskedPaymentLabel: string | null;
  merchantId: string | null;
}

export interface ImportItemDto {
  id: string;
  rowNumber: number;
  valid: boolean;
  duplicateKind: ImportDuplicateKind | null;
  selected: boolean | null;
  createdCommitmentId: string | null;
  errors: ImportItemErrorDto[];
  preview: ImportPreviewDto | null;
}

export interface ImportPreviewJobDto extends ImportUploadDto {
  rawProcessedAt: string;
  selectedItemCount: number;
  createdCommitmentCount: number;
  items: ImportItemDto[];
}

export interface ImportConfirmationDto {
  importId: string;
  status: ImportStatus;
  selectedItemCount: number;
  createdCommitmentCount: number;
  commitmentIds: string[];
  rawProcessedAt: string;
  version: number;
}

export interface Versioned<T> {
  value: T;
  etag: string;
}

export class ImportApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly correlationId: string | null,
  ) {
    super(importProblemMessage(status));
    this.name = "ImportApiError";
  }
}

export class ImportApi {
  constructor(
    private readonly fetchApi: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = "/api/bff",
  ) {}

  async upload(
    householdId: string,
    file: File,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<Versioned<ImportUploadDto>> {
    const form = new FormData();
    form.set("householdId", householdId);
    form.set("file", file);
    return this.requestVersioned<ImportUploadDto>("/v1/imports", {
      method: "POST",
      headers: {
        accept: "application/json, application/problem+json",
        "idempotency-key": idempotencyKey,
      },
      body: form,
      signal,
    });
  }

  async get(
    importId: string,
    signal?: AbortSignal,
  ): Promise<Versioned<ImportPreviewJobDto>> {
    return this.requestVersioned<ImportPreviewJobDto>(
      `/v1/imports/${encodeURIComponent(importId)}`,
      {
        method: "GET",
        headers: { accept: "application/json, application/problem+json" },
        signal,
      },
    );
  }

  async confirm(
    importId: string,
    selectedItemIds: string[],
    etag: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<Versioned<ImportConfirmationDto>> {
    return this.requestVersioned<ImportConfirmationDto>(
      `/v1/imports/${encodeURIComponent(importId)}/confirm`,
      {
        method: "POST",
        headers: {
          accept: "application/json, application/problem+json",
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "if-match": etag,
        },
        body: JSON.stringify({ selectedItemIds }),
        signal,
      },
    );
  }

  async discard(
    importId: string,
    etag: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.fetchApi(
      `${this.baseUrl}/v1/imports/${encodeURIComponent(importId)}`,
      {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          accept: "application/json, application/problem+json",
          "if-match": etag,
        },
        signal,
      },
    );
    if (response.status === 204) {
      return;
    }
    throw await toApiError(response);
  }

  private async requestVersioned<T extends { version: number }>(
    path: string,
    init: RequestInit,
  ): Promise<Versioned<T>> {
    const response = await this.fetchApi(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      throw await toApiError(response);
    }
    const etag = response.headers.get("etag");
    if (!etag || !/^"(?:0|[1-9]\d{0,18})"$/.test(etag)) {
      throw new ImportApiError(502, response.headers.get("x-correlation-id"));
    }
    const value = (await response.json()) as T;
    if (
      !value ||
      typeof value !== "object" ||
      !Number.isSafeInteger(value.version) ||
      etag !== `"${value.version}"`
    ) {
      throw new ImportApiError(502, response.headers.get("x-correlation-id"));
    }
    return { value, etag };
  }
}

async function toApiError(response: Response) {
  let correlationId = response.headers.get("x-correlation-id");
  if ((response.headers.get("content-type") ?? "").includes("json")) {
    try {
      const problem = (await response.json()) as { correlationId?: unknown };
      if (!correlationId && typeof problem.correlationId === "string") {
        correlationId = problem.correlationId;
      }
    } catch {
      // The UI intentionally never exposes raw parser or upstream text.
    }
  }
  return new ImportApiError(response.status, correlationId);
}

export function importProblemMessage(status: number) {
  if (status === 401) {
    return "Your secure session expired. Sign in again.";
  }
  if (status === 403 || status === 404) {
    return "This import is unavailable to the signed-in account.";
  }
  if (status === 409 || status === 410) {
    return "This preview is no longer available. Start a new import.";
  }
  if (status === 412) {
    return "This preview changed in another tab. Reload the latest preview.";
  }
  if (status === 413) {
    return "The CSV is larger than the 256 KiB limit.";
  }
  if (status === 415) {
    return "Choose an exact .csv file with the text/csv type.";
  }
  if (status === 422 || status === 400) {
    return "The CSV could not be accepted. Use the exact template and review the file limits.";
  }
  if (status === 428) {
    return "The preview version is missing. Reload before continuing.";
  }
  if (status === 429) {
    return "Too many import attempts were made. Wait briefly and try again.";
  }
  if (status === 502) {
    return "The API returned an invalid import response.";
  }
  return "The import service is unavailable. No new commitments were confirmed.";
}
