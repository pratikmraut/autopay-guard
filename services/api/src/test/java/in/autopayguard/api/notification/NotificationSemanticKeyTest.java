package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class NotificationSemanticKeyTest {

    @Test
    void keyDependsOnlyOnTheFrozenSemanticTuple() {
        UUID recipient = UUID.fromString("10000000-0000-4000-8000-000000000001");
        UUID household = UUID.fromString("20000000-0000-4000-8000-000000000001");
        UUID commitment = UUID.fromString("30000000-0000-4000-8000-000000000001");

        String first =
                NotificationSemanticKey.create(
                        recipient,
                        household,
                        commitment,
                        LocalDate.of(2026, 8, 10),
                        NotificationChannel.EMAIL,
                        3);
        String repeated =
                NotificationSemanticKey.create(
                        recipient,
                        household,
                        commitment,
                        LocalDate.of(2026, 8, 10),
                        NotificationChannel.EMAIL,
                        3);
        String otherOffset =
                NotificationSemanticKey.create(
                        recipient,
                        household,
                        commitment,
                        LocalDate.of(2026, 8, 10),
                        NotificationChannel.EMAIL,
                        1);

        assertThat(first).hasSize(64).isEqualTo(repeated).isNotEqualTo(otherOffset);
        assertThat(NotificationSemanticKey.messageId(first))
                .isEqualTo("<apg-" + first + "@autopayguard.local>");
    }
}
