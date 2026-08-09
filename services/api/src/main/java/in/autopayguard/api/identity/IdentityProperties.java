package in.autopayguard.api.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.identity")
public record IdentityProperties(boolean autoProvision, boolean requireVerifiedEmail) {}
