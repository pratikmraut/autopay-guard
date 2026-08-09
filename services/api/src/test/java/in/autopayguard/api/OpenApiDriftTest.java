package in.autopayguard.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OpenApiDriftTest {

    private static final Set<String> HTTP_METHODS =
            Set.of("get", "post", "put", "patch", "delete");

    @Autowired private MockMvc mockMvc;

    @Test
    void committedClientContractMatchesRuntimeV1OperationsAndSchemaFields() throws Exception {
        Path snapshotPath =
                Path.of(
                        System.getProperty("api.basedir"),
                        "openapi",
                        "openapi.json");
        String actual =
                mockMvc.perform(get("/v3/api-docs"))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        if (Boolean.getBoolean("api.updateOpenApi")) {
            Files.writeString(snapshotPath, actual + System.lineSeparator());
        }
        String expected = Files.readString(snapshotPath);

        Map<String, Map<String, Object>> expectedPaths = JsonPath.read(expected, "$.paths");
        Map<String, Map<String, Object>> actualPaths = JsonPath.read(actual, "$.paths");
        assertThat(actualPaths.keySet().stream().filter(path -> path.startsWith("/v1")).toList())
                .containsExactlyInAnyOrderElementsOf(expectedPaths.keySet());

        expectedPaths.forEach(
                (path, expectedPath) -> {
                    Map<String, Object> actualPath = actualPaths.get(path);
                    assertThat(actualPath).as("runtime path %s", path).isNotNull();
                    expectedPath.entrySet().stream()
                            .filter(entry -> HTTP_METHODS.contains(entry.getKey()))
                            .forEach(
                                    entry -> {
                                        String method = entry.getKey();
                                        @SuppressWarnings("unchecked")
                                        Map<String, Object> expectedOperation =
                                                (Map<String, Object>) entry.getValue();
                                        @SuppressWarnings("unchecked")
                                        Map<String, Object> actualOperation =
                                                (Map<String, Object>) actualPath.get(method);
                                        assertThat(actualOperation)
                                                .as("%s %s", method, path)
                                                .isNotNull();
                                        assertThat(operationContract(actualOperation))
                                                .as("contract for %s %s", method, path)
                                                .isEqualTo(
                                                        operationContract(expectedOperation));
                                    });
                    assertThat(
                                    actualPath.keySet().stream()
                                            .filter(HTTP_METHODS::contains)
                                            .collect(
                                                    java.util.stream.Collectors.toSet()))
                            .as("HTTP methods at %s", path)
                            .isEqualTo(
                                    expectedPath.keySet().stream()
                                            .filter(HTTP_METHODS::contains)
                                            .collect(
                                                    java.util.stream.Collectors.toSet()));
                });

        Map<String, Map<String, Object>> expectedSchemas =
                JsonPath.read(expected, "$.components.schemas");
        Map<String, Map<String, Object>> actualSchemas =
                JsonPath.read(actual, "$.components.schemas");
        expectedSchemas.forEach(
                (schemaName, expectedSchema) -> {
                    Map<String, Object> actualSchema = actualSchemas.get(schemaName);
                    assertThat(actualSchema).as("runtime schema %s", schemaName).isNotNull();
                    assertThat(schemaContract(actualSchema))
                            .as("runtime schema contract %s", schemaName)
                            .isEqualTo(schemaContract(expectedSchema));
                });
    }

    private static Map<String, Object> operationContract(Map<String, Object> operation) {
        Map<String, Object> contract = new TreeMap<>();
        contract.put("operationId", operation.get("operationId"));
        if (operation.containsKey("security")) {
            contract.put("security", operation.get("security"));
        }
        if (operation.containsKey("requestBody")) {
            contract.put("requestBody", contentContainerContract(operation.get("requestBody")));
        }
        Object parameters = operation.get("parameters");
        if (parameters instanceof List<?> parameterList) {
            contract.put(
                    "parameters",
                    parameterList.stream()
                            .map(OpenApiDriftTest::parameterContract)
                            .sorted(
                                    java.util.Comparator.comparing(
                                                    (Map<String, Object> parameter) ->
                                                            String.valueOf(
                                                                    parameter.get("in")))
                                            .thenComparing(
                                                    parameter ->
                                                            String.valueOf(
                                                                    parameter.get("name"))))
                            .toList());
        }
        Object responses = operation.get("responses");
        if (responses instanceof Map<?, ?> responseMap) {
            Map<String, Object> responseContracts = new TreeMap<>();
            responseMap.forEach(
                    (status, response) ->
                            responseContracts.put(
                                    String.valueOf(status),
                                    contentContainerContract(response)));
            contract.put("responses", responseContracts);
        }
        return contract;
    }

    private static Map<String, Object> contentContainerContract(Object rawContainer) {
        if (!(rawContainer instanceof Map<?, ?> container)) {
            return Map.of();
        }
        Map<String, Object> contract = new TreeMap<>();
        if (container.containsKey("required")) {
            contract.put("required", container.get("required"));
        }
        Object headers = container.get("headers");
        if (headers instanceof Map<?, ?> headerMap) {
            Map<String, Object> headerContracts = new TreeMap<>();
            headerMap.forEach(
                    (name, header) ->
                            headerContracts.put(
                                    String.valueOf(name),
                                    contentContainerContract(header)));
            contract.put("headers", headerContracts);
        }
        if (container.containsKey("schema")) {
            contract.put("schema", schemaContract(container.get("schema")));
        }
        Object content = container.get("content");
        if (content instanceof Map<?, ?> contentMap) {
            Map<String, Object> mediaContracts = new TreeMap<>();
            contentMap.forEach(
                    (mediaType, mediaValue) -> {
                        if (mediaValue instanceof Map<?, ?> mediaMap) {
                            mediaContracts.put(
                                    String.valueOf(mediaType),
                                    schemaContract(mediaMap.get("schema")));
                        }
                    });
            contract.put("content", mediaContracts);
        }
        return contract;
    }

    private static Map<String, Object> schemaContract(Object rawSchema) {
        if (!(rawSchema instanceof Map<?, ?> schema)) {
            return Map.of();
        }
        Map<String, Object> contract = new TreeMap<>();
        copyScalar(schema, contract, "$ref");
        copyScalar(schema, contract, "type");
        copyScalar(schema, contract, "format");
        copyScalar(schema, contract, "pattern");
        copyScalar(schema, contract, "minLength");
        copyScalar(schema, contract, "maxLength");
        copyScalar(schema, contract, "minimum");
        copyScalar(schema, contract, "maximum");
        copyScalar(schema, contract, "minItems");
        copyScalar(schema, contract, "maxItems");
        copyScalar(schema, contract, "enum");
        if (Boolean.TRUE.equals(schema.get("nullable"))) {
            contract.put("nullable", true);
        }
        Object required = schema.get("required");
        if (required instanceof List<?> requiredFields) {
            contract.put(
                    "required",
                    requiredFields.stream().map(String::valueOf).sorted().toList());
        }
        Object properties = schema.get("properties");
        if (properties instanceof Map<?, ?> propertyMap) {
            Map<String, Object> propertyContracts = new TreeMap<>();
            propertyMap.forEach(
                    (name, property) ->
                            propertyContracts.put(
                                    String.valueOf(name), schemaContract(property)));
            contract.put("properties", propertyContracts);
        }
        if (schema.containsKey("items")) {
            contract.put("items", schemaContract(schema.get("items")));
        }
        if (schema.containsKey("additionalProperties")) {
            Object additionalProperties = schema.get("additionalProperties");
            contract.put(
                    "additionalProperties",
                    additionalProperties instanceof Map<?, ?>
                            ? schemaContract(additionalProperties)
                            : additionalProperties);
        }
        return contract;
    }

    private static Map<String, Object> parameterContract(Object rawParameter) {
        if (!(rawParameter instanceof Map<?, ?> parameter)) {
            return Map.of();
        }
        Map<String, Object> contract = new TreeMap<>();
        copyScalar(parameter, contract, "name");
        copyScalar(parameter, contract, "in");
        copyScalar(parameter, contract, "required");
        copyScalar(parameter, contract, "example");
        if (parameter.containsKey("schema")) {
            contract.put("schema", schemaContract(parameter.get("schema")));
        }
        return contract;
    }

    private static void copyScalar(
            Map<?, ?> source, Map<String, Object> destination, String key) {
        if (source.containsKey(key)) {
            destination.put(key, source.get(key));
        }
    }
}
