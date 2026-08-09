package in.autopayguard.api.privacy;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(
        name = "ConsentEvent",
        requiredProperties = {
            "id", "purpose", "purposeVersion", "action", "occurredAt"
        })
public record ConsentEventResponse(
        UUID id,
        ConsentPurpose purpose,
        @Schema(
                        maxLength = 64,
                        pattern = "^[a-z0-9][a-z0-9._-]{0,63}$")
                String purposeVersion,
        ConsentAction action,
        Instant occurredAt) {}
