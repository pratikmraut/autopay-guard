package in.autopayguard.api.importing;

import static in.autopayguard.api.importing.CommitmentImportModels.ErrorCode;

import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.commitment.MonthDayPolicy;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.commitment.RecurrenceFrequency;
import in.autopayguard.api.common.idempotency.M5IdempotencyService;
import in.autopayguard.api.common.validation.SensitiveContentGuard;
import in.autopayguard.api.importing.CommitmentImportModels.ParsedFile;
import in.autopayguard.api.importing.CommitmentImportModels.ParsedRow;
import in.autopayguard.api.merchant.MerchantService;
import jakarta.validation.ValidationException;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
final class CommitmentCsvParser {

    static final int MAXIMUM_RAW_BYTES = 256 * 1024;
    private static final long MAXIMUM_AMOUNT_MINOR = 999_999_999_999L;
    private static final LocalDate MINIMUM_DATE = LocalDate.of(1900, 1, 1);
    private static final LocalDate MAXIMUM_DATE = LocalDate.of(2200, 12, 31);
    private static final byte[] UTF8_BOM = {
        (byte) 0xef, (byte) 0xbb, (byte) 0xbf
    };
    private static final List<String> HEADER =
            List.of(
                    "name",
                    "category",
                    "amount",
                    "currency",
                    "frequency",
                    "next_due_date",
                    "payment_rail",
                    "masked_payment_label");
    private static final int[] RAW_FIELD_LIMITS = {
        512, 80, 64, 16, 40, 40, 80, 256
    };
    private static final Pattern PLAIN_AMOUNT =
            Pattern.compile("^[0-9]+(?:\\.[0-9]{1,2})?$");
    private static final Pattern URL_LIKE =
            Pattern.compile(
                    "(?i)(?:\\b[a-z][a-z0-9+.-]{1,15}://|\\bwww\\.|"
                            + "\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+"
                            + "[a-z]{2,63}\\b|\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b|"
                            + "\\blocalhost\\b)");
    private static final Pattern SIX_DIGIT_SECRET_TOKEN =
            Pattern.compile("(?<![0-9])[0-9]{6,}(?![0-9])");
    private static final Pattern OTP_LIKE_SIX_DIGIT_SECRET =
            Pattern.compile(
                    "(?i)\\b(?:otp|one[ -]?time(?: password| code)?|"
                            + "verification code|authentication code|auth code|passcode)"
                            + "\\b[^0-9]{0,12}[0-9]{6}\\b");
    private static final Pattern SENSITIVE_PAYMENT_OR_AUTH_LABEL =
            Pattern.compile(
                    "(?i)\\b(?:otp|pin|passcode|cvv|cvc|account\\s+number|"
                            + "card\\s+number|upi\\s+id)\\b");
    private static final Pattern STRIPE_SECRET_KEY =
            Pattern.compile(
                    "(?i)(?<![A-Za-z0-9_])sk_(?:live|test)_[A-Za-z0-9]{16,}"
                            + "(?![A-Za-z0-9])");
    private static final Pattern GITHUB_TOKEN =
            Pattern.compile(
                    "(?i)(?<![A-Za-z0-9_])(?:ghp_[A-Za-z0-9]{20,}|"
                            + "github_pat_[A-Za-z0-9_]{20,})(?![A-Za-z0-9_])");
    private static final Pattern BEARER_TOKEN =
            Pattern.compile(
                    "(?i)\\bbearer\\s+[A-Za-z0-9._~+/=-]{16,}(?![A-Za-z0-9._~+/=-])");
    private static final Pattern JWT_LIKE =
            Pattern.compile(
                    "(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\\."
                            + "[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}"
                            + "(?![A-Za-z0-9_-])");
    private static final Pattern EXPLICIT_CREDENTIAL_ASSIGNMENT =
            Pattern.compile(
                    "(?i)\\b(?:password|passwd|api[_-]?key|secret|token)"
                            + "\\s*[:=]\\s*[\"']?[^\\s,\"']{8,}");

    private final MerchantService merchantService;

    CommitmentCsvParser(MerchantService merchantService) {
        this.merchantService = merchantService;
    }

