package in.autopayguard.api.commitment;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.UUID;

@Schema(
        name = "CreateCommitmentRequest",
        description =
                "Manual recurring commitment input. Ownership, provenance, confidence and "
                        + "visibility are derived by the server.",
        requiredProperties = {
            "householdId",
            "merchantId",
            "displayName",
            "category",
            "paymentRail",
            "amountMinor",
            "estimatedAmountMinor",
            "currency",
            "frequency",
            "intervalCount",
            "customIntervalUnit",
            "anchorDate",
            "monthDayPolicy",
            "variableAmount",
            "maskedPaymentLabel"
        })
public record CreateCommitmentRequest(
        @NotNull UUID householdId,
        @JsonProperty(required = true) @Schema(nullable = true) UUID merchantId,
        @NotBlank @Size(max = 160) String displayName,
        @NotNull CommitmentCategory category,
        @NotNull PaymentRail paymentRail,
        @JsonProperty(required = true)
                @Schema(nullable = true)
                @Positive
                @Max(999_999_999_999L)
                Long amountMinor,
        @JsonProperty(required = true)
                @Schema(nullable = true)
                @Positive
                @Max(999_999_999_999L)
                Long estimatedAmountMinor,
        @NotBlank
                @Pattern(
                        regexp = "^[A-Z]{3}$",
                        message = "must be a 3-letter uppercase ISO code")
                String currency,
        @NotNull RecurrenceFrequency frequency,
        @NotNull @Min(1) @Max(3650) Integer intervalCount,
        @JsonProperty(required = true)
                @Schema(nullable = true)
                CustomIntervalUnit customIntervalUnit,
        @NotNull LocalDate anchorDate,
        @NotNull MonthDayPolicy monthDayPolicy,
        @NotNull Boolean variableAmount,
        @JsonProperty(required = true)
                @Schema(nullable = true)
                @Size(max = 64)
                String maskedPaymentLabel) {}
