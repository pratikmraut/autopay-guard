package in.autopayguard.api.common.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("prod")
public class ProductionDatabaseRoleGuard {

    ProductionDatabaseRoleGuard(
            @Value("${spring.datasource.username}") String runtimeUsername,
            @Value("${spring.flyway.user}") String migrationUsername) {
        validate(runtimeUsername, migrationUsername);
    }

    static void validate(String runtimeUsername, String migrationUsername) {
        if (runtimeUsername == null
                || runtimeUsername.isBlank()
                || migrationUsername == null
                || migrationUsername.isBlank()) {
            throw new IllegalStateException(
                    "Production database runtime and migration roles are required.");
        }
        if (runtimeUsername.strip().equals(migrationUsername.strip())) {
            throw new IllegalStateException(
                    "Production Flyway and runtime database roles must be distinct.");
        }
    }
}