    ParsedFile parse(byte[] rawBytes) {
        if (rawBytes == null
                || rawBytes.length < 1
                || rawBytes.length > MAXIMUM_RAW_BYTES) {
            throw invalidFile("The CSV must contain between 1 byte and 256 KiB.");
        }
        String content = strictUtf8(rawBytes);
        rejectUnsafeText(content);
        List<List<String>> records = parseRecords(content);
        if (records.isEmpty() || !records.getFirst().equals(HEADER)) {
            throw invalidFile("The CSV header is missing or does not match the template.");
        }
        if (records.size() < 2 || records.size() > 101) {
            throw invalidFile("The CSV must contain 1 through 100 data rows.");
        }

        List<ParsedRow> rows = new ArrayList<>(records.size() - 1);
        for (int index = 1; index < records.size(); index++) {
            List<String> fields = records.get(index);
            if (fields.equals(HEADER)) {
                throw invalidFile("The CSV header must appear exactly once.");
            }
            if (fields.size() != HEADER.size()) {
                throw invalidFile("Every CSV data row must contain exactly eight fields.");
            }
            for (int fieldIndex = 0; fieldIndex < fields.size(); fieldIndex++) {
                String field = fields.get(fieldIndex);
                if (field.length() > RAW_FIELD_LIMITS[fieldIndex]) {
                    throw invalidFile("A CSV field exceeds the accepted bound.");
                }
                String policyValue =
                        Normalizer.normalize(
                                stripPolicyWhitespace(field),
                                Normalizer.Form.NFKC);
                if (!policyValue.isEmpty()
                        && "=+-@".indexOf(policyValue.charAt(0)) >= 0) {
                    throw invalidFile("Formula-like CSV content is not accepted.");
                }
            }
            rows.add(normalize(index + 1, fields));
        }
        return new ParsedFile(List.copyOf(rows));
    }

    private ParsedRow normalize(int rowNumber, List<String> fields) {
        List<ErrorCode> errors = new ArrayList<>();
        String name = normalizeName(fields.get(0), errors);
        CommitmentCategory category =
                parseEnum(
                        fields.get(1),
                        CommitmentCategory.class,
                        ErrorCode.CATEGORY_INVALID,
                        errors);
        Long amountMinor = parseAmount(fields.get(2), errors);
        String currency = parseCurrency(fields.get(3), errors);
        RecurrenceFrequency frequency = parseFrequency(fields.get(4), errors);
        LocalDate nextDueDate = parseDate(fields.get(5), errors);
        PaymentRail paymentRail =
                parseEnum(
                        fields.get(6),
                        PaymentRail.class,
                        ErrorCode.PAYMENT_RAIL_INVALID,
                        errors);
        String maskedLabel = normalizeMaskedLabel(fields.get(7), errors);

        MonthDayPolicy monthDayPolicy = null;
        if (frequency != null && nextDueDate != null) {
            boolean monthBased =
                    frequency == RecurrenceFrequency.MONTHLY
                            || frequency == RecurrenceFrequency.QUARTERLY
                            || frequency == RecurrenceFrequency.HALF_YEARLY
                            || frequency == RecurrenceFrequency.YEARLY;
            monthDayPolicy =
                    monthBased
                                    && nextDueDate.equals(
                                            YearMonth.from(nextDueDate).atEndOfMonth())
                            ? MonthDayPolicy.LAST_DAY
                            : MonthDayPolicy.ANCHOR_DAY;
        }
        if (!errors.isEmpty()) {
            return invalidRow(rowNumber, errors);
        }

        UUID merchantId =
                merchantService
                        .findOneExactCompatible(name, category)
                        .map(reference -> reference.id())
                        .orElse(null);
        String fingerprint =
                scheduleFingerprint(
                        name,
                        category,
                        amountMinor,
                        currency,
                        frequency,
                        nextDueDate,
                        paymentRail);
        return new ParsedRow(
                rowNumber,
                true,
                fingerprint,
                name,
                category,
                amountMinor,
                currency,
                frequency,
                nextDueDate,
                monthDayPolicy,
                paymentRail,
                maskedLabel,
                merchantId,
                List.of());
    }

    private static ParsedRow invalidRow(
            int rowNumber, List<ErrorCode> errors) {
        return new ParsedRow(
                rowNumber,
                false,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                List.copyOf(errors));
    }

    private static String normalizeName(
            String rawValue, List<ErrorCode> errors) {
        String value = normalizedScheduleName(rawValue);
        if (value.isEmpty() || value.length() > 160) {
            errors.add(ErrorCode.NAME_INVALID);
            return null;
        }
        try {
            rejectCsvSensitiveContent(value, "name");
            return value;
        } catch (ValidationException exception) {
            errors.add(ErrorCode.NAME_SENSITIVE);
            return null;
        }
    }

    static String normalizedScheduleName(String rawValue) {
        return collapseWhitespace(
                Normalizer.normalize(rawValue, Normalizer.Form.NFKC));
    }

    static String scheduleFingerprint(
            String name,
            CommitmentCategory category,
            long amountMinor,
            String currency,
            RecurrenceFrequency frequency,
            LocalDate date,
            PaymentRail paymentRail) {
        return M5IdempotencyService.canonicalHash(
                List.of(
                        normalizedScheduleName(name),
                        category.name(),
                        Long.toString(amountMinor),
                        currency,
                        frequency.name(),
                        date.toString(),
                        paymentRail.name()));
    }

