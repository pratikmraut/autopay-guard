package in.autopayguard.api.notification;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(
        name = "UpdateNotificationReadRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"read"})
public record UpdateNotificationReadRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Boolean read) {}
