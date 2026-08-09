package in.autopayguard.api.privacy;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import io.swagger.v3.oas.annotations.media.DiscriminatorMapping;
import io.swagger.v3.oas.annotations.media.Schema;

@JsonTypeInfo(
        use = JsonTypeInfo.Id.NAME,
        include = JsonTypeInfo.As.EXISTING_PROPERTY,
        property = "requestType",
        visible = true)
@JsonSubTypes({
    @JsonSubTypes.Type(
            value = CreateExportPrivacyRequest.class,
            name = "EXPORT"),
    @JsonSubTypes.Type(
            value = CreateCorrectionPrivacyRequest.class,
            name = "CORRECTION"),
    @JsonSubTypes.Type(
            value = CreateDeletionPrivacyRequest.class,
            name = "DELETION")
})
@Schema(
        name = "CreatePrivacyRequest",
        description = "Exact discriminated privacy-request payload.",
        discriminatorProperty = "requestType",
        discriminatorMapping = {
            @DiscriminatorMapping(
                    value = "EXPORT",
                    schema = CreateExportPrivacyRequest.class),
            @DiscriminatorMapping(
                    value = "CORRECTION",
                    schema = CreateCorrectionPrivacyRequest.class),
            @DiscriminatorMapping(
                    value = "DELETION",
                    schema = CreateDeletionPrivacyRequest.class)
        },
        oneOf = {
            CreateExportPrivacyRequest.class,
            CreateCorrectionPrivacyRequest.class,
            CreateDeletionPrivacyRequest.class
        })
public sealed interface CreatePrivacyRequest
        permits CreateExportPrivacyRequest,
                CreateCorrectionPrivacyRequest,
                CreateDeletionPrivacyRequest {

    PrivacyRequestType requestType();

    default String correctionValue() {
        return null;
    }
}