    private static Long parseAmount(
            String rawValue, List<ErrorCode> errors) {
        String value = stripPolicyWhitespace(rawValue);
        try {
            if (!PLAIN_AMOUNT.matcher(value).matches()) {
                throw new ArithmeticException();
            }
            long amountMinor =
                    new BigDecimal(value).movePointRight(2).longValueExact();
            if (amountMinor < 1 || amountMinor > MAXIMUM_AMOUNT_MINOR) {
                throw new ArithmeticException();
            }
            return amountMinor;
        } catch (ArithmeticException | NumberFormatException exception) {
            errors.add(ErrorCode.AMOUNT_INVALID);
            return null;
        }
    }

    private static String parseCurrency(
            String rawValue, List<ErrorCode> errors) {
        String value = stripPolicyWhitespace(rawValue);
        try {
            Currency currency = Currency.getInstance(value);
            if (!value.equals(currency.getCurrencyCode())
                    || !value.equals(value.toUpperCase(Locale.ROOT))) {
                throw new IllegalArgumentException();
            }
            return value;
        } catch (IllegalArgumentException exception) {
            errors.add(ErrorCode.CURRENCY_INVALID);
            return null;
        }
    }

    private static RecurrenceFrequency parseFrequency(
            String rawValue, List<ErrorCode> errors) {
        RecurrenceFrequency frequency =
                parseEnum(
                        rawValue,
                        RecurrenceFrequency.class,
                        ErrorCode.FREQUENCY_INVALID,
                        errors);
        if (frequency == RecurrenceFrequency.CUSTOM) {
            errors.add(ErrorCode.FREQUENCY_INVALID);
            return null;
        }
        return frequency;
    }

    private static LocalDate parseDate(
            String rawValue, List<ErrorCode> errors) {
        String value = stripPolicyWhitespace(rawValue);
        try {
            LocalDate date =
                    LocalDate.parse(value, DateTimeFormatter.ISO_LOCAL_DATE);
            if (!date.toString().equals(value)
                    || date.isBefore(MINIMUM_DATE)
                    || date.isAfter(MAXIMUM_DATE)) {
                throw new DateTimeParseException("outside range", value, 0);
            }
            return date;
        } catch (DateTimeParseException exception) {
            errors.add(ErrorCode.NEXT_DUE_DATE_INVALID);
            return null;
        }
    }

    private static String normalizeMaskedLabel(
            String rawValue, List<ErrorCode> errors) {
        String value =
                Normalizer.normalize(
                                stripPolicyWhitespace(rawValue),
                                Normalizer.Form.NFKC)
                        .strip();
        if (value.isEmpty()) {
            return null;
        }
        if (value.length() > 64) {
            errors.add(ErrorCode.MASKED_LABEL_INVALID);
            return null;
        }
        try {
            rejectCsvSensitiveContent(value, "maskedPaymentLabel");
            return value;
        } catch (ValidationException exception) {
            errors.add(ErrorCode.MASKED_LABEL_SENSITIVE);
            return null;
        }
    }

    private static <T extends Enum<T>> T parseEnum(
            String rawValue,
            Class<T> enumType,
            ErrorCode error,
            List<ErrorCode> errors) {
        try {
            return Enum.valueOf(
                    enumType, stripPolicyWhitespace(rawValue));
        } catch (IllegalArgumentException exception) {
            errors.add(error);
            return null;
        }
    }

    private static void rejectCsvSensitiveContent(String value, String field) {
        SensitiveContentGuard.rejectObviousSecrets(value, field);
        String policyValue =
                Normalizer.normalize(
                                stripPolicyWhitespace(value),
                                Normalizer.Form.NFKC)
                        .strip();
        if (URL_LIKE.matcher(policyValue).find()
                || totalDigits(policyValue) >= 7
                || policyValue.indexOf('@') >= 0
                || SENSITIVE_PAYMENT_OR_AUTH_LABEL.matcher(policyValue).find()
                || SIX_DIGIT_SECRET_TOKEN.matcher(policyValue).find()
                || OTP_LIKE_SIX_DIGIT_SECRET.matcher(policyValue).find()
                || STRIPE_SECRET_KEY.matcher(policyValue).find()
                || GITHUB_TOKEN.matcher(policyValue).find()
                || BEARER_TOKEN.matcher(policyValue).find()
                || JWT_LIKE.matcher(policyValue).find()
                || EXPLICIT_CREDENTIAL_ASSIGNMENT
                        .matcher(policyValue)
                        .find()) {
            throw new ValidationException(
                    field
                            + " must not contain URLs, payment identifiers, or obvious "
                            + "high-confidence credential patterns.");
        }
    }

    private static long totalDigits(String value) {
        return value.chars().filter(Character::isDigit).count();
    }

