package in.autopayguard.api.importing;

import static in.autopayguard.api.importing.CommitmentImportModels.ErrorCode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.merchant.MerchantService;
import in.autopayguard.api.merchant.MerchantReference;
import jakarta.validation.ValidationException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mockito;

class CommitmentCsvParserTest {

    private static final String HEADER =
            "name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label";

    private CommitmentCsvParser parser;
    private MerchantService merchantService;

    @BeforeEach
    void setUp() {
        merchantService = Mockito.mock(MerchantService.class);
        when(merchantService.findOneExactCompatible(any(), any()))
                .thenReturn(Optional.empty());
        parser = new CommitmentCsvParser(merchantService);
    }

    @Test
    void parsesBomQuotedCommaAndDoubledQuoteDeterministically() {
        byte[] body =
                ("\ufeff"
                                + HEADER
                                + "\r\n\"Video, \"\"Plus\"\"\",SUBSCRIPTION,275.5,INR,MONTHLY,2026-07-31,CARD_RECURRING,Card ending 42\r\n")
                        .getBytes(StandardCharsets.UTF_8);

        var row = parser.parse(body).rows().getFirst();

        assertThat(row.valid()).isTrue();
        assertThat(row.name()).isEqualTo("Video, \"Plus\"");
        assertThat(row.amountMinor()).isEqualTo(27_550L);
        assertThat(row.monthDayPolicy().name()).isEqualTo("LAST_DAY");
        assertThat(row.errors()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "=SUM(A1:A2)",
                "+10",
                "-10",
                "@hidden",
                "＝SUM(A1:A2)",
                "＋10",
                "－10",
                "＠hidden"
            })
    void rejectsLiteralAndNfkcFormulaPrefixes(String value) {
        byte[] body =
                (HEADER
                                + "\n"
                                + value
                                + ",SUBSCRIPTION,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n")
                        .getBytes(StandardCharsets.UTF_8);

        assertThatThrownBy(() -> parser.parse(body))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Formula-like");
    }

    @Test
    void retainsOnlyAllowlistedErrorsForInvalidRows() {
        byte[] body =
                (HEADER
                                + "\npassword account number,SUBSCRIPTION,1e3,inr,CUSTOM,2026-7-1,bad,4111111111111111\n")
                        .getBytes(StandardCharsets.UTF_8);

        var row = parser.parse(body).rows().getFirst();

        assertThat(row.valid()).isFalse();
        assertThat(row.name()).isNull();
        assertThat(row.amountMinor()).isNull();
        assertThat(row.maskedPaymentLabel()).isNull();
        assertThat(row.errors())
                .contains(
                        ErrorCode.NAME_SENSITIVE,
                        ErrorCode.AMOUNT_INVALID,
                        ErrorCode.CURRENCY_INVALID,
                        ErrorCode.FREQUENCY_INVALID,
                        ErrorCode.NEXT_DUE_DATE_INVALID,
                        ErrorCode.PAYMENT_RAIL_INVALID,
                        ErrorCode.MASKED_LABEL_SENSITIVE);
    }

