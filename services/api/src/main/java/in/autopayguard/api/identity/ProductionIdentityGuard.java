package in.autopayguard.api.identity;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
@Profile("prod")
public class ProductionIdentityGuard {

    ProductionIdentityGuard(
            IdentityProperties identityProperties, Environment environment) {
        validate(
                identityProperties.autoProvision(),
                identityProperties.requireVerifiedEmail(),
                environment.getActiveProfiles());
    }

    public static void validate(
            boolean autoProvision,
            boolean requireVerifiedEmail,
            String... activeProfiles) {
        if (autoProvision) {
            throw new IllegalStateException(
                    "Production identity auto-provisioning must remain disabled.");
        }
        if (!requireVerifiedEmail) {
            throw new IllegalStateException(
                    "Production identities must require a verified email claim.");
        }
        Set<String> normalizedProfiles =
                Arrays.stream(activeProfiles)
                        .map(String::strip)
                        .map(profile -> profile.toLowerCase(Locale.ROOT))
                        .collect(Collectors.toSet());
        if (!normalizedProfiles.equals(Set.of("prod"))) {
            throw new IllegalStateException(
                    "Production must run with only the explicit prod profile.");
        }
    }
}
