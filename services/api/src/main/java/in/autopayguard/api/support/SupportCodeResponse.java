package in.autopayguard.api.support;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(
        name = "SupportCode",
        requiredProperties = {"id", "status", "version", "expiresAt", "createdAt"})
public record SupportCodeResponse(
        UUID id,
        @Schema(allowableValues = {"ACTIVE", "REVOKED", "EXPIRED"}) String status,
        @Schema(minimum = "0") long version,
        Instant expiresAt,
        Instant createdAt) {}