    private static String strictUtf8(byte[] rawBytes) {
        int offset = startsWithBom(rawBytes) ? UTF8_BOM.length : 0;
        try {
            String decoded =
                    StandardCharsets.UTF_8
                            .newDecoder()
                            .onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT)
                            .decode(
                                    ByteBuffer.wrap(
                                            rawBytes,
                                            offset,
                                            rawBytes.length - offset))
                            .toString();
            if (decoded.indexOf('\ufeff') >= 0) {
                throw invalidFile("The CSV contains an invalid byte-order mark.");
            }
            return decoded;
        } catch (CharacterCodingException exception) {
            throw invalidFile("The CSV must use strict UTF-8 encoding.");
        }
    }

    private static boolean startsWithBom(byte[] rawBytes) {
        return rawBytes.length >= UTF8_BOM.length
                && rawBytes[0] == UTF8_BOM[0]
                && rawBytes[1] == UTF8_BOM[1]
                && rawBytes[2] == UTF8_BOM[2];
    }

    private static void rejectUnsafeText(String content) {
        for (int offset = 0; offset < content.length(); ) {
            int codePoint = content.codePointAt(offset);
            if (codePoint == 0
                    || (Character.isISOControl(codePoint)
                            && codePoint != '\r'
                            && codePoint != '\n')) {
                throw invalidFile("The CSV contains unsupported control content.");
            }
            offset += Character.charCount(codePoint);
        }
    }

    private static List<List<String>> parseRecords(String content) {
        List<List<String>> records = new ArrayList<>();
        List<String> record = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        CsvState state = CsvState.START;
        boolean endedWithRecordSeparator = false;

        for (int index = 0; index < content.length(); index++) {
            char value = content.charAt(index);
            endedWithRecordSeparator = false;
            if (state == CsvState.QUOTED) {
                if (value == '"') {
                    if (index + 1 < content.length()
                            && content.charAt(index + 1) == '"') {
                        field.append('"');
                        index++;
                    } else {
                        state = CsvState.AFTER_QUOTE;
                    }
                } else if (value == '\r' || value == '\n') {
                    throw invalidFile("Embedded CSV line breaks are not accepted.");
                } else {
                    field.append(value);
                }
                continue;
            }
            if (value == ',') {
                record.add(field.toString());
                field.setLength(0);
                state = CsvState.START;
                continue;
            }
            if (value == '\r' || value == '\n') {
                if (value == '\r') {
                    if (index + 1 >= content.length()
                            || content.charAt(index + 1) != '\n') {
                        throw invalidFile("The CSV contains an invalid record separator.");
                    }
                    index++;
                }
                record.add(field.toString());
                records.add(List.copyOf(record));
                record = new ArrayList<>();
                field.setLength(0);
                state = CsvState.START;
                endedWithRecordSeparator = true;
                continue;
            }
            if (state == CsvState.AFTER_QUOTE) {
                throw invalidFile("The CSV contains malformed quoted content.");
            }
            if (value == '"') {
                if (state != CsvState.START || field.length() != 0) {
                    throw invalidFile("The CSV contains malformed quoted content.");
                }
                state = CsvState.QUOTED;
            } else {
                field.append(value);
                state = CsvState.PLAIN;
            }
        }
        if (state == CsvState.QUOTED) {
            throw invalidFile("The CSV contains malformed quoted content.");
        }
        if (!endedWithRecordSeparator) {
            record.add(field.toString());
            records.add(List.copyOf(record));
        }
        return List.copyOf(records);
    }

    private static String collapseWhitespace(String value) {
        StringBuilder result = new StringBuilder(value.length());
        boolean pendingSpace = false;
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            if (Character.isWhitespace(codePoint)
                    || Character.isSpaceChar(codePoint)) {
                pendingSpace = result.length() > 0;
            } else {
                if (pendingSpace) {
                    result.append(' ');
                    pendingSpace = false;
                }
                result.appendCodePoint(codePoint);
            }
            offset += Character.charCount(codePoint);
        }
        return result.toString();
    }

    private static String stripPolicyWhitespace(String value) {
        int start = 0;
        int end = value.length();
        while (start < end) {
            int codePoint = value.codePointAt(start);
            if (!Character.isWhitespace(codePoint)
                    && !Character.isSpaceChar(codePoint)) {
                break;
            }
            start += Character.charCount(codePoint);
        }
        while (end > start) {
            int codePoint = value.codePointBefore(end);
            if (!Character.isWhitespace(codePoint)
                    && !Character.isSpaceChar(codePoint)) {
                break;
            }
            end -= Character.charCount(codePoint);
        }
        return value.substring(start, end);
    }

    private static ValidationException invalidFile(String message) {
        return new ValidationException(message);
    }

    private enum CsvState {
        START,
        PLAIN,
        QUOTED,
        AFTER_QUOTE
    }
}
