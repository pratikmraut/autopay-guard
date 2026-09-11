package in.autopayguard.api.identity;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/account/enrollment")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "identity")
public class AccountEnrollmentController {

    private final AccountEnrollmentService service;

    AccountEnrollmentController(AccountEnrollmentService service) {
        this.service = service;
    }

    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "enrollAccount",
            summary = "Explicitly enroll a verified OIDC identity",
            description =
                    "Requires the enrollment feature and exactly the USER client role. "
                            + "Repeating enrollment for the same bound identity is idempotent; "
                            + "no passwords or identity fields are accepted.")
    public CurrentUser enroll(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody AccountEnrollmentRequest request) {
        return service.enroll(jwt, request);
    }
}
