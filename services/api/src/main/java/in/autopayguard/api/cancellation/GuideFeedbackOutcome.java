package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "FeedbackOutcome")
public enum GuideFeedbackOutcome {
    WORKED,
    OUTDATED,
    MERCHANT_CHANGED_FLOW,
    UNSAFE_LINK
}
