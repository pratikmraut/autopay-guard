package in.autopayguard.api.common.error;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Map;

@Schema(
        name = "ApiProblem",
        description = "RFC 9457-style problem details returned as application/problem+json.")
public record ApiProblem(
        @Schema(
                        example = "https://autopayguard.local/problems/validation",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String type,
        @Schema(
                        example = "Request validation failed",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String title,
        @Schema(example = "400", requiredMode = Schema.RequiredMode.REQUIRED) int status,
        @Schema(
                        example = "One or more request fields are invalid.",
                        requiredMode = Schema.RequiredMode.REQUIRED)
                String detail,
        @Schema(nullable = true, example = "web-request-123") String correlationId,
        @Schema(nullable = true) Map<String, String> errors) {}
