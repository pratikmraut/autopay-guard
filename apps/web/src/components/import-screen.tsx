"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useSelectedHousehold } from "@/components/household-scope";
import type { HouseholdAccessDto } from "@/lib/household-api";
import {
  IMPORT_TEMPLATE_FILENAME,
  IMPORT_TEMPLATE_PATH,
  ImportApi,
  ImportApiError,
  type ImportConfirmationDto,
  type ImportItemDto,
  type ImportPreviewJobDto,
  MAX_IMPORT_FILE_BYTES,
} from "@/lib/import-api";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { formatLocalDate } from "@/lib/local-date";
import { formatMinorMoney } from "@/lib/money";

type PreviewState = {
  job: ImportPreviewJobDto;
  etag: string;
};

export function ImportScreen() {
  const household = useSelectedHousehold();
  const canManage =
    (household as typeof household & Partial<HouseholdAccessDto>).canManage ===
    true;

  if (!canManage) {
    return (
      <div className="imports-page">
        <header className="resource-heading">
          <div>
            <p className="eyebrow">Controlled CSV import</p>
            <h1>Owner-only workspace control</h1>
            <p>
              Household members can view only commitments shared with them. CSV
              preview and import remain private owner controls.
            </p>
          </div>
        </header>
        <div className="resource-state" role="status">
          <strong>Import is unavailable for this membership</strong>
          <p>Ask the household owner to add private records when needed.</p>
          <Link
            className="secondary-link mt-5"
            href={`/commitments?householdId=${encodeURIComponent(household.id)}`}
          >
            Return to commitments
          </Link>
        </div>
      </div>
    );
  }

  return <OwnerImportScreen />;
}

