package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "AttemptTrackStatus")
public enum CancellationTrackStatus {
    NOT_REQUIRED,
    NOT_STARTED,
    REQUESTED,
    CONFIRMED,
    FAILED
}
