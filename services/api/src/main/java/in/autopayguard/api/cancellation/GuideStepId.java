package in.autopayguard.api.cancellation;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

final class GuideStepId implements Serializable {

    private UUID guideId;
    private int guideVersion;
    private GuideTrackKind track;
    private int sequenceNumber;

    GuideStepId() {}

    GuideStepId(
            UUID guideId,
            int guideVersion,
            GuideTrackKind track,
            int sequenceNumber) {
        this.guideId = guideId;
        this.guideVersion = guideVersion;
        this.track = track;
        this.sequenceNumber = sequenceNumber;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof GuideStepId that)) {
            return false;
        }
        return guideVersion == that.guideVersion
                && sequenceNumber == that.sequenceNumber
                && Objects.equals(guideId, that.guideId)
                && track == that.track;
    }

    @Override
    public int hashCode() {
        return Objects.hash(guideId, guideVersion, track, sequenceNumber);
    }
}
