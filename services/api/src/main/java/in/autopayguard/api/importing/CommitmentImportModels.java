package in.autopayguard.api.importing;

import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.commitment.MonthDayPolicy;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.commitment.RecurrenceFrequency;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class CommitmentImportModels {

    private CommitmentImportModels() {}

    public enum JobStatus {
        PREVIEW_READY,
        CONFIRMED,
        DISCARDED,
        EXPIRED
    }

    public enum DuplicateKind {
        NONE,
        IN_FILE,
        EXISTING
    }

    public enum ErrorCode {
        NAME_INVALID("Name must normalize to between 1 and 160 characters."),
        NAME_SENSITIVE(
                "Name must not contain payment identifiers or obvious high-confidence credential patterns."),
        CATEGORY_INVALID("Category is not supported."),
        AMOUNT_INVALID("Amount must be a positive plain decimal rupee value with at most two fractional digits."),
        CURRENCY_INVALID("Currency must be a supported uppercase ISO 4217 code."),
        FREQUENCY_INVALID("Frequency is not supported for CSV import."),
        NEXT_DUE_DATE_INVALID("Next due date must be a supported strict ISO date."),
        PAYMENT_RAIL_INVALID("Payment rail is not supported."),
        MASKED_LABEL_INVALID("Masked payment label is invalid."),
        MASKED_LABEL_SENSITIVE(
                "Masked payment label must not contain payment identifiers or obvious high-confidence credential patterns.");

        private final String message;

        ErrorCode(String message) {
            this.message = message;
        }

        public String message() {
            return message;
        }
    }

    public record UploadResponse(
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid")
                    UUID id,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid")
                    UUID householdId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) JobStatus status,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "1",
                            maximum = "262144")
                    int rawByteCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date-time")
                    Instant expiresAt,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "1",
                            maximum = "100")
                    int totalItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "0",
                            maximum = "100")
                    int validItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "0",
                            maximum = "100")
                    int invalidItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "0",
                            maximum = "100")
                    int duplicateItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int64",
                            minimum = "0")
                    long version,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date-time")
                    Instant createdAt,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date-time")
                    Instant updatedAt) {}

    @Schema(
            name = "CommitmentImportUploadRequest",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    public record UploadRequest(
            @NotNull
                    @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid")
                    UUID householdId,
            @NotNull
                    @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "binary",
                            minLength = 1,
                            maxLength = 262144)
                    String file) {}

    public record JobResponse(
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid")
                    UUID id,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid")
                    UUID householdId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) JobStatus status,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "1",
                            maximum = "262144")
                    int rawByteCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date-time")
                    Instant expiresAt,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date-time")
                    Instant rawProcessedAt,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "1",
                            maximum = "100")
                    int totalItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "0",
                            maximum = "100")
                    int validItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "0",
                            maximum = "100")
                    int invalidItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "0",
                            maximum = "100")
                    int duplicateItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "0",
                            maximum = "100")
                    int selectedItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "0",
                            maximum = "100")
                    int createdCommitmentCount,
            @ArraySchema(
                            arraySchema =
                                    @Schema(
                                            requiredMode =
                                                    Schema.RequiredMode.REQUIRED),
                            schema = @Schema(implementation = ItemResponse.class),
                            minItems = 1,
                            maxItems = 100)
                    List<ItemResponse> items,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int64",
                            minimum = "0")
                    long version,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date-time")
                    Instant createdAt,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date-time")
                    Instant updatedAt) {}

    public record ItemResponse(
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid")
                    UUID id,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "2",
                            maximum = "101")
                    int rowNumber,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "boolean")
                    boolean valid,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            nullable = true)
                    DuplicateKind duplicateKind,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "boolean",
                            nullable = true)
                    Boolean selected,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid",
                            nullable = true)
                    UUID createdCommitmentId,
            @ArraySchema(
                            arraySchema =
                                    @Schema(
                                            requiredMode =
                                                    Schema.RequiredMode.REQUIRED),
                            schema = @Schema(implementation = ErrorResponse.class),
                            minItems = 0,
                            maxItems = 10)
                    List<ErrorResponse> errors,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            implementation = Preview.class,
                            nullable = true)
                    Preview preview) {}

    public record Preview(
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            minLength = 1,
                            maxLength = 160)
                    String name,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                    CommitmentCategory category,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int64",
                            minimum = "1",
                            maximum = "999999999999")
                    long amountMinor,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            minLength = 3,
                            maxLength = 3,
                            pattern = "^[A-Z]{3}$")
                    String currency,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            allowableValues = {
                                "WEEKLY",
                                "MONTHLY",
                                "QUARTERLY",
                                "HALF_YEARLY",
                                "YEARLY"
                            })
                    RecurrenceFrequency frequency,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date")
                    LocalDate nextDueDate,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                    MonthDayPolicy monthDayPolicy,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                    PaymentRail paymentRail,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            nullable = true,
                            minLength = 0,
                            maxLength = 64)
                    String maskedPaymentLabel,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid",
                            nullable = true)
                    UUID merchantId) {}

    public record ErrorResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ErrorCode code,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            minLength = 1,
                            maxLength = 200)
                    String message) {

        static ErrorResponse from(ErrorCode code) {
            return new ErrorResponse(code, code.message());
        }
    }

    @Schema(
            name = "ConfirmRequest",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    public record ConfirmRequest(
            @NotNull @Size(min = 1, max = 100)
                    @ArraySchema(
                            arraySchema =
                                    @Schema(
                                            requiredMode =
                                                    Schema.RequiredMode.REQUIRED),
                            schema = @Schema(type = "string", format = "uuid"),
                            minItems = 1,
                            maxItems = 100,
                            uniqueItems = true)
                    List<@NotNull UUID> selectedItemIds) {}

    public record ConfirmationResponse(
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "uuid")
                    UUID importId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) JobStatus status,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "1",
                            maximum = "100")
                    int selectedItemCount,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int32",
                            minimum = "1",
                            maximum = "100")
                    int createdCommitmentCount,
            @ArraySchema(
                            arraySchema =
                                    @Schema(
                                            requiredMode =
                                                    Schema.RequiredMode.REQUIRED),
                            schema = @Schema(type = "string", format = "uuid"),
                            minItems = 1,
                            maxItems = 100,
                            uniqueItems = true)
                    List<UUID> commitmentIds,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "string",
                            format = "date-time")
                    Instant rawProcessedAt,
            @Schema(
                            requiredMode = Schema.RequiredMode.REQUIRED,
                            type = "integer",
                            format = "int64",
                            minimum = "0")
                    long version) {}

    record UploadOutcome(UploadResponse response, boolean replay) {}

    record ConfirmationOutcome(
            ConfirmationResponse response, boolean replay) {}

    record ParsedFile(List<ParsedRow> rows) {}

    record ParsedRow(
            int rowNumber,
            boolean valid,
            String fingerprint,
            String name,
            CommitmentCategory category,
            Long amountMinor,
            String currency,
            RecurrenceFrequency frequency,
            LocalDate nextDueDate,
            MonthDayPolicy monthDayPolicy,
            PaymentRail paymentRail,
            String maskedPaymentLabel,
            UUID merchantId,
            List<ErrorCode> errors) {}
}
