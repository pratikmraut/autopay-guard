import type {
  CurrencyProjection,
  ProjectionPeriod,
} from "@autopay-guard/contracts";

import { formatLocalDate } from "@/lib/local-date";
import { formatMinorMoney } from "@/lib/money";

interface ProjectionBreakdownProps {
  period: ProjectionPeriod;
  compact?: boolean;
}

export function ProjectionBreakdown({
  period,
  compact = false,
}: ProjectionBreakdownProps) {
  if (period.totals.length === 0) {
    return (
      <div className="projection-empty">
        <strong>No expected amount in this period</strong>
        <span>
          {period.unknownVariableOccurrenceCount > 0
            ? `${period.unknownVariableOccurrenceCount} variable occurrence${period.unknownVariableOccurrenceCount === 1 ? "" : "s"} still have an unknown amount.`
            : "No active occurrence is scheduled."}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`projection-breakdown ${compact ? "projection-breakdown--compact" : ""}`}
    >
      {period.totals.map((total) => (
        <CurrencyProjectionCard
          compact={compact}
          key={total.currency}
          total={total}
        />
      ))}
      {!compact && (
        <p className="projection-period-note">
          {period.occurrenceCount} occurrence
          {period.occurrenceCount === 1 ? "" : "s"} from{" "}
          {formatLocalDate(period.from)} to {formatLocalDate(period.to)}.{" "}
          {period.unknownVariableOccurrenceCount > 0
            ? `${period.unknownVariableOccurrenceCount} unknown variable amount${period.unknownVariableOccurrenceCount === 1 ? " is" : "s are"} excluded from known totals.`
            : "No unknown variable amount is excluded."}
        </p>
      )}
    </div>
  );
}

function CurrencyProjectionCard({
  total,
  compact,
}: {
  total: CurrencyProjection;
  compact: boolean;
}) {
  return (
    <article className="projection-currency" data-currency={total.currency}>
      <header>
        <span>{total.currency}</span>
        <strong>
          {formatMinorMoney(total.knownTotalMinor, total.currency)}
        </strong>
        <small>
          Known total{total.containsEstimates ? " · includes estimates" : ""}
          {total.unknownVariableOccurrenceCount > 0
            ? ` · ${total.unknownVariableOccurrenceCount} unknown excluded`
            : ""}
        </small>
      </header>
      {!compact && (
        <dl>
          <div>
            <dt>Fixed</dt>
            <dd>{formatMinorMoney(total.fixedAmountMinor, total.currency)}</dd>
            <dd className="projection-definition-note">
              {total.fixedOccurrenceCount} occurrence
              {total.fixedOccurrenceCount === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt>Estimated variable</dt>
            <dd>
              ≈{" "}
              {formatMinorMoney(
                total.estimatedVariableAmountMinor,
                total.currency,
              )}
            </dd>
            <dd className="projection-definition-note">
              {total.estimatedVariableOccurrenceCount} occurrence
              {total.estimatedVariableOccurrenceCount === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt>Unknown variable</dt>
            <dd>{total.unknownVariableOccurrenceCount}</dd>
            <dd className="projection-definition-note">
              Excluded from known total
            </dd>
          </div>
        </dl>
      )}
    </article>
  );
}
