package in.autopayguard.api.notification;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(
        name = "UpdateNotificationPreferencesRequest",
        description = "Complete global notification preference representation.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {
            "enabled",
            "inAppEnabled",
            "emailEnabled",
            "timezone",
            "quietHoursEnabled",
            "quietStart",
            "quietEnd"
        })
public record UpdateNotificationPreferencesRequest(
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                Boolean enabled,
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                Boolean inAppEnabled,
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                Boolean emailEnabled,
        @NotBlank
                @Size(min = 1, max = 64)
                @Schema(
                        example = "Asia/Kolkata",
                        minLength = 1,
                        maxLength = 64,
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String timezone,
        @NotNull
                @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                Boolean quietHoursEnabled,
        @JsonProperty(required = true)
                @Pattern(
                        regexp = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
                        message = "must use HH:mm minute precision")
                @Schema(
                        nullable = true,
                        example = "22:00",
                        pattern = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
                String quietStart,
        @JsonProperty(required = true)
                @Pattern(
                        regexp = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
                        message = "must use HH:mm minute precision")
                @Schema(
                        nullable = true,
                        example = "07:00",
                        pattern = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
                String quietEnd) {}
