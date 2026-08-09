package in.autopayguard.api.importing;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
final class ImportContentFingerprint {

    private static final byte[] DOMAIN =
            "autopay-guard.import-content-fingerprint.v1\u0000"
                    .getBytes(StandardCharsets.UTF_8);
    private final SecretKeySpec key;

    ImportContentFingerprint(CommitmentImportProperties properties) {
        this.key =
                new SecretKeySpec(
                        HexFormat.of().parseHex(properties.fingerprintKey()),
                        "HmacSHA256");
    }

    String calculate(UUID householdId, byte[] content) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            mac.update(DOMAIN);
            mac.update(uuidBytes(householdId));
            return HexFormat.of().formatHex(mac.doFinal(content));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException(
                    "HMAC-SHA-256 is unavailable.", exception);
        }
    }

    private static byte[] uuidBytes(UUID value) {
        return ByteBuffer.allocate(16)
                .putLong(value.getMostSignificantBits())
                .putLong(value.getLeastSignificantBits())
                .array();
    }
}
