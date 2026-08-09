package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.validation.ValidationException;
import java.time.ZoneId;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class NotificationPreferenceTimezoneValidationTest {

    @ParameterizedTest
    @ValueSource(strings = {"Asia/Kolkata", "America/New_York", "Europe/London"})
    void acceptsProviderBackedIanaZoneIds(String timezone) {
        assertThat(ZoneId.getAvailableZoneIds()).contains(timezone);
        assertThat(NotificationPreferenceService.validatedTimezone(timezone))
                .isEqualTo(timezone);
    }

    @ParameterizedTest
    @ValueSource(strings = {"+05:30", "GMT+05:30", "Invalid/Nowhere"})
    void rejectsFixedOffsetsAndUnknownZoneIds(String timezone) {
        assertThat(ZoneId.getAvailableZoneIds()).doesNotContain(timezone);
        assertThatThrownBy(() -> NotificationPreferenceService.validatedTimezone(timezone))
                .isInstanceOf(ValidationException.class)
                .hasMessage("timezone must be a valid IANA timezone.");
    }
}
