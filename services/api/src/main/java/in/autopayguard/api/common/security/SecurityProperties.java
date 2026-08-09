package in.autopayguard.api.common.security;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app.security")
public record SecurityProperties(
        @NotBlank String issuerUri,
        String jwkSetUri,
        @NotBlank String audience,
        @NotBlank String authorizedParty) {}
