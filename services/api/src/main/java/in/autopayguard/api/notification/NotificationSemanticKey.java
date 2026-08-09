package in.autopayguard.api.notification;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.UUID;

final class NotificationSemanticKey {

    private NotificationSemanticKey() {}

    static String create(
            UUID recipientUserId,
            UUID householdId,
            UUID commitmentId,
            LocalDate scheduledDate,
            NotificationChannel channel,
            int offsetDays) {
        if (offsetDays < 0 || offsetDays > 90) {
            throw new IllegalArgumentException("Reminder offset must be between 0 and 90 days.");
        }
        String canonical =
                String.join(
                        "\u001f",
                        recipientUserId.toString(),
                        householdId.toString(),
                        commitmentId.toString(),
                        scheduledDate.toString(),
                        channel.name(),
                        Integer.toString(offsetDays));
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable.", exception);
        }
    }

    static String messageId(String semanticKey) {
        if (semanticKey == null || !semanticKey.matches("^[0-9a-f]{64}$")) {
            throw new IllegalArgumentException("Notification semantic key is invalid.");
        }
        return "<apg-" + semanticKey + "@autopayguard.local>";
    }
}
