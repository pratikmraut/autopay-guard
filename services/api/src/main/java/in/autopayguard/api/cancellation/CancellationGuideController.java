package in.autopayguard.api.cancellation;

import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "cancellation")
class CancellationGuideController {

    private final CancellationGuideService service;

    CancellationGuideController(CancellationGuideService service) {
        this.service = service;
    }

    @GetMapping(
            value = "/commitments/{commitmentId}/cancellation-guide",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getCancellationGuide",
            summary = "Get the current structurally reviewed cancellation guide",
            responses = {
                @ApiResponse(responseCode = "200", description = "Current guide"),
                @ApiResponse(
                        responseCode = "404",
                        description = "Commitment or guide not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    CancellationGuideResponse get(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID commitmentId) {
        return service.get(jwt, commitmentId);
    }
}
