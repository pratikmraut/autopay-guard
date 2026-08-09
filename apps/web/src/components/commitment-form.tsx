"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ApiClientError,
  FoundationApi,
  type Commitment,
  type CreateCommitmentRequest,
  type Household,
  type MerchantSearchItem,
  type UpdateCommitmentRequest,
} from "@autopay-guard/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { CategoryGuidance } from "@/components/category-guidance";
import { Button } from "@/components/ui/button";
import {
  type CommitmentFormValues,
  createCommitmentFormSchema,
  type ValidCommitmentFormValues,
} from "@/lib/commitment-form-schema";
import { saveCommitmentErrorMessage } from "@/lib/commitment-api-messages";
import {
  commitmentCategories,
  categoryCanPauseTracking,
  paymentRails,
  recurrenceFrequencies,
  type CommitmentCategory,
} from "@/lib/commitment-options";
import { todayInTimeZone } from "@/lib/local-date";
import {
  currencyAmountPlaceholder,
  currencyFractionDigits,
  currencyInputPrefix,
  minorToMajorInput,
  parseMajorToMinor,
} from "@/lib/money";

interface CommitmentFormProps {
  household: Household;
  initial?: Commitment;
  onReloadLatest?: () => void;
}

export function CommitmentForm({
  household,
  initial,
  onReloadLatest,
}: CommitmentFormProps) {
  const router = useRouter();
  const api = useMemo(() => new FoundationApi({ baseUrl: "/api/bff" }), []);
  const formCurrency = initial?.currency ?? household.defaultCurrency;
  const formSchema = useMemo(
    () => createCommitmentFormSchema(formCurrency),
    [formCurrency],
  );
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CommitmentFormValues, unknown, ValidCommitmentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialValues(initial, household.timezone, formCurrency),
  });

  const category = useWatch({ control, name: "category" });
  const variableAmount = useWatch({ control, name: "variableAmount" });
  const frequency = useWatch({ control, name: "frequency" });
  const customIntervalUnit = useWatch({
    control,
    name: "customIntervalUnit",
  });
  const merchantId = useWatch({ control, name: "merchantId" });
  const canPauseTracking = categoryCanPauseTracking(category);
  const monthEndCompatible =
    frequency !== "WEEKLY" &&
    !(
      frequency === "CUSTOM" &&
      ["DAYS", "WEEKS"].includes(customIntervalUnit ?? "")
    );

  useEffect(() => {
    if (!monthEndCompatible) {
      setValue("monthDayPolicy", "ANCHOR_DAY", {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [monthEndCompatible, setValue]);

  useEffect(() => {
    if (initial && !canPauseTracking) {
      setValue("status", "ACTIVE", {
        shouldDirty: initial.status === "PAUSED",
        shouldValidate: true,
      });
    }
  }, [canPauseTracking, initial, setValue]);

  const submit = handleSubmit(async (values) => {
    setSubmissionError(null);
    setStaleConflict(false);
    const amountMinor = values.amount
      ? parseMajorToMinor(values.amount, formCurrency)
      : null;
    const shared = {
      merchantId: values.merchantId ?? null,
      displayName: values.displayName.trim(),
      category: values.category,
      paymentRail: values.paymentRail,
      amountMinor: values.variableAmount ? null : amountMinor,
      estimatedAmountMinor: values.variableAmount ? amountMinor : null,
      currency: formCurrency,
      frequency: values.frequency,
      intervalCount: values.intervalCount,
      customIntervalUnit:
        values.frequency === "CUSTOM"
          ? (values.customIntervalUnit ?? null)
          : null,
      anchorDate: values.anchorDate,
      monthDayPolicy: values.monthDayPolicy,
      variableAmount: values.variableAmount,
      maskedPaymentLabel: values.maskedPaymentLabel?.trim() || null,
    } satisfies Omit<CreateCommitmentRequest, "householdId">;

    try {
      let saved: Commitment;
      if (initial) {
        saved = await api.updateCommitment(
          {
            commitmentId: initial.id,
            ifMatch: `"${initial.version}"`,
          },
          {
            ...shared,
            status:
              values.status ??
              (initial.status === "PAUSED" ? "PAUSED" : "ACTIVE"),
          } satisfies UpdateCommitmentRequest,
        );
      } else {
        const request = {
          householdId: household.id,
          ...shared,
        } satisfies CreateCommitmentRequest;
        saved = await api.createCommitment(request);
      }

      if (!saved.id || saved.householdId !== household.id) {
        throw new Error("The API returned a mismatched commitment scope.");
      }
      router.push(
        `/commitments/${encodeURIComponent(saved.id)}?householdId=${encodeURIComponent(household.id)}&saved=1`,
      );
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 412) {
        setStaleConflict(true);
        setSubmissionError(
          "This commitment changed after you opened it. Reload the latest version before saving again.",
        );
        return;
      }
      setSubmissionError(saveCommitmentErrorMessage(error));
    }
  });

  return (
    <form className="commitment-form" noValidate onSubmit={submit}>
      {submissionError && (
        <div
          className={`form-alert ${staleConflict ? "form-alert--conflict" : ""}`}
          role="alert"
        >
          <strong>
            {staleConflict ? "A newer version exists" : "Could not save"}
          </strong>
          <p>{submissionError}</p>
          {staleConflict && onReloadLatest && (
            <button onClick={onReloadLatest} type="button">
              Reload latest version
            </button>
          )}
        </div>
      )}

      <section className="form-section" aria-labelledby="identity-section">
        <div className="form-section__heading">
          <span>01</span>
          <div>
            <h2 id="identity-section">What is recurring?</h2>
            <p>Use a name you will recognise. A catalog match is optional.</p>
          </div>
        </div>

        <MerchantSearch
          api={api}
          category={category}
          selected={Boolean(merchantId)}
          onClear={() => setValue("merchantId", undefined)}
          onSelect={(merchant) => {
            setValue("merchantId", merchant.id, { shouldDirty: true });
            setValue("displayName", merchant.canonicalName, {
              shouldDirty: true,
              shouldValidate: true,
            });
            setValue("category", merchant.category as CommitmentCategory, {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
        />
        <input type="hidden" {...register("merchantId")} />

        <div className="form-grid form-grid--two">
          <Field
            error={errors.displayName?.message}
            label="Display name"
            required
          >
            {(id, describedBy) => (
              <input
                {...register("displayName")}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.displayName)}
                autoComplete="off"
                className="field-input"
                id={id}
                maxLength={120}
              />
            )}
          </Field>
          <Field error={errors.category?.message} label="Category" required>
            {(id, describedBy) => (
              <select
                {...register("category")}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.category)}
                className="field-input"
                id={id}
              >
                {commitmentCategories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <CategoryGuidance category={category} />
      </section>

      <section className="form-section" aria-labelledby="amount-section">
        <div className="form-section__heading">
          <span>02</span>
          <div>
            <h2 id="amount-section">How much should you expect?</h2>
            <p>
              Amounts are stored as exact integer minor units, never floating
              point.
            </p>
          </div>
        </div>
        <label className="variable-toggle">
          <input {...register("variableAmount")} type="checkbox" />
          <span>
            <strong>The amount can vary</strong>
            <small>
              When enabled, enter an estimate or leave it blank as unknown.
            </small>
          </span>
        </label>
        <div className="form-grid form-grid--two">
          <Field
            error={errors.amount?.message}
            hint={
              variableAmount
                ? `Optional ${formCurrency} estimate. Leave blank to keep the amount unknown. ${currencyPrecisionHint(formCurrency)}`
                : `Required fixed amount in ${formCurrency}. ${currencyPrecisionHint(formCurrency)}`
            }
            label={`${variableAmount ? "Estimated amount" : "Fixed amount"} (${formCurrency})`}
            required={!variableAmount}
          >
            {(id, describedBy) => (
              <div
                className={`money-input ${currencyInputPrefix(formCurrency).length > 1 ? "money-input--code" : ""}`}
              >
                <span aria-hidden="true">
                  {currencyInputPrefix(formCurrency)}
                </span>
                <input
                  {...register("amount")}
                  aria-describedby={describedBy}
                  aria-invalid={Boolean(errors.amount)}
                  className="field-input"
                  id={id}
                  inputMode="decimal"
                  placeholder={
                    variableAmount
                      ? "Optional"
                      : currencyAmountPlaceholder(formCurrency)
                  }
                />
              </div>
            )}
          </Field>
          <div className="readonly-field readonly-field--form">
            <span>Currency</span>
            <strong>{formCurrency}</strong>
            <small>
              {initial
                ? "Preserved from this commitment"
                : `Inherited from ${household.name}`}
            </small>
          </div>
        </div>
      </section>

      <section className="form-section" aria-labelledby="schedule-section">
        <div className="form-section__heading">
          <span>03</span>
          <div>
            <h2 id="schedule-section">When does it recur?</h2>
            <p>
              The API calculates dates deterministically in the workspace
              timezone.
            </p>
          </div>
        </div>
        <div className="form-grid form-grid--three">
          <Field error={errors.frequency?.message} label="Frequency" required>
            {(id, describedBy) => (
              <select
                {...register("frequency")}
                aria-describedby={describedBy}
                className="field-input"
                id={id}
              >
                {recurrenceFrequencies.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            error={errors.intervalCount?.message}
            hint="For example: every 2 months."
            label="Every"
            required
          >
            {(id, describedBy) => (
              <input
                {...register("intervalCount")}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.intervalCount)}
                className="field-input"
                id={id}
                inputMode="numeric"
                min={1}
                max={365}
                type="number"
              />
            )}
          </Field>
          {frequency === "CUSTOM" && (
            <Field
              error={errors.customIntervalUnit?.message}
              label="Custom unit"
              required
            >
              {(id, describedBy) => (
                <select
                  {...register("customIntervalUnit")}
                  aria-describedby={describedBy}
                  className="field-input"
                  id={id}
                >
                  <option value="">Choose unit</option>
                  <option value="DAYS">Days</option>
                  <option value="WEEKS">Weeks</option>
                  <option value="MONTHS">Months</option>
                  <option value="YEARS">Years</option>
                </select>
              )}
            </Field>
          )}
          <Field
            error={errors.anchorDate?.message}
            label="Billing anchor"
            required
          >
            {(id, describedBy) => (
              <input
                {...register("anchorDate")}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.anchorDate)}
                className="field-input"
                id={id}
                type="date"
              />
            )}
          </Field>
          <Field
            error={errors.monthDayPolicy?.message}
            hint="Anchor day clamps short months, then returns to the original date."
            label="Month-day handling"
            required
          >
            {(id, describedBy) => (
              <select
                {...register("monthDayPolicy")}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.monthDayPolicy)}
                className="field-input"
                id={id}
              >
                <option value="ANCHOR_DAY">Keep anchor day</option>
                <option disabled={!monthEndCompatible} value="LAST_DAY">
                  Always use month end
                </option>
              </select>
            )}
          </Field>
        </div>
      </section>

      <section className="form-section" aria-labelledby="payment-section">
        <div className="form-section__heading">
          <span>04</span>
          <div>
            <h2 id="payment-section">How is it paid?</h2>
            <p>
              Add only a masked label. Never enter credentials or a full
              identifier.
            </p>
          </div>
        </div>
        <div className="form-grid form-grid--two">
          <Field
            error={errors.paymentRail?.message}
            label="Payment rail"
            required
          >
            {(id, describedBy) => (
              <select
                {...register("paymentRail")}
                aria-describedby={describedBy}
                className="field-input"
                id={id}
              >
                {paymentRails.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            error={errors.maskedPaymentLabel?.message}
            hint="Examples: Card ••42 or UPI mandate ••9. No full UPI ID."
            label="Masked payment label"
          >
            {(id, describedBy) => (
              <input
                {...register("maskedPaymentLabel")}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.maskedPaymentLabel)}
                className="field-input"
                id={id}
                maxLength={40}
                placeholder="Optional masked label"
              />
            )}
          </Field>
        </div>
        {initial && (
          <>
            <Field
              error={errors.status?.message}
              hint={
                canPauseTracking
                  ? "Pausing only affects AutoPay Guard tracking."
                  : "Pause is not offered for this category. This avoids implying that an essential or protected payment should be stopped."
              }
              label="Tracking status"
              required
            >
              {(id, describedBy) => (
                <select
                  {...register("status")}
                  aria-describedby={describedBy}
                  className="field-input max-w-xs"
                  id={id}
                >
                  <option value="ACTIVE">Active</option>
                  {canPauseTracking && <option value="PAUSED">Paused</option>}
                </select>
              )}
            </Field>
          </>
        )}
      </section>

      <div className="form-actions">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting
            ? "Saving commitment…"
            : initial
              ? "Save changes"
              : "Add recurring commitment"}
        </Button>
        <Link
          className="secondary-link"
          href={
            initial
              ? `/commitments/${encodeURIComponent(initial.id)}?householdId=${encodeURIComponent(household.id)}`
              : `/commitments?householdId=${encodeURIComponent(household.id)}`
          }
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}

function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="form-field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children(id, describedBy || undefined)}
      {hint && <p id={`${id}-hint`}>{hint}</p>}
      {error && (
        <p className="form-field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface MerchantSearchProps {
  api: FoundationApi;
  category: CommitmentCategory;
  selected: boolean;
  onSelect: (merchant: MerchantSearchItem) => void;
  onClear: () => void;
}

function MerchantSearch({
  api,
  category,
  selected,
  onSelect,
  onClear,
}: MerchantSearchProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MerchantSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2 || selected) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setSearching(true);
      setSearchError(false);
      api
        .searchMerchants(
          { q: query.trim(), category, limit: 8 },
          { signal: controller.signal },
        )
        .then(({ items }) => {
          setResults(items);
          setSearchError(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([]);
            setSearchError(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearching(false);
          }
        });
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [api, category, query, selected]);

  return (
    <div className="merchant-search">
      <label htmlFor={id}>Find a known merchant (optional)</label>
      {selected ? (
        <div className="merchant-selected">
          <span aria-hidden="true">✓</span>
          Catalog merchant selected
          <button
            onClick={() => {
              onClear();
              setQuery("");
              setSearchError(false);
            }}
            type="button"
          >
            Clear match
          </button>
        </div>
      ) : (
        <>
          <input
            className="field-input"
            id={id}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setSearchError(false);
              setSearching(event.target.value.trim().length >= 2);
            }}
            placeholder="Try StreamBox, CloudNest, or FitClub"
            type="search"
            value={query}
          />
          <p className="merchant-search__status" role="status">
            {searching
              ? "Searching the fake local merchant catalog…"
              : searchError
                ? "Catalog search unavailable; enter manually or retry."
                : query.trim().length >= 2 && results.length === 0
                  ? "No catalog match. You can still enter it manually."
                  : ""}
          </p>
          {results.length > 0 && (
            <ul aria-label="Merchant search results">
              {results.map((merchant) => (
                <li key={merchant.id}>
                  <button
                    onClick={() => {
                      onSelect(merchant);
                      setQuery(merchant.canonicalName);
                      setResults([]);
                      setSearching(false);
                      setSearchError(false);
                    }}
                    type="button"
                  >
                    <span>
                      <strong>{merchant.canonicalName}</strong>
                      <small>
                        {merchant.websiteHost} · {merchant.countryCode}
                      </small>
                    </span>
                    <i aria-hidden="true">Select</i>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function initialValues(
  initial: Commitment | undefined,
  householdTimeZone: string,
  currency: string,
): CommitmentFormValues {
  if (!initial) {
    return {
      displayName: "",
      category: "SUBSCRIPTION",
      paymentRail: "UNKNOWN",
      amount: "",
      variableAmount: false,
      frequency: "MONTHLY",
      intervalCount: 1,
      customIntervalUnit: undefined,
      anchorDate: todayInTimeZone(householdTimeZone),
      monthDayPolicy: "ANCHOR_DAY",
      maskedPaymentLabel: "",
      status: "ACTIVE",
    };
  }
  return {
    merchantId: initial.merchantId ?? undefined,
    displayName: initial.displayName,
    category: initial.category,
    paymentRail: initial.paymentRail,
    amount: minorToMajorInput(
      initial.variableAmount
        ? initial.estimatedAmountMinor
        : initial.amountMinor,
      currency,
    ),
    variableAmount: initial.variableAmount,
    frequency: initial.frequency,
    intervalCount: initial.intervalCount,
    customIntervalUnit: initial.customIntervalUnit ?? undefined,
    anchorDate: initial.anchorDate,
    monthDayPolicy: initial.monthDayPolicy,
    maskedPaymentLabel: initial.maskedPaymentLabel ?? "",
    status: initial.status === "PAUSED" ? "PAUSED" : "ACTIVE",
  };
}

function currencyPrecisionHint(currency: string) {
  const fractionDigits = currencyFractionDigits(currency);
  return fractionDigits === 0
    ? "Use whole units only."
    : `Use up to ${fractionDigits} decimal place${fractionDigits === 1 ? "" : "s"}.`;
}
