"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  addLocalMonths,
  formatLocalDate,
  formatYearMonth,
} from "@/lib/local-date";
import { formatMinorMoney, minorToMajorInput } from "@/lib/money";
import {
  archiveDemoCommitment,
  createDemoCommitments,
  DEMO_MAX_COMMITMENTS,
  DEMO_MONTH,
  demoDueDate,
  demoProjection,
  demoUpcoming,
  validateDemoDraft,
  type DemoCommitment,
  type DemoDraft,
  type DemoDraftErrors,
} from "@/lib/demo-workspace";
import styles from "./demo-workspace.module.css";

const BOUNDARY =
  "Sample data only. Changes stay in this tab and reset on refresh. No payments or emails are sent.";

export function DemoWorkspace() {
  const [commitments, setCommitments] = useState(createDemoCommitments);
  const [month, setMonth] = useState(DEMO_MONTH);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<DemoCommitment | "new" | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const sequence = useRef(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const monthly = demoProjection(commitments);
  const annual = demoProjection(commitments, 12);
  const active = commitments.filter((item) => !item.archived);
  const filtered = active.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const upcoming = demoUpcoming(commitments, month);

  function finishEditor() {
    setEditor(null);
    addButton.current?.focus();
  }

  function save(value: Omit<DemoCommitment, "id" | "archived">) {
    if (editor === "new") {
      if (commitments.length >= DEMO_MAX_COMMITMENTS) {
        setMessage(
          "This sample is limited to 50 records including archived items. Reset the demo to start again.",
        );
        return;
      }
      sequence.current += 1;
      const id = `sample-added-${sequence.current}`;
      setCommitments((current) => [
        ...current,
        { ...value, id, archived: false },
      ]);
      setMessage(`${value.name} added to this tab only.`);
    } else if (editor) {
      setCommitments((current) =>
        current.map((item) =>
          item.id === editor.id ? { ...item, ...value } : item,
        ),
      );
      setMessage(`${value.name} updated in this tab only.`);
    }
    finishEditor();
  }

  function reset() {
    setCommitments(createDemoCommitments());
    setMonth(DEMO_MONTH);
    setQuery("");
    setEditor(null);
    setArchiveId(null);
    setResetConfirm(false);
    sequence.current = 0;
    setMessage(
      "Sample reset. Your original four fictional commitments are back.",
    );
    addButton.current?.focus();
  }

  return (
    <div className={styles.page}>
      <a href="#demo-main" className="skip-link">
        Skip to sample workspace
      </a>
      <header className={styles.header}>
        <Link
          href="/"
          prefetch={false}
          className={styles.brand}
          aria-label="AutoPay Guard home"
        >
          <span aria-hidden="true">₹</span>AutoPay Guard
        </Link>
        <nav aria-label="Account navigation">
          <Link href="/signin" prefetch={false} className={styles.textLink}>
            Sign in
          </Link>
          <Link href="/signup" prefetch={false} className={styles.primary}>
            Create account
          </Link>
        </nav>
      </header>

      <main id="demo-main" className={styles.main}>
        <div className={styles.banner}>
          <span aria-hidden="true">✦</span>
          <p>
            {BOUNDARY} Please do not enter real personal or financial details.
          </p>
        </div>
        <section className={styles.intro} aria-labelledby="demo-title">
          <div>
            <p className={styles.kicker}>Interactive portfolio demo</p>
            <h1 id="demo-title">
              Your recurring money.
              <br />
              <em>A little more clear.</em>
            </h1>
            <p className={styles.lede}>
              Explore a fictional household. Add a sample subscription, edit an
              amount, or archive a commitment—and watch the numbers reconcile.
            </p>
          </div>
          <aside className={styles.tryCard} aria-label="Quick demo suggestion">
            <span className={styles.tryNumber}>01</span>
            <p>
              <strong>Try a one-minute walkthrough</strong>Add a ₹250 monthly
              sample. Change it to ₹275. Archive it to return to ₹4,500 monthly.
            </p>
          </aside>
        </section>

        <div className={styles.toolbar}>
          <div
            className={styles.monthPicker}
            role="group"
            aria-label="Sample scenario month"
          >
            <button
              type="button"
              aria-label="Previous sample month"
              disabled={month === "2000-01"}
              onClick={() => setMonth(addLocalMonths(month, -1))}
            >
              ←
            </button>
            <div>
              <span>Scenario month</span>
              <strong>{formatYearMonth(month)}</strong>
            </div>
            <button
              type="button"
              aria-label="Next sample month"
              disabled={month === "2099-12"}
              onClick={() => setMonth(addLocalMonths(month, 1))}
            >
              →
            </button>
          </div>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setResetConfirm(true)}
          >
            Reset sample
          </button>
        </div>
        {resetConfirm && (
          <section
            className={styles.confirm}
            aria-label="Reset sample confirmation"
          >
            <p>
              <strong>Reset this tab’s sample?</strong> Your changes will be
              discarded. No account or other visitor is affected.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={reset}>
                Confirm reset
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setResetConfirm(false)}
              >
                Keep my changes
              </button>
            </div>
          </section>
        )}

        <div className={styles.summary}>
          <ProjectionCard
            title="Calendar month"
            label="Monthly sample total"
            value={monthly}
            subtitle={formatYearMonth(month)}
          />
          <ProjectionCard
            title="12-month projection"
            label="12-month sample total"
            value={annual}
            subtitle={`${formatYearMonth(month)} – ${formatYearMonth(addLocalMonths(month, 11))}`}
          />
          <section
            className={styles.scopeCard}
            aria-labelledby="demo-scope-title"
          >
            <p className={styles.kicker}>A small, working sandbox</p>
            <h2 id="demo-scope-title">
              {monthly.activeCount}
              <span>active commitments</span>
            </h2>
            <p>Monthly schedules · INR only</p>
            <p>
              Fixed and estimated amounts stay separate. Each active sample
              repeats once a month; no proration or payment history is implied.
            </p>
          </section>
        </div>

        <p role="status" className={styles.status}>
          {message}
        </p>

        <section
          className={styles.commitments}
          aria-labelledby="demo-commitments-title"
        >
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.kicker}>Make the sample yours</p>
              <h2 id="demo-commitments-title">Recurring commitments</h2>
            </div>
            <button
              ref={addButton}
              type="button"
              className={styles.primary}
              disabled={commitments.length >= DEMO_MAX_COMMITMENTS}
              onClick={() => {
                setEditor("new");
                setArchiveId(null);
              }}
            >
              Add sample commitment <span aria-hidden="true">+</span>
            </button>
          </div>
          {commitments.length >= DEMO_MAX_COMMITMENTS && (
            <p className={styles.note}>
              50-record sample limit reached, including archived items. Reset to
              start again.
            </p>
          )}

          {editor && (
            <DemoEditor
              key={editor === "new" ? "new" : editor.id}
              initial={editor === "new" ? undefined : editor}
              onSave={save}
              onCancel={finishEditor}
            />
          )}

          <label className={styles.search}>
            Search sample commitments
            <input
              type="search"
              value={query}
              maxLength={60}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try StreamBox"
            />
          </label>

          {filtered.length === 0 ? (
            <p className={styles.empty}>
              {active.length === 0
                ? "No active sample commitments. Add one or reset the sample to explore again."
                : "No matching sample commitments. Clear the search to see all active items."}
            </p>
          ) : (
            <ul className={styles.list} aria-label="Active sample commitments">
              {filtered.map((item) => (
                <li key={item.id}>
                  <div className={styles.row}>
                    <span className={styles.itemMark} aria-hidden="true">
                      {item.name.slice(0, 1)}
                    </span>
                    <div className={styles.itemName}>
                      <h3>{item.name}</h3>
                      <p>
                        Monthly · day {item.day}
                        {item.day > 28
                          ? " (short months clamp to last day)"
                          : ""}
                      </p>
                    </div>
                    <div className={styles.amount}>
                      <strong>
                        {item.estimated ? "≈ " : ""}
                        {formatMinorMoney(item.amountMinor)}
                      </strong>
                      <span>
                        {item.estimated ? "Estimated variable" : "Fixed amount"}
                      </span>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.secondary}
                        aria-label={`Edit ${item.name}`}
                        onClick={() => {
                          setEditor(item);
                          setArchiveId(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.archiveButton}
                        aria-label={`Archive ${item.name}`}
                        onClick={() => {
                          setArchiveId(item.id);
                          setEditor(null);
                        }}
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                  {archiveId === item.id && (
                    <div className={styles.archiveConfirm}>
                      <p>
                        Archive <strong>{item.name}</strong> from this sample?
                        This only removes it from the projection, not from any
                        provider.
                      </p>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.primary}
                          onClick={() => {
                            setCommitments((current) =>
                              archiveDemoCommitment(current, item.id),
                            );
                            setArchiveId(null);
                            setMessage(
                              `${item.name} archived in this tab. No subscription was cancelled.`,
                            );
                          }}
                        >
                          Confirm archive
                        </button>
                        <button
                          type="button"
                          className={styles.secondary}
                          onClick={() => setArchiveId(null)}
                        >
                          Keep active
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className={styles.upcoming}
          aria-labelledby="demo-upcoming-title"
        >
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.kicker}>An illustrative schedule</p>
              <h2 id="demo-upcoming-title">
                Scheduled in {formatYearMonth(month)}
              </h2>
            </div>
            <span className={styles.pill}>
              {upcoming.length} sample occurrences
            </span>
          </div>
          <p className={styles.note}>
            A forecast for the selected scenario month, not actual debits.
            Changing a sample applies to every projected month.
          </p>
          {upcoming.length === 0 ? (
            <p className={styles.empty}>
              No scheduled samples. Add a commitment to build your forecast.
            </p>
          ) : (
            <ol className={styles.schedule}>
              {upcoming.map((item) => (
                <li key={item.id}>
                  <time dateTime={demoDueDate(month, item.day)}>
                    <strong>{item.dueDate.slice(-2)}</strong>
                    <span>
                      {new Intl.DateTimeFormat("en", {
                        month: "short",
                        timeZone: "UTC",
                      }).format(new Date(`${item.dueDate}T00:00:00Z`))}
                    </span>
                  </time>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{formatLocalDate(item.dueDate)}</span>
                  </div>
                  <p>
                    {item.estimated ? "≈ " : ""}
                    {formatMinorMoney(item.amountMinor)}
                    <span>
                      {item.estimated ? "Estimated variable" : "Fixed"}
                    </span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className={styles.footer}>
          <div>
            <strong>Ready for a workspace of your own?</strong>
            <p>
              The account-based app is separate. Sample changes cannot be
              transferred to an account.
            </p>
          </div>
          <Link href="/signup" prefetch={false} className={styles.primary}>
            Explore account creation →
          </Link>
        </footer>
      </main>
    </div>
  );
}

function ProjectionCard({
  title,
  label,
  value,
  subtitle,
}: {
  title: string;
  label: string;
  value: ReturnType<typeof demoProjection>;
  subtitle: string;
}) {
  return (
    <section className={styles.projection} aria-label={title}>
      <p className={styles.kicker}>{title}</p>
      <p className={styles.projectionPeriod}>{subtitle}</p>
      <div role="group" className={styles.total} aria-label={label}>
        <strong>{formatMinorMoney(value.knownMinor)}</strong>
      </div>
      <p className={styles.totalNote}>
        {value.estimatedMinor > 0
          ? "Known total · includes estimates"
          : "Known total · fixed amounts"}
      </p>
      <dl>
        <div>
          <dt>Fixed</dt>
          <dd>{formatMinorMoney(value.fixedMinor)}</dd>
        </div>
        <div>
          <dt>Estimated variable</dt>
          <dd>≈ {formatMinorMoney(value.estimatedMinor)}</dd>
        </div>
      </dl>
      <small>
        {value.occurrences} projected occurrences · no FX conversion
      </small>
    </section>
  );
}

function DemoEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: DemoCommitment;
  onSave: (value: Omit<DemoCommitment, "id" | "archived">) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DemoDraft>({
    name: initial?.name ?? "",
    amount: initial ? minorToMajorInput(initial.amountMinor) : "",
    kind: initial?.estimated ? "estimated" : "fixed",
    day: String(initial?.day ?? 15),
  });
  const [errors, setErrors] = useState<DemoDraftErrors>({});
  const nameInput = useRef<HTMLInputElement>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  useEffect(() => {
    if (Object.keys(errors).length > 0) errorSummary.current?.focus();
  }, [errors]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateDemoDraft(draft);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    onSave(result.value);
  }

  function field(key: keyof DemoDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className={styles.editor}
      onSubmit={submit}
      noValidate
      aria-labelledby="sample-editor-heading"
    >
      <h3 id="sample-editor-heading">
        {initial ? "Edit sample commitment" : "Add a fictional commitment"}
      </h3>
      <p>
        Use made-up details only. Monthly INR schedules are supported in this
        sandbox.
      </p>
      {Object.keys(errors).length > 0 && (
        <p
          ref={errorSummary}
          tabIndex={-1}
          role="alert"
          className={styles.error}
        >
          Check the highlighted fields. Nothing has been changed.
        </p>
      )}
      <div className={styles.fields}>
        <label>
          Fictional commitment name
          <input
            ref={nameInput}
            id="sample-name"
            value={draft.name}
            maxLength={60}
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "sample-name-error" : undefined}
            onChange={(event) => field("name", event.target.value)}
          />
          {errors.name && (
            <span id="sample-name-error" className={styles.error}>
              {errors.name}
            </span>
          )}
        </label>
        <label>
          Amount (INR)
          <input
            id="sample-amount"
            type="text"
            inputMode="decimal"
            value={draft.amount}
            maxLength={12}
            autoComplete="off"
            placeholder="250.00"
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={errors.amount ? "sample-amount-error" : undefined}
            onChange={(event) => field("amount", event.target.value)}
          />
          {errors.amount && (
            <span id="sample-amount-error" className={styles.error}>
              {errors.amount}
            </span>
          )}
        </label>
        <label>
          Amount type
          <select
            value={draft.kind}
            aria-invalid={Boolean(errors.kind)}
            aria-describedby={errors.kind ? "sample-kind-error" : undefined}
            onChange={(event) => field("kind", event.target.value)}
          >
            <option value="fixed">Fixed amount</option>
            <option value="estimated">Estimated variable amount</option>
          </select>
          {errors.kind && (
            <span id="sample-kind-error" className={styles.error}>
              {errors.kind}
            </span>
          )}
        </label>
        <label>
          Monthly day (1–31)
          <input
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={draft.day}
            aria-invalid={Boolean(errors.day)}
            aria-describedby={
              errors.day ? "sample-day-error" : "sample-day-help"
            }
            onChange={(event) => field("day", event.target.value)}
          />
          {errors.day ? (
            <span id="sample-day-error" className={styles.error}>
              {errors.day}
            </span>
          ) : (
            <span id="sample-day-help">
              Short months use their last day; the anchor day is preserved.
            </span>
          )}
        </label>
      </div>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>
          {initial ? "Save sample changes" : "Add to this sample"}
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel editing
        </button>
      </div>
    </form>
  );
}
