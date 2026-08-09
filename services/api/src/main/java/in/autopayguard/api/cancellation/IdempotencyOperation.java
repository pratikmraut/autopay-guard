package in.autopayguard.api.cancellation;

enum IdempotencyOperation {
    OCCURRENCE_DECISION,
    CANCELLATION_ATTEMPT,
    ATTEMPT_VERIFICATION,
    GUIDE_FEEDBACK
}
