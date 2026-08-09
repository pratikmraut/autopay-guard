package in.autopayguard.api.cancellation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.Immutable;

@Entity
@Immutable
@IdClass(GuideVersionId.class)
@Table(name = "cancellation_guide_versions")
class CancellationGuideVersionEntity {

    @Id
    @Column(name = "guide_id", nullable = false, updatable = false)
    private UUID guideId;

    @Id
    @Column(name = "version", nullable = false, updatable = false)
    private int version;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16, updatable = false)
    private GuideStatus status;

    @Column(name = "risk_notice", nullable = false, length = 1000, updatable = false)
    private String riskNotice;

    @Column(name = "structural_reviewed_at", nullable = false, updatable = false)
    private Instant structuralReviewedAt;

    @Column(name = "review_interval_days", nullable = false, updatable = false)
    private int reviewIntervalDays;

    @Column(name = "published_at", updatable = false)
    private Instant publishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected CancellationGuideVersionEntity() {}

    UUID guideId() {
        return guideId;
    }

    int version() {
        return version;
    }

    GuideStatus status() {
        return status;
    }

    String riskNotice() {
        return riskNotice;
    }

    Instant structuralReviewedAt() {
        return structuralReviewedAt;
    }

    int reviewIntervalDays() {
        return reviewIntervalDays;
    }

    Instant publishedAt() {
        return publishedAt;
    }

    Instant reviewDueAt() {
        return structuralReviewedAt.plus(java.time.Duration.ofDays(reviewIntervalDays));
    }
}
