package in.autopayguard.api.identity;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(
        properties = {
            "spring.datasource.url=jdbc:h2:mem:autopay_guard_dev_profile;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
            "spring.datasource.username=sa",
            "spring.datasource.password=",
            "spring.datasource.driver-class-name=org.h2.Driver",
            "app.security.issuer-uri=https://issuer.test.example/realms/autopay-guard",
            "app.security.jwk-set-uri=https://issuer.test.example/unused-jwks",
            "app.security.audience=autopay-guard-api",
            "app.imports.fingerprint-key=0000000000000000000000000000000000000000000000000000000000000000"
        })
@ActiveProfiles("dev")
class DevelopmentIdentityProfileTest {

    @Autowired private IdentityProperties identityProperties;

    @Test
    void developmentProfileExplicitlyEnablesFakeUserProvisioning() {
        assertThat(identityProperties.autoProvision()).isTrue();
    }
}
