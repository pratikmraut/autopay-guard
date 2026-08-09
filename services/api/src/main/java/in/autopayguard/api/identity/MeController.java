package in.autopayguard.api.identity;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import in.autopayguard.api.common.error.ApiProblem;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/me")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "identity")
public class MeController {

    private final CurrentUserService currentUserService;

    MeController(CurrentUserService currentUserService) {
        this.currentUserService = currentUserService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getCurrentUser",
            summary = "Get the current local user",
            description =
                    "Maps the authenticated token subject to a local user. "
                            + "The email and display name come only from validated OIDC claims.",
            responses = {
                @ApiResponse(responseCode = "200", description = "Current local user"),
                @ApiResponse(
                        responseCode = "401",
                        description = "Missing or invalid bearer token",
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "422",
                        description = "Required identity claims are missing or invalid",
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class)))
            })
    public CurrentUser me(@AuthenticationPrincipal Jwt jwt) {
        return currentUserService.resolve(jwt);
    }
}
