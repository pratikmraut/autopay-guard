package in.autopayguard.api.notification;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("app.notifications")
public record NotificationProperties(
        @NotBlank String generatorCron,
        @NotBlank String workerCron,
        @NotBlank String reconciliationCron,
        @Min(1) @Max(100) int batchSize,
        @NotNull Duration leaseDuration,
        @NotNull Duration catchUpWindow,
        @NotNull @Valid Email email) {

    public NotificationProperties {
        if (leaseDuration != null
                && (leaseDuration.compareTo(Duration.ofMinutes(1)) < 0
                        || leaseDuration.compareTo(Duration.ofMinutes(15)) > 0)) {
            throw new IllegalArgumentException(
                    "Notification lease duration must be at least one minute and at most 15 minutes.");
        }
        if (catchUpWindow != null
                && (catchUpWindow.isZero()
                        || catchUpWindow.isNegative()
                        || catchUpWindow.compareTo(Duration.ofHours(2)) > 0)) {
            throw new IllegalArgumentException(
                    "Notification catch-up window must be greater than zero and at most two hours.");
        }
    }

    public record Email(
            @NotNull NotificationEmailMode mode,
            @NotBlank String fromAddress,
            @NotEmpty List<@NotBlank String> allowedRecipientSuffixes) {}
}
