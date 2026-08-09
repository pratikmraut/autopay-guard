package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(
        name = "PrivacyRequest",
        requiredProperties = {
            "id",
            "requestType",
            "status",
            "correctionField",
            "correctionValue",
            "version",
            "createdAt",
            "updatedAt",
            "completedAt",
            "export"
        })
public record PrivacyRequestResponse(
        UUID id,
        PrivacyRequestType requestType,
        PrivacyRequestStatus status,
        @Schema(nullable = true, allowableValues = "TIMEZONE")
                String correctionField,
        @Schema(nullable = true, maxLength = 64) String correctionValue,
        @Schema(minimum = "0") long version,
        Instant createdAt,
        Instant updatedAt,
        @Schema(nullable = true) Instant completedAt,
        @Schema(nullable = true) PrivacyExportMetadata export) {}
