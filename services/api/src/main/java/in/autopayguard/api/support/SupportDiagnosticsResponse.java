package in.autopayguard.api.support;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(
        name = "SupportDiagnostics",
        requiredProperties = {
            "schemaVersion",
            "status",
            "activeCommitmentCount",
            "failedNotificationCount",
            "pendingPrivacyRequestCount",
            "latestCommitmentVersion",
            "generatedAt",
            "grantExpiresAt"
        })
public record SupportDiagnosticsResponse(
        @Schema(allowableValues = "support-diagnostics-v1")
                String schemaVersion,
        @Schema(allowableValues = {"HEALTHY", "ATTENTION"}) String status,
        @Schema(minimum = "0") long activeCommitmentCount,
        @Schema(minimum = "0") long failedNotificationCount,
        @Schema(minimum = "0") long pendingPrivacyRequestCount,
        @Schema(minimum = "0") long latestCommitmentVersion,
        Instant generatedAt,
        Instant grantExpiresAt) {}
