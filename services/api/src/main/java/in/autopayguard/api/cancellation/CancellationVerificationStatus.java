package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "VerificationStatus")
public enum CancellationVerificationStatus {
    PENDING,
    SELF_REPORTED,
    VERIFIED,
    DISPUTED
}
