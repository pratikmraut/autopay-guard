package in.autopayguard.api.cancellation;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

final class GuideVersionId implements Serializable {

    private UUID guideId;
    private int version;

    GuideVersionId() {}

    GuideVersionId(UUID guideId, int version) {
        this.guideId = guideId;
        this.version = version;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof GuideVersionId that)) {
            return false;
        }
        return version == that.version && Objects.equals(guideId, that.guideId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(guideId, version);
    }
}
