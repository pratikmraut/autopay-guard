package in.autopayguard.api.importing;

import static org.assertj.core.api.Assertions.assertThat;

import in.autopayguard.api.common.security.OpaqueCodes;
import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ImportContentFingerprintTest {

    private static final CommitmentImportProperties PROPERTIES =
            new CommitmentImportProperties(
                    "0123456789abcdef0123456789abcdef"
                            + "0123456789abcdef0123456789abcdef");

    @Test
    void fingerprintIsStableLowercaseKeyedAndHouseholdBound() {
        ImportContentFingerprint fingerprints =
                new ImportContentFingerprint(PROPERTIES);
        UUID household =
                UUID.fromString("3d4b1989-1fa6-4c33-8901-9a62840ce7bb");
        byte[] content =
                "private import fixture".getBytes(StandardCharsets.UTF_8);

        String first = fingerprints.calculate(household, content);

        assertThat(first)
                .matches("[0-9a-f]{64}")
                .isEqualTo(fingerprints.calculate(household, content))
                .isNotEqualTo(OpaqueCodes.sha256("private import fixture"));
        assertThat(
                        fingerprints.calculate(
                                UUID.fromString(
                                        "8d26ce76-2e4f-47d4-8065-30b103540b55"),
                                content))
                .isNotEqualTo(first);
        assertThat(
                        fingerprints.calculate(
                                household,
                                "different import fixture"
                                        .getBytes(StandardCharsets.UTF_8)))
                .isNotEqualTo(first);
    }

    @Test
    void configurationRequiresExactlyThirtyTwoLowercaseHexBytes() {
        try (ValidatorFactory factory =
                Validation.buildDefaultValidatorFactory()) {
            assertThat(factory.getValidator().validate(PROPERTIES)).isEmpty();
            assertThat(
                            factory.getValidator()
                                    .validate(
                                            new CommitmentImportProperties(
                                                    "A".repeat(64))))
                    .isNotEmpty();
            assertThat(
                            factory.getValidator()
                                    .validate(
                                            new CommitmentImportProperties(
                                                    "a".repeat(63))))
                    .isNotEmpty();
            assertThat(
                            factory.getValidator()
                                    .validate(
                                            new CommitmentImportProperties(
                                                    null)))
                    .isNotEmpty();
        }
    }
}