    @Test
    void rejectsInvalidUtf8EmbeddedNewlineAndDuplicateHeader() {
        assertThatThrownBy(() -> parser.parse(new byte[] {(byte) 0xc3, 0x28}))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("UTF-8");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\n\"line\nbreak\",SUBSCRIPTION,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n")
                                                .getBytes(
                                                        StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Embedded");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER + "\n" + HEADER + "\n")
                                                .getBytes(
                                                        StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("exactly once");
    }

    @Test
    void rejectsEmptyHeaderOnlyOversizeAndMoreThanOneHundredRows() {
        assertThatThrownBy(() -> parser.parse(new byte[0]))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("1 byte");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER + "\n")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("1 through 100");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        new byte[
                                                CommitmentCsvParser.MAXIMUM_RAW_BYTES
                                                        + 1]))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("256 KiB");

        StringBuilder body = new StringBuilder(HEADER).append('\n');
        for (int index = 0; index < 101; index++) {
            body.append(
                    "Safe"
                            + index
                            + ",OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n");
        }
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        body.toString()
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("1 through 100");
    }

    @Test
    void requiresTheExactOrderedHeaderAndEightFieldsPerRow() {
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        ("Name,"
                                                        + HEADER.substring("name,".length())
                                                        + "\nSafe,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("header");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\nSafe,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN\n")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("eight fields");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\nSafe,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,,extra\n")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("eight fields");
    }

    @ParameterizedTest
    @ValueSource(strings = {"\u0000", "\u0001", "\u0007"})
    void rejectsNulAndControlContent(String control) {
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\nSafe"
                                                        + control
                                                        + ",OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("control");
    }

    @Test
    void rejectsAdditionalBomAndRawFieldsBeforeNormalization() {
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\nSafe,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\ufeff\n")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("byte-order mark");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\n"
                                                        + "x".repeat(513)
                                                        + ",OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("field exceeds");
    }

    @Test
    void rejectsMalformedQuotingBareCarriageReturnAndTrailingGarbage() {
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\n\"unterminated,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("malformed quoted");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\n\"Safe\"trailing,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("malformed quoted");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\rSafe,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\r")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("record separator");
        assertThatThrownBy(
                        () ->
                                parser.parse(
                                        (HEADER
                                                        + "\nSafe,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\ntrailing")
                                                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("eight fields");
    }

    @ParameterizedTest
    @CsvSource({"0.01,1", "1.2,120", "9999999999.99,999999999999"})
    void parsesPlainAmountsExactlyAtSupportedBoundaries(
            String amount, long expectedMinor) {
        var row = parseRowWithAmount(amount);

        assertThat(row.valid()).isTrue();
        assertThat(row.amountMinor()).isEqualTo(expectedMinor);
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "0",
                "0.001",
                "1.234",
                "1e3",
                "1,000",
                "NaN",
                "Infinity",
                "10000000000.00"
            })
    void rejectsAmountsThatNeedGroupingExponentOrRounding(String amount) {
        var row = parseRowWithAmount(amount);

        assertThat(row.valid()).isFalse();
        assertThat(row.errors()).contains(ErrorCode.AMOUNT_INVALID);
    }

    @Test
    void rejectsUnsupportedCurrencyEnumsAndDatesAsAllowlistedRowErrors() {
        var row =
                parseRow(
                        "Safe",
                        "NOT_A_CATEGORY",
                        "10",
                        "usd",
                        "CUSTOM",
                        "2026-7-1",
                        "NOT_A_RAIL",
                        "");

        assertThat(row.valid()).isFalse();
        assertThat(row.errors())
                .containsExactly(
                        ErrorCode.CATEGORY_INVALID,
                        ErrorCode.CURRENCY_INVALID,
                        ErrorCode.FREQUENCY_INVALID,
                        ErrorCode.NEXT_DUE_DATE_INVALID,
                        ErrorCode.PAYMENT_RAIL_INVALID);
        assertThat(
                        parseRow(
                                        "Safe",
                                        "OTHER",
                                        "10",
                                        "INR",
                                        "MONTHLY",
                                        "2201-01-01",
                                        "UNKNOWN",
                                        "")
                                .errors())
                .containsExactly(ErrorCode.NEXT_DUE_DATE_INVALID);
    }

    @Test
    void asksForOneExactCategoryCompatibleMerchantUsingNormalizedName() {
        UUID merchantId = UUID.randomUUID();
        when(merchantService.findOneExactCompatible(
                        "Cloud Nest", CommitmentCategory.SOFTWARE))
                .thenReturn(
                        Optional.of(
                                new MerchantReference(
                                        merchantId,
                                        "Cloud Nest",
                                        CommitmentCategory.SOFTWARE)));

        var row =
                parseRow(
                        "\uff23\uff4c\uff4f\uff55\uff44\u3000\uff2e\uff45\uff53\uff54",
                        "SOFTWARE",
                        "10",
                        "INR",
                        "MONTHLY",
                        "2026-08-01",
                        "UNKNOWN",
                        "");

        assertThat(row.valid()).isTrue();
        assertThat(row.name()).isEqualTo("Cloud Nest");
        assertThat(row.merchantId()).isEqualTo(merchantId);
        verify(merchantService)
                .findOneExactCompatible(
                        "Cloud Nest", CommitmentCategory.SOFTWARE);
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "https://evil.example/canary",
                "www.evil.example",
                "evil.example",
                "evil.xyz",
                "example.tech/path",
                "192.0.2.10",
                "localhost",
                "\uff48\uff54\uff54\uff50\uff53://evil.example"
            })
    void rejectsUrlLikeTextWithoutRetainingIt(String url) {
        var row =
                parseRow(
                        url,
                        "OTHER",
                        "10",
                        "INR",
                        "MONTHLY",
                        "2026-08-01",
                        "UNKNOWN",
                        url);

        assertThat(row.valid()).isFalse();
        assertThat(row.name()).isNull();
        assertThat(row.maskedPaymentLabel()).isNull();
        assertThat(row.errors())
                .contains(
                        ErrorCode.NAME_SENSITIVE,
                        ErrorCode.MASKED_LABEL_SENSITIVE);
        assertThat(row.toString()).doesNotContain("evil", "canary");
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "123456",
                "Reference 123456",
                "OTP 123456",
                "verification code: 123456"
            })
    void rejectsBareAndOtpLikeSixDigitSecrets(String secret) {
        var row =
                parseRow(
                        secret,
                        "OTHER",
                        "10",
                        "INR",
                        "MONTHLY",
                        "2026-08-01",
                        "UNKNOWN",
                        secret);

        assertThat(row.valid()).isFalse();
        assertThat(row.errors())
                .contains(
                        ErrorCode.NAME_SENSITIVE,
                        ErrorCode.MASKED_LABEL_SENSITIVE);
    }

    @Test
    void preservesLegitimateMaskedLastFourLabels() {
        var row =
                parseRow(
                        "Safe",
                        "OTHER",
                        "10",
                        "INR",
                        "MONTHLY",
                        "2026-08-01",
                        "UNKNOWN",
                        "Card ending 4242");

        assertThat(row.valid()).isTrue();
        assertThat(row.maskedPaymentLabel()).isEqualTo("Card ending 4242");
    }

    private CommitmentImportModels.ParsedRow parseRowWithAmount(String amount) {
        return parseRow(
                "Safe",
                "OTHER",
                amount,
                "INR",
                "MONTHLY",
                "2026-08-01",
                "UNKNOWN",
                "");
    }

    private CommitmentImportModels.ParsedRow parseRow(String... fields) {
        String record =
                Arrays.stream(fields)
                        .map(CommitmentCsvParserTest::quote)
                        .collect(java.util.stream.Collectors.joining(","));
        return parser.parse(
                        (HEADER + "\n" + record + "\n")
                                .getBytes(StandardCharsets.UTF_8))
                .rows()
                .getFirst();
    }

    private static String quote(String value) {
        if (value.indexOf(',') >= 0 || value.indexOf('"') >= 0) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
