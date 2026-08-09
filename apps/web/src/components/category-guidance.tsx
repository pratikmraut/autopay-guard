import type { Commitment } from "@autopay-guard/contracts";

import {
  categoryGuidance,
  type CommitmentCategory,
} from "@/lib/commitment-options";

const actionLabels: Record<string, string> = {
  KEEP: "Keep",
  REVIEW: "Review",
  PAUSE_TRACKING: "Pause tracking",
  CANCEL_WITH_PROVIDER: "Cancel with provider",
  DOWNGRADE_WITH_PROVIDER: "Downgrade with provider",
  SWITCH_PROVIDER: "Switch provider",
  CONFIRM_BILL: "Confirm bill",
  COMPARE_PROVIDERS: "Compare providers",
  DUE_DATE_READINESS: "Check due-date readiness",
  PAYMENT_CONFIRMATION: "Confirm payment",
  RENEWAL_READINESS: "Check renewal readiness",
  TRACK: "Track only",
};

interface CategoryGuidanceProps {
  category: CommitmentCategory;
  reviewActions?: Commitment["reviewActions"];
}

export function CategoryGuidance({
  category,
  reviewActions,
}: CategoryGuidanceProps) {
  const guidance = categoryGuidance[category];
  return (
    <aside
      className={`category-guidance category-guidance--${guidance.tone}`}
      aria-label="Category-safe guidance"
    >
      <div>
        <span aria-hidden="true">
          {guidance.tone === "caution" ? "!" : "✓"}
        </span>
        <div>
          <strong>{guidance.title}</strong>
          <p>{guidance.body}</p>
        </div>
      </div>
      {reviewActions && reviewActions.length > 0 && (
        <ReviewActionChips reviewActions={reviewActions} />
      )}
    </aside>
  );
}

export function ReviewActionChips({
  reviewActions,
}: {
  reviewActions: NonNullable<Commitment["reviewActions"]>;
}) {
  return (
    <div className="review-actions" aria-label="Available review actions">
      {reviewActions.map((action) => (
        <span key={action}>{actionLabels[action] ?? action}</span>
      ))}
    </div>
  );
}
