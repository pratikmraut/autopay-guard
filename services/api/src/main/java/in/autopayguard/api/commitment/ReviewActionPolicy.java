package in.autopayguard.api.commitment;

import java.util.List;

public final class ReviewActionPolicy {

    private ReviewActionPolicy() {}

    public static List<ReviewAction> forCategory(CommitmentCategory category) {
        return switch (category) {
            case SUBSCRIPTION, MEMBERSHIP, SOFTWARE ->
                    List.of(
                            ReviewAction.KEEP,
                            ReviewAction.REVIEW,
                            ReviewAction.PAUSE_TRACKING,
                            ReviewAction.CANCEL_WITH_PROVIDER,
                            ReviewAction.DOWNGRADE_WITH_PROVIDER,
                            ReviewAction.SWITCH_PROVIDER);
            case UTILITY ->
                    List.of(
                            ReviewAction.KEEP,
                            ReviewAction.REVIEW,
                            ReviewAction.CONFIRM_BILL,
                            ReviewAction.COMPARE_PROVIDERS,
                            ReviewAction.SWITCH_PROVIDER);
            case EMI_LOAN ->
                    List.of(
                            ReviewAction.REVIEW,
                            ReviewAction.DUE_DATE_READINESS,
                            ReviewAction.PAYMENT_CONFIRMATION);
            case INSURANCE ->
                    List.of(
                            ReviewAction.KEEP,
                            ReviewAction.REVIEW,
                            ReviewAction.RENEWAL_READINESS);
            case INVESTMENT_COMMITMENT ->
                    List.of(ReviewAction.KEEP, ReviewAction.REVIEW, ReviewAction.TRACK);
            case EDUCATION, OTHER -> List.of(ReviewAction.KEEP, ReviewAction.REVIEW);
        };
    }
}
