package in.autopayguard.api.common.config;

import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ProductionDatabaseRoleGuardTest {

    @Test
    void acceptsDistinctMigrationAndRuntimeRoles() {
        assertThatNoException()
                .isThrownBy(
                        () ->
                                ProductionDatabaseRoleGuard.validate(
                                        "autopay_guard_runtime",
                                        "autopay_guard_migrator"));
    }

    @Test
    void rejectsMissingOrReusedProductionRoles() {
        assertThatThrownBy(
                        () ->
                                ProductionDatabaseRoleGuard.validate(
                                        "autopay_guard", "autopay_guard"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be distinct");
        assertThatThrownBy(
                        () ->
                                ProductionDatabaseRoleGuard.validate(
                                        "autopay_guard", " "))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("are required");
        assertThatThrownBy(
                        () ->
                                ProductionDatabaseRoleGuard.validate(
                                        " runtime_role ", "runtime_role"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be distinct");
        assertThatThrownBy(
                        () -> ProductionDatabaseRoleGuard.validate(null, "migrator"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("are required");
        assertThatThrownBy(
                        () -> ProductionDatabaseRoleGuard.validate("runtime", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("are required");
    }
}
