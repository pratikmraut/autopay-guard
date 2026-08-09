package in.autopayguard.api.cancellation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.Immutable;

@Entity
@Immutable
@Table(name = "cancellation_target_allowlist")
class CancellationTargetEntity {

    @Id
    @Column(name = "target_key", nullable = false, length = 100, updatable = false)
    private String targetKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "action_type", nullable = false, length = 24, updatable = false)
    private GuideStepKind actionType;

    @Column(name = "scheme", nullable = false, length = 32, updatable = false)
    private String scheme;

    @Column(name = "host", nullable = false, length = 253, updatable = false)
    private String host;

    @Column(name = "path_prefix", nullable = false, length = 300, updatable = false)
    private String pathPrefix;

    @Column(name = "enabled", nullable = false, updatable = false)
    private boolean enabled;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected CancellationTargetEntity() {}

    String targetKey() {
        return targetKey;
    }

    GuideStepKind actionType() {
        return actionType;
    }

    String scheme() {
        return scheme;
    }

    String host() {
        return host;
    }

    String pathPrefix() {
        return pathPrefix;
    }

    boolean enabled() {
        return enabled;
    }
}