function OwnerImportScreen() {
  const household = useSelectedHousehold();
  const api = useMemo(() => new ImportApi(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const alertRegion = useRef<HTMLDivElement>(null);
  const statusRegion = useRef<HTMLDivElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const discardTrigger = useRef<HTMLButtonElement | null>(null);
  const uploadKey = useRef<string | null>(null);
  const confirmationAttempt = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationAccepted, setConfirmationAccepted] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [busy, setBusy] = useState<
    "upload" | "confirm" | "discard" | "reload" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [complete, setComplete] = useState<ImportConfirmationDto | null>(null);
  const [discarded, setDiscarded] = useState(false);

  useEffect(() => {
    if (error) {
      alertRegion.current?.focus();
    }
  }, [error]);

  useEffect(() => {
    if (message) {
      statusRegion.current?.focus();
    }
  }, [message]);

  if (complete) {
    return (
      <div className="imports-page">
        <div
          className="success-toast import-result"
          ref={statusRegion}
          role="status"
          tabIndex={-1}
        >
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Import complete</strong>
            <p>
              {complete.createdCommitmentCount} private{" "}
              {complete.createdCommitmentCount === 1
                ? "commitment was"
                : "commitments were"}{" "}
              created. Confirmation operated only on the normalized preview.
            </p>
          </div>
        </div>
        <section className="import-completion-card">
          <p className="card-kicker">Nothing was sent outside this app</p>
          <h1>Your selected rows are now tracked</h1>
          <p>
            AutoPay Guard did not contact a bank or provider, move money, or
            revoke a mandate. Unselected and invalid rows created nothing.
          </p>
          <div className="import-actions">
            <Link
              className="primary-link"
              href={`/commitments?householdId=${encodeURIComponent(household.id)}&imported=1`}
            >
              View commitments
            </Link>
            <button
              className="secondary-link secondary-link--button"
              onClick={reset}
              type="button"
            >
              Import another CSV
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (discarded) {
    return (
      <div className="imports-page">
        <div
          className="success-toast import-result"
          ref={statusRegion}
          role="status"
          tabIndex={-1}
        >
          <span aria-hidden="true">✓</span>
          Preview discarded. No commitment was created. Discard operated only on
          the normalized preview.
        </div>
        <div className="import-actions">
          <button className="primary-action" onClick={reset} type="button">
            Start a new import
          </button>
          <Link
            className="secondary-link"
            href={`/commitments?householdId=${encodeURIComponent(household.id)}`}
          >
            Return to commitments
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="imports-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Controlled CSV import</p>
          <h1>Review every row before it becomes a commitment</h1>
          <p>
            Use one bounded fake-local CSV for {household.name}. Upload and
            preview create no commitments.
          </p>
        </div>
        <a
          className="secondary-link"
          download={IMPORT_TEMPLATE_FILENAME}
          href={IMPORT_TEMPLATE_PATH}
        >
          Download exact CSV template
        </a>
      </header>

      <section className="import-safety-note" aria-labelledby="import-safety">
        <p className="card-kicker">Private by design</p>
        <h2 id="import-safety">Keep payment credentials out of this file</h2>
        <p>
          Use fictional local data only. Never include a PIN, OTP, password,
          full bank or card number, full UPI ID, URL, or payment credential.
        </p>
        <ul>
          <li>
            Preview only. Nothing is created until you confirm selected rows.
          </li>
          <li>Imported commitments are private by default.</li>
          <li>AutoPay Guard does not contact a bank or provider.</li>
          <li>
            Raw CSV content is processed in bounded request memory and is not
            committed to storage.
          </li>
          <li>
            Unconfirmed previews expire no later than 24 hours after upload.
          </li>
        </ul>
      </section>

      {error && (
        <div
          className="resource-state resource-state--error"
          ref={alertRegion}
          role="alert"
          tabIndex={-1}
        >
          <strong>Import action not completed</strong>
          <p>{error}</p>
          {preview && error.includes("another tab") && (
            <button
              className="secondary-link secondary-link--button"
              disabled={busy !== null}
              onClick={() => void reloadPreview()}
              type="button"
            >
              Reload latest preview
            </button>
          )}
        </div>
      )}
      {message && (
        <div
          className="success-toast"
          ref={statusRegion}
          role="status"
          tabIndex={-1}
        >
          <span aria-hidden="true">✓</span>
          {message}
        </div>
      )}

      {!preview ? (
        <form className="import-upload-card" onSubmit={upload}>
          <div>
            <p className="card-kicker">Step 1 of 3</p>
            <h2>Choose the completed template</h2>
            <p>
              One exact <code>.csv</code> file, <code>text/csv</code>, 1–256
              KiB, and 1–100 data rows. The API—not this browser—decides row
              validity and normalized money values.
            </p>
          </div>
          <label className="field-label" htmlFor="import-file">
            CSV file
          </label>
          <input
            accept=".csv,text/csv"
            className="form-input import-file-input"
            id="import-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.item(0) ?? null;
              setError(null);
              setMessage(null);
              uploadKey.current = null;
              if (!file) {
                setSelectedFile(null);
                return;
              }
              const validation = validateSelectedFile(file);
              if (validation) {
                event.currentTarget.value = "";
                setSelectedFile(null);
                setError(validation);
                return;
              }
              setSelectedFile(file);
            }}
            ref={fileInput}
            required
            type="file"
          />
          {selectedFile && (
            <p className="field-help" role="status">
              One CSV is ready to upload ({formatBytes(selectedFile.size)}).
            </p>
          )}
          <button
            className="primary-action"
            disabled={!selectedFile || busy !== null}
            type="submit"
          >
            {busy === "upload" ? "Uploading safely…" : "Upload and preview"}
          </button>
          <p className="field-help">
            Raw CSV content is processed in bounded request memory and is not
            committed to storage. Unconfirmed previews expire no later than 24
            hours after upload.
          </p>
        </form>
      ) : (
        <PreviewPanel
          busy={busy !== null}
          confirmationAccepted={confirmationAccepted}
          confirmationOpen={confirmationOpen}
          discardOpen={discardOpen}
          onCancelConfirmation={() => {
            setConfirmationOpen(false);
            setConfirmationAccepted(false);
            queueMicrotask(() => reviewTrigger.current?.focus());
          }}
          onConfirm={() => void confirmImport()}
          onConfirmationAccepted={setConfirmationAccepted}
          onDiscard={() => void discardImport()}
          onDiscardOpen={(open, trigger) => {
            setDiscardOpen(open);
            if (open) {
              discardTrigger.current = trigger ?? null;
              setConfirmationOpen(false);
              setConfirmationAccepted(false);
              queueMicrotask(() =>
                document.getElementById("discard-confirmation")?.focus(),
              );
            } else {
              queueMicrotask(() => discardTrigger.current?.focus());
            }
          }}
          onReview={(trigger) => {
            reviewTrigger.current = trigger;
            setDiscardOpen(false);
            setConfirmationOpen(true);
            setConfirmationAccepted(false);
            setError(null);
            setMessage(null);
            queueMicrotask(() =>
              document.getElementById("import-confirmation")?.focus(),
            );
          }}
          onSelectionChange={toggleSelection}
          preview={preview.job}
          selectedIds={selectedIds}
        />
      )}
    </div>
  );

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setError("Choose one CSV file before continuing.");
      return;
    }
    setBusy("upload");
    setError(null);
    setMessage(null);
    const file = selectedFile;
    const key =
      uploadKey.current ??
      createIdempotencyKey(`csv-upload-${household.id.slice(0, 8)}`);
    uploadKey.current = key;
    try {
      const created = await api.upload(household.id, file, key);
      if (
        created.value.householdId !== household.id ||
        created.value.status !== "PREVIEW_READY"
      ) {
        throw new ImportApiError(502, null);
      }
      const latest = await api.get(created.value.id);
      assertImportIdentity(latest.value, household.id, created.value.id);
      if (latest.value.status !== "PREVIEW_READY") {
        setError("This preview is no longer available. Start a new import.");
        uploadKey.current = null;
        clearSelectedFile();
        return;
      }
      assertPreviewScope(latest.value, household.id, created.value.id);
      setPreview({ job: latest.value, etag: latest.etag });
      setSelectedIds(defaultSelection(latest.value.items));
      setMessage(
        `Preview ready: ${latest.value.validItemCount} valid and ${latest.value.invalidItemCount} invalid rows. Nothing has been created.`,
      );
      uploadKey.current = null;
      clearSelectedFile();
    } catch (cause) {
      setError(importError(cause, "upload"));
      if (cause instanceof ImportApiError && cause.status < 500) {
        uploadKey.current = null;
        clearSelectedFile();
      }
    } finally {
      setBusy(null);
    }
  }

  function toggleSelection(item: ImportItemDto, checked: boolean) {
    if (!item.valid) {
      return;
    }
    confirmationAttempt.current = null;
    setConfirmationOpen(false);
    setConfirmationAccepted(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
      return next;
    });
  }

  async function confirmImport() {
    if (!preview || selectedIds.size === 0 || !confirmationAccepted) {
      setError("Select at least one valid row and confirm the safety notice.");
      return;
    }
    const ids = [...selectedIds].sort();
    const fingerprint = `${preview.job.id}:${preview.etag}:${ids.join(",")}`;
    if (confirmationAttempt.current?.fingerprint !== fingerprint) {
      confirmationAttempt.current = {
        fingerprint,
        key: createIdempotencyKey("csv-confirm"),
      };
    }
    setBusy("confirm");
    setError(null);
    setMessage(null);
    try {
      const result = await api.confirm(
        preview.job.id,
        ids,
        preview.etag,
        confirmationAttempt.current.key,
      );
      if (
        result.value.importId !== preview.job.id ||
        result.value.status !== "CONFIRMED" ||
        !result.value.rawProcessedAt
      ) {
        throw new ImportApiError(502, null);
      }
      setComplete(result.value);
      setPreview(null);
      setSelectedIds(new Set());
      confirmationAttempt.current = null;
      setMessage("Import complete.");
    } catch (cause) {
      setError(importError(cause, "confirm"));
    } finally {
      setBusy(null);
    }
  }

  async function discardImport() {
    if (!preview) {
      return;
    }
    setBusy("discard");
    setError(null);
    setMessage(null);
    try {
      await api.discard(preview.job.id, preview.etag);
      setPreview(null);
      setSelectedIds(new Set());
      confirmationAttempt.current = null;
      setDiscarded(true);
      setMessage("Preview discarded.");
    } catch (cause) {
      setError(importError(cause, "discard"));
    } finally {
      setBusy(null);
    }
  }

  async function reloadPreview() {
    if (!preview) {
      return;
    }
    setBusy("reload");
    setError(null);
    setMessage(null);
    try {
      const latest = await api.get(preview.job.id);
      assertImportIdentity(latest.value, household.id, preview.job.id);
      if (latest.value.status !== "PREVIEW_READY") {
        setPreview(null);
        setSelectedIds(new Set());
        setError("This preview is no longer available. Start a new import.");
        return;
      }
      assertPreviewScope(latest.value, household.id, preview.job.id);
      setPreview({ job: latest.value, etag: latest.etag });
      setSelectedIds(defaultSelection(latest.value.items));
      setConfirmationOpen(false);
      setConfirmationAccepted(false);
      confirmationAttempt.current = null;
      setMessage("The latest preview version is loaded. Review it again.");
    } catch (cause) {
      setError(importError(cause, "reload"));
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setPreview(null);
    setSelectedIds(new Set());
    setSelectedFile(null);
    setComplete(null);
    setDiscarded(false);
    setError(null);
    setMessage(null);
    setConfirmationOpen(false);
    setConfirmationAccepted(false);
    setDiscardOpen(false);
    uploadKey.current = null;
    confirmationAttempt.current = null;
    if (fileInput.current) {
      fileInput.current.value = "";
    }
  }

  function clearSelectedFile() {
    setSelectedFile(null);
    if (fileInput.current) {
      fileInput.current.value = "";
    }
  }
}

