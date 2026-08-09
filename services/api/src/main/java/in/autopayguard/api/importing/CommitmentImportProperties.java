package in.autopayguard.api.importing;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app.imports")
record CommitmentImportProperties(
        @NotBlank @Pattern(regexp = "^[0-9a-f]{64}$")
                String fingerprintKey) {}
