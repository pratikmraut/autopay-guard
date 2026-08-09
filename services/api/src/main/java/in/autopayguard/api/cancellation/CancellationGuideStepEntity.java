package in.autopayguard.api.cancellation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.util.UUID;
import org.hibernate.annotations.Immutable;

@Entity
@Immutable
@IdClass(GuideStepId.class)
@Table(name = "cancellation_guide_steps")
class CancellationGuideStepEntity {

    @Id
    @Column(name = "guide_id", nullable = false, updatable = false)
    private UUID guideId;

    @Id
    @Column(name = "guide_version", nullable = false, updatable = false)
    private int guideVersion;

    @Id
    @Enumerated(EnumType.STRING)
    @Column(name = "track", nullable = false, length = 24, updatable = false)
    private GuideTrackKind track;

    @Id
    @Column(name = "sequence_number", nullable = false, updatable = false)
    private int sequenceNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "action_type", nullable = false, length = 24, updatable = false)
    private GuideStepKind actionType;

    @Column(name = "title", nullable = false, length = 160, updatable = false)
    private String title;

    @Column(name = "instruction", nullable = false, length = 1000, updatable = false)
    private String instruction;

    @Column(name = "target_key", length = 100, updatable = false)
    private String targetKey;

    @Column(name = "target_uri", length = 1000, updatable = false)
    private String targetUri;

    protected CancellationGuideStepEntity() {}

    GuideTrackKind track() {
        return track;
    }

    int sequenceNumber() {
        return sequenceNumber;
    }

    GuideStepKind actionType() {
        return actionType;
    }

    String title() {
        return title;
    }

    String instruction() {
        return instruction;
    }

    String targetKey() {
        return targetKey;
    }

    String targetUri() {
        return targetUri;
    }
}
