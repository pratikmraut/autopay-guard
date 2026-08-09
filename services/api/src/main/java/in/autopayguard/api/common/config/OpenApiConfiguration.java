package in.autopayguard.api.common.config;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import io.swagger.v3.oas.models.media.ComposedSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import java.util.List;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@OpenAPIDefinition(
        info =
                @Info(
                        title = "AutoPay Guard API",
                        version = "v1",
                        description =
                                "Privacy-first API for identity, households, manual recurring "
                                        + "commitments, deterministic occurrence projections and "
                                        + "a fictional .example merchant catalog. "
                                        + "This API never accepts payment credentials or initiates payments."))
@SecurityScheme(
        name = "bearerAuth",
        type = SecuritySchemeType.HTTP,
        scheme = "bearer",
        bearerFormat = "JWT")
public class OpenApiConfiguration {

    @Bean
    OpenApiCustomizer nullableReferences() {
        return openApi -> {
            makeNullableReference(
                    openApi.getComponents()
                            .getSchemas()
                            .get("DecisionInboxItem"),
                    "currentDecision",
                    "#/components/schemas/OccurrenceDecision");
            makeNullableReference(
                    openApi.getComponents().getSchemas().get("GuideStep"),
                    "target",
                    "#/components/schemas/GuideTarget");
            makeNullableReference(
                    openApi.getComponents().getSchemas().get("PrivacyRequest"),
                    "export",
                    "#/components/schemas/PrivacyExportMetadata");
            makeNullableReference(
                    openApi.getComponents().getSchemas().get("ItemResponse"),
                    "preview",
                    "#/components/schemas/Preview");
            openApi.getComponents()
                    .getSchemas()
                    .put(
                            "CreateExportPrivacyRequest",
                            privacyRequestVariant("EXPORT", false));
            openApi.getComponents()
                    .getSchemas()
                    .put(
                            "CreateCorrectionPrivacyRequest",
                            privacyRequestVariant("CORRECTION", true));
            openApi.getComponents()
                    .getSchemas()
                    .put(
                            "CreateDeletionPrivacyRequest",
                            privacyRequestVariant("DELETION", false));
        };
    }

    private static Schema<Object> privacyRequestVariant(
            String requestType, boolean correction) {
        Schema<Object> schema = new Schema<>();
        schema.setName("Create" + requestType + "PrivacyRequest");
        schema.setType("object");
        schema.setAdditionalProperties(false);
        schema.addProperty(
                "requestType",
                new StringSchema()._enum(List.of(requestType)));
        if (correction) {
            schema.addProperty(
                    "correctionValue",
                    new StringSchema().minLength(1).maxLength(64));
            schema.setRequired(List.of("requestType", "correctionValue"));
        } else {
            schema.setRequired(List.of("requestType"));
        }
        return schema;
    }

    private static void makeNullableReference(
            Schema<?> parent, String propertyName, String reference) {
        if (parent == null || parent.getProperties() == null) {
            throw new IllegalStateException(
                    "OpenAPI schema is missing a required nullable reference property.");
        }
        Schema<Object> referenced = new Schema<>();
        referenced.set$ref(reference);
        ComposedSchema nullable = new ComposedSchema();
        nullable.setNullable(true);
        nullable.addAllOfItem(referenced);
        parent.getProperties().put(propertyName, nullable);
    }
}
