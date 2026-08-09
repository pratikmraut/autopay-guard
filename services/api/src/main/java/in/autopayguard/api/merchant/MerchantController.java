package in.autopayguard.api.merchant;

import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.common.error.ApiProblem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/merchants")
@SecurityRequirement(name = "bearerAuth")
@Tag(name = "merchants")
@Validated
public class MerchantController {

    private final MerchantService merchantService;

    MerchantController(MerchantService merchantService) {
        this.merchantService = merchantService;
    }

    @GetMapping(value = "/search", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "searchMerchants",
            summary = "Search the fictional merchant catalog",
            description =
                    "Searches only bundled demonstration merchants and aliases. "
                            + "Every website host is reserved under .example.",
            responses = {
                @ApiResponse(responseCode = "200", description = "Matching fake merchants"),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid query",
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "401",
                        description = "Missing or invalid bearer token",
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                                        schema = @Schema(implementation = ApiProblem.class)))
            })
    MerchantSearchResultsResponse search(
            @RequestParam @NotBlank @Size(min = 2, max = 80) String q,
            @RequestParam(required = false) CommitmentCategory category,
            @RequestParam(defaultValue = "10") @Min(1) @Max(20) int limit) {
        return merchantService.search(q, category, limit);
    }
}
