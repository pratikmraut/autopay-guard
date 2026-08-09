package in.autopayguard.api.commitment;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@Schema(
        name = "UpdateCommitmentSharingRequest",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
        requiredProperties = {"visibility", "responsibleMemberId"})
public record UpdateCommitmentSharingRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
                CommitmentVisibility visibility,
        @JsonProperty(required = true)
                @Schema(nullable = true, requiredMode = Schema.RequiredMode.REQUIRED)
                UUID responsibleMemberId) {}
