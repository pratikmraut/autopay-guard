package in.autopayguard.api.privacy;

import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/privacy")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "privacy notices")
@Validated
public class PrivacyNoticeController {

    private final PrivacyNoticeService noticeService;

    PrivacyNoticeController(PrivacyNoticeService noticeService) {
        this.noticeService = noticeService;
    }

    @GetMapping(value = "/notices/current", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "getCurrentPrivacyNotice",
            summary = "Get the current local privacy-notice fingerprint",
            responses = @ApiResponse(responseCode = "200", description = "Current notice"))
    PrivacyNoticeResponse current() {
        return noticeService.current();
    }

    @GetMapping(
            value = "/notice-acknowledgements",
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "listPrivacyNoticeAcknowledgements",
            summary = "List the current user's append-only acknowledgements",
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Acknowledgement collection"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid cursor or page limit",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Cursor not found for the current user",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    PrivacyNoticeAcknowledgementCollectionResponse list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit) {
        return noticeService.list(jwt, cursor, limit);
    }

    @PostMapping(
            value = "/notice-acknowledgements",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "acknowledgePrivacyNotice",
            summary = "Append an idempotent notice acknowledgement",
            responses = {
                @ApiResponse(responseCode = "201", description = "Acknowledgement recorded"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid request or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Notice version or replay conflicts",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<PrivacyNoticeAcknowledgementResponse> acknowledge(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(
                            required = true,
                            schema =
                                    @Schema(
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[\\x21-\\x7E]{16,100}$"))
                    @RequestHeader(value = "Idempotency-Key", required = false)
                    String idempotencyKey,
            @Valid @RequestBody AcknowledgePrivacyNoticeRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(noticeService.acknowledge(jwt, idempotencyKey, request));
    }
}
