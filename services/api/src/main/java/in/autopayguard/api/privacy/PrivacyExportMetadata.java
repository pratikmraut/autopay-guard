package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(
        name = "PrivacyExportMetadata",
        requiredProperties = {
            "schemaVersion", "sha256", "byteCount", "generatedAt", "expiresAt"
        })
public record PrivacyExportMetadata(
        @Schema(
                        allowableValues = {
                            "autopay-guard-export-v1", "autopay-guard-export-v2"
                        })
                String schemaVersion,
        @Schema(pattern = "^[a-f0-9]{64}$", minLength = 64, maxLength = 64)
                String sha256,
        @Schema(minimum = "0", maximum = "5242880") long byteCount,
        Instant generatedAt,
        Instant expiresAt) {}
