package in.autopayguard.api.common.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app.privacy")
public record PrivacyProperties(@NotBlank String noticeVersion) {}