function PreviewPanel({
  busy,
  confirmationAccepted,
  confirmationOpen,
  discardOpen,
  onCancelConfirmation,
  onConfirm,
  onConfirmationAccepted,
  onDiscard,
  onDiscardOpen,
  onReview,
  onSelectionChange,
  preview,
  selectedIds,
}: {
  busy: boolean;
  confirmationAccepted: boolean;
  confirmationOpen: boolean;
  discardOpen: boolean;
  onCancelConfirmation: () => void;
  onConfirm: () => void;
  onConfirmationAccepted: (accepted: boolean) => void;
  onDiscard: () => void;
  onDiscardOpen: (open: boolean, trigger?: HTMLButtonElement) => void;
  onReview: (trigger: HTMLButtonElement) => void;
  onSelectionChange: (item: ImportItemDto, checked: boolean) => void;
  preview: ImportPreviewJobDto;
  selectedIds: Set<string>;
}) {
  const selectedCount = selectedIds.size;
  return (
    <>
      <section
        className="import-preview-summary"
        aria-labelledby="preview-title"
      >
        <div>
          <p className="card-kicker">Step 2 of 3</p>
          <h2 id="preview-title">Select valid normalized rows</h2>
          <p>
            Preview only. No commitment exists yet. Duplicate warnings are
            advisory, and duplicate rows start unchecked.
          </p>
        </div>
        <dl>
          <div>
            <dt>Valid</dt>
            <dd>{preview.validItemCount}</dd>
          </div>
          <div>
            <dt>Invalid</dt>
            <dd>{preview.invalidItemCount}</dd>
          </div>
          <div>
            <dt>Duplicates</dt>
            <dd>{preview.duplicateItemCount}</dd>
          </div>
          <div>
            <dt>Selected</dt>
            <dd aria-live="polite">{selectedCount}</dd>
          </div>
        </dl>
        <p className="import-retention">
          Unconfirmed preview availability deadline:{" "}
          <strong>{formatInstant(preview.expiresAt)}</strong>. Unconfirmed
          previews expire no later than 24 hours after upload.
        </p>
      </section>

      <fieldset className="import-preview-fieldset" disabled={busy}>
        <legend className="sr-only">CSV preview rows</legend>
        <ul className="import-preview-list">
          {preview.items.map((item) => (
            <ImportRow
              checked={selectedIds.has(item.id)}
              item={item}
              key={item.id}
              onChange={(checked) => onSelectionChange(item, checked)}
            />
          ))}
        </ul>
      </fieldset>

      <div className="import-actions">
        <button
          className="primary-action"
          disabled={busy || selectedCount === 0}
          onClick={(event) => onReview(event.currentTarget)}
          type="button"
        >
          Review {selectedCount} selected {selectedCount === 1 ? "row" : "rows"}
        </button>
        <button
          className="danger-link"
          disabled={busy}
          onClick={(event) => onDiscardOpen(true, event.currentTarget)}
          type="button"
        >
          Discard preview
        </button>
      </div>

      {confirmationOpen && (
        <section
          aria-labelledby="import-confirmation"
          className="import-confirmation-card"
        >
          <p className="card-kicker">Step 3 of 3</p>
          <h2 id="import-confirmation" tabIndex={-1}>
            Confirm {selectedCount} private commitments
          </h2>
          <p>
            Only these selected valid rows will become private app-local
            commitments. AutoPay Guard will not contact a bank or provider, move
            money, or revoke a mandate.
          </p>
          <label className="import-confirm-check">
            <input
              checked={confirmationAccepted}
              disabled={busy}
              onChange={(event) =>
                onConfirmationAccepted(event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>
              I reviewed the selected rows and understand this creates private
              tracking records only.
            </span>
          </label>
          <div className="import-actions">
            <button
              className="primary-action"
              disabled={busy || !confirmationAccepted || selectedCount === 0}
              onClick={onConfirm}
              type="button"
            >
              {busy ? "Confirming…" : "Create selected commitments"}
            </button>
            <button
              className="secondary-link secondary-link--button"
              disabled={busy}
              onClick={onCancelConfirmation}
              type="button"
            >
              Back to preview
            </button>
          </div>
        </section>
      )}

      {discardOpen && (
        <section
          aria-labelledby="discard-confirmation"
          className="import-confirmation-card import-confirmation-card--danger"
        >
          <h2 id="discard-confirmation" tabIndex={-1}>
            Discard this preview?
          </h2>
          <p>
            No commitment will be created. Discard operates only on the
            normalized preview; raw CSV content was not committed to storage.
          </p>
          <div className="import-actions">
            <button
              className="danger-action"
              disabled={busy}
              onClick={onDiscard}
              type="button"
            >
              {busy ? "Discarding…" : "Discard normalized preview"}
            </button>
            <button
              className="secondary-link secondary-link--button"
              disabled={busy}
              onClick={() => onDiscardOpen(false)}
              type="button"
            >
              Keep preview
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function ImportRow({
  checked,
  item,
  onChange,
}: {
  checked: boolean;
  item: ImportItemDto;
  onChange: (checked: boolean) => void;
}) {
  const duplicate = item.duplicateKind && item.duplicateKind !== "NONE";
  return (
    <li
      className={[
        "import-row",
        !item.valid ? "import-row--invalid" : "",
        duplicate ? "import-row--duplicate" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <label className="import-row__select">
        <input
          checked={item.valid && checked}
          disabled={!item.valid}
          onChange={(event) => onChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>
          Row {item.rowNumber}
          {!item.valid ? " — invalid" : ""}
        </span>
      </label>
      {item.valid && item.preview ? (
        <>
          <div className="import-row__heading">
            <strong>{item.preview.name}</strong>
            {duplicate && (
              <span className="status-chip status-chip--paused">
                {item.duplicateKind === "IN_FILE"
                  ? "Duplicate in this file"
                  : "Matches an active commitment"}
              </span>
            )}
          </div>
          <dl className="import-row__details">
            <div>
              <dt>Amount</dt>
              <dd>
                {item.preview.amountMinor === null
                  ? "Unknown variable"
                  : formatMinorMoney(
                      item.preview.amountMinor,
                      item.preview.currency,
                    )}
              </dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{humanize(item.preview.category)}</dd>
            </div>
            <div>
              <dt>Frequency</dt>
              <dd>{humanize(item.preview.frequency)}</dd>
            </div>
            <div>
              <dt>Next due</dt>
              <dd>{safeFormatDate(item.preview.nextDueDate)}</dd>
            </div>
            <div>
              <dt>Payment rail</dt>
              <dd>
                {item.preview.paymentRail
                  ? humanize(item.preview.paymentRail)
                  : "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Masked label</dt>
              <dd>{item.preview.maskedPaymentLabel ?? "Not provided"}</dd>
            </div>
          </dl>
          {duplicate && (
            <p className="import-row__warning">
              This row starts unchecked. Select it only after reviewing the
              exact schedule.
            </p>
          )}
        </>
      ) : (
        <div className="import-row__errors">
          <strong>This row cannot be selected</strong>
          <ul>
            {item.errors.map((error, index) => (
              <li key={`${error.code}-${index}`}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function validateSelectedFile(file: File): string | null {
  if (
    file.name.length > 255 ||
    /[\u0000-\u001f\u007f/\\]/.test(file.name) ||
    file.name.includes("..") ||
    !file.name.toLowerCase().endsWith(".csv")
  ) {
    return "Choose a safely named file ending in .csv.";
  }
  if (file.type !== "text/csv") {
    return "The selected file must have the exact text/csv type.";
  }
  if (file.size < 1) {
    return "The selected CSV is empty.";
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return "The selected CSV is larger than 256 KiB.";
  }
  return null;
}

function defaultSelection(items: ImportItemDto[]) {
  return new Set(
    items
      .filter(
        (item) =>
          item.valid && item.preview !== null && item.duplicateKind === "NONE",
      )
      .map((item) => item.id),
  );
}

function assertPreviewScope(
  preview: ImportPreviewJobDto,
  householdId: string,
  importId: string,
) {
  const validItems = preview.items.filter((item) => item.valid);
  const invalidItems = preview.items.filter((item) => !item.valid);
  const duplicateItems = validItems.filter(
    (item) => item.duplicateKind !== "NONE",
  );
  if (
    preview.id !== importId ||
    preview.householdId !== householdId ||
    preview.status !== "PREVIEW_READY" ||
    !preview.rawProcessedAt ||
    preview.selectedItemCount !== 0 ||
    preview.createdCommitmentCount !== 0 ||
    preview.totalItemCount !== preview.items.length ||
    preview.validItemCount !== validItems.length ||
    preview.invalidItemCount !== invalidItems.length ||
    preview.duplicateItemCount !== duplicateItems.length ||
    preview.validItemCount + preview.invalidItemCount !==
      preview.totalItemCount ||
    preview.items.length > 100 ||
    new Set(preview.items.map((item) => item.id.toLowerCase())).size !==
      preview.items.length ||
    preview.items.some(
      (item) =>
        (item.valid &&
          (!item.preview ||
            item.errors.length !== 0 ||
            !["NONE", "IN_FILE", "EXISTING"].includes(
              item.duplicateKind ?? "",
            ) ||
            item.createdCommitmentId !== null)) ||
        (!item.valid &&
          (item.preview !== null ||
            item.errors.length === 0 ||
            item.duplicateKind !== null ||
            item.selected !== null ||
            item.createdCommitmentId !== null)),
    )
  ) {
    throw new ImportApiError(502, null);
  }
}

function assertImportIdentity(
  preview: ImportPreviewJobDto,
  householdId: string,
  importId: string,
) {
  if (preview.id !== importId || preview.householdId !== householdId) {
    throw new ImportApiError(502, null);
  }
}

function importError(
  cause: unknown,
  action: "upload" | "confirm" | "discard" | "reload",
) {
  if (cause instanceof ImportApiError) {
    if (cause.status === 412) {
      return "This preview changed in another tab. Reload the latest preview before continuing.";
    }
    if (
      action === "confirm" &&
      ![
        400, 401, 403, 404, 409, 410, 412, 413, 415, 422, 428, 429, 502,
      ].includes(cause.status)
    ) {
      return "Could not confirm whether rows were imported. Reload the preview and commitments before retrying.";
    }
    return cause.message;
  }
  if (action === "confirm") {
    return "Could not confirm whether rows were imported. Reload the preview and commitments before retrying.";
  }
  return "The import service is unavailable. No commitment was confirmed.";
}

function safeFormatDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatLocalDate(value) : value;
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} bytes` : `${Math.ceil(bytes / 1024)} KiB`;
}

function formatInstant(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
