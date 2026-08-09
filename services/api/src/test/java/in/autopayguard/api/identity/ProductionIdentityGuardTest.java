package in.autopayguard.api.identity;

import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ProductionIdentityGuardTest {

    @Test
    void acceptsClosedProductionProvisioning() {
        assertThatNoException()
                .isThrownBy(() -> ProductionIdentityGuard.validate(false, true, "prod"));
    }

    @Test
    void rejectsDevelopmentAutoProvisioningInProduction() {
        assertThatThrownBy(() -> ProductionIdentityGuard.validate(true, true, "prod"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("auto-provisioning must remain disabled");
    }

    @Test
    void rejectsDisablingVerifiedEmailEnforcementInProduction() {
        assertThatThrownBy(() -> ProductionIdentityGuard.validate(false, false, "prod"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must require a verified email claim");
    }

    @Test
    void rejectsEveryUnapprovedProfileOverlay() {
        for (String[] activeProfiles :
                new String[][] {
                    {},
                    {"dev", "prod"},
                    {"prod", "test-support"},
                    {"production"}
                }) {
            assertThatThrownBy(
                            () ->
                                    ProductionIdentityGuard.validate(
                                            false, true, activeProfiles))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("only the explicit prod profile");
        }
    }
}
