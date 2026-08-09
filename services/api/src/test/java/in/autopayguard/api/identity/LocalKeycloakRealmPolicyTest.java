package in.autopayguard.api.identity;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class LocalKeycloakRealmPolicyTest {

    private static final String API_CLIENT_ID = "autopay-guard-api";
    private static final Map<String, List<String>> EXPECTED_IDENTITY_ROLES =
            Map.of(
                    "demo@autopayguard.local", List.of("USER"),
                    "member@autopayguard.local", List.of("USER"),
                    "foreign@autopayguard.local", List.of("USER"),
                    "deletion@autopayguard.local", List.of("USER"),
                    "admin@autopayguard.local", List.of("GUIDE_ADMIN"),
                    "privacy-admin@autopayguard.local", List.of("PRIVACY_ADMIN"),
                    "audit-reader@autopayguard.local", List.of("AUDIT_READ"),
                    "support@autopayguard.local", List.of("SUPPORT_READ"));

    private final JsonNode realm = readRealmFixture();

    @Test
    void localRealmRejectsPublicRegistrationAndUnsafeGrantFlows() {
        assertThat(realm.path("realm").asString()).isEqualTo("autopay-guard");
        assertThat(realm.path("enabled").asBoolean()).isTrue();
        assertThat(realm.path("registrationAllowed").asBoolean()).isFalse();
        assertThat(realm.path("rememberMe").asBoolean()).isFalse();
        assertThat(realm.path("resetPasswordAllowed").asBoolean()).isFalse();
        assertThat(realm.path("duplicateEmailsAllowed").asBoolean()).isFalse();
        assertThat(realm.path("editUsernameAllowed").asBoolean()).isFalse();
        assertThat(realm.path("bruteForceProtected").asBoolean()).isTrue();
        assertThat(realm.path("identityProviders").isArray()).isTrue();
        assertThat(realm.path("identityProviders").size()).isZero();

        JsonNode apiClient = client("autopay-guard-api");
        assertThat(apiClient.path("enabled").asBoolean()).isTrue();
        assertThat(apiClient.path("bearerOnly").asBoolean()).isTrue();
        assertThat(apiClient.path("publicClient").asBoolean()).isFalse();
        assertThat(apiClient.path("standardFlowEnabled").asBoolean()).isFalse();
        assertThat(apiClient.path("implicitFlowEnabled").asBoolean()).isFalse();
        assertThat(apiClient.path("directAccessGrantsEnabled").asBoolean())
                .isFalse();
        assertThat(apiClient.path("serviceAccountsEnabled").asBoolean()).isFalse();

        JsonNode webClient = client("autopay-guard-web");
        assertThat(webClient.path("enabled").asBoolean()).isTrue();
        assertThat(webClient.path("clientAuthenticatorType").asString())
                .isEqualTo("client-secret");
        assertThat(webClient.path("publicClient").asBoolean()).isFalse();
        assertThat(webClient.path("standardFlowEnabled").asBoolean()).isTrue();
        assertThat(webClient.path("implicitFlowEnabled").asBoolean()).isFalse();
        assertThat(webClient.path("directAccessGrantsEnabled").asBoolean())
                .isFalse();
        assertThat(webClient.path("serviceAccountsEnabled").asBoolean()).isFalse();
        assertThat(webClient.path("frontchannelLogout").asBoolean()).isTrue();
        assertThat(webClient.path("rootUrl").asString())
                .isEqualTo("http://localhost:3000");
        assertThat(webClient.path("baseUrl").asString())
                .isEqualTo("http://localhost:3000");
        assertThat(webClient.path("adminUrl").asString())
                .isEqualTo("http://localhost:3000");
        assertThat(textValues(webClient.path("redirectUris")))
                .containsExactly("http://localhost:3000/api/auth/callback/keycloak");
        assertThat(textValues(webClient.path("webOrigins")))
                .containsExactly("http://localhost:3000");
        assertThat(webClient.path("attributes").path("pkce.code.challenge.method").asString())
                .isEqualTo("S256");
        assertThat(webClient.path("attributes").path("post.logout.redirect.uris").asString())
                .isEqualTo("http://localhost:3000/*");

        JsonNode protocolMappers = webClient.path("protocolMappers");
        assertThat(protocolMappers.isArray()).isTrue();
        assertThat(protocolMappers.size()).isOne();
        JsonNode audienceMapper = protocolMappers.get(0);
        assertThat(audienceMapper.path("name").asString())
                .isEqualTo("autopay-guard-api-audience");
        assertThat(audienceMapper.path("protocol").asString())
                .isEqualTo("openid-connect");
        assertThat(audienceMapper.path("protocolMapper").asString())
                .isEqualTo("oidc-audience-mapper");
        assertThat(audienceMapper.path("consentRequired").asBoolean()).isFalse();
        JsonNode audienceConfig = audienceMapper.path("config");
        assertThat(audienceConfig.path("included.client.audience").asString())
                .isEqualTo(API_CLIENT_ID);
        assertThat(audienceConfig.path("id.token.claim").asString()).isEqualTo("false");
        assertThat(audienceConfig.path("access.token.claim").asString()).isEqualTo("true");
        assertThat(audienceConfig.path("introspection.token.claim").asString())
                .isEqualTo("true");
    }

    @Test
    void localFixtureContainsOnlyTheFiveExactApplicationRoles() {
        List<String> roles = new ArrayList<>();
        realm.path("roles")
                .path("client")
                .path(API_CLIENT_ID)
                .forEach(role -> roles.add(role.path("name").asString()));

        assertThat(roles)
                .containsExactlyInAnyOrder(
                        "USER",
                        "GUIDE_ADMIN",
                        "PRIVACY_ADMIN",
                        "AUDIT_READ",
                        "SUPPORT_READ");
    }

    @Test
    void everySeededIdentityHasOnlyItsExactLeastPrivilegeRole() {
        assertThat(realm.path("users").size())
                .isEqualTo(EXPECTED_IDENTITY_ROLES.size());

        for (JsonNode user : realm.path("users")) {
            String username = user.path("username").asString();
            assertThat(EXPECTED_IDENTITY_ROLES).containsKey(username);
            assertThat(user.path("id").asString()).isNotBlank();
            assertThat(user.path("email").asString()).isEqualTo(username);
            assertThat(user.path("enabled").asBoolean()).isTrue();
            assertThat(user.path("emailVerified").asBoolean()).isTrue();

            List<String> actualRoles = new ArrayList<>();
            user.path("clientRoles")
                    .path(API_CLIENT_ID)
                    .forEach(role -> actualRoles.add(role.asString()));
            assertThat(actualRoles)
                    .containsExactlyElementsOf(EXPECTED_IDENTITY_ROLES.get(username));
        }
    }

    private JsonNode client(String clientId) {
        List<JsonNode> matches = new ArrayList<>();
        realm.path("clients").forEach(
                client -> {
                    if (clientId.equals(client.path("clientId").asString())) {
                        matches.add(client);
                    }
                });
        assertThat(matches).hasSize(1);
        return matches.getFirst();
    }

    private static List<String> textValues(JsonNode values) {
        assertThat(values.isArray()).isTrue();
        List<String> result = new ArrayList<>();
        values.forEach(value -> result.add(value.asString()));
        return result;
    }

    private static JsonNode readRealmFixture() {
        String apiBaseDirectory = System.getProperty("api.basedir");
        assertThat(apiBaseDirectory)
                .as("Maven must expose the API module path as api.basedir")
                .isNotBlank();
        Path repositoryRoot =
                Path.of(apiBaseDirectory)
                        .toAbsolutePath()
                        .normalize()
                        .resolve("../..")
                        .normalize();
        Path realmFixture =
                repositoryRoot.resolve("infra/local/keycloak/autopay-guard-realm.json");
        assertThat(repositoryRoot.resolve("AGENTS.md")).isRegularFile();
        assertThat(realmFixture).isRegularFile();
        try {
            return new ObjectMapper().readTree(Files.readString(realmFixture));
        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Could not read the local Keycloak realm fixture.", exception);
        }
    }
}
