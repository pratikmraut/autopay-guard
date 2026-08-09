package in.autopayguard.api.importing;

import in.autopayguard.api.common.error.ApiProblem;
import in.autopayguard.api.common.web.EntityTags;
import in.autopayguard.api.importing.CommitmentImportModels.ConfirmRequest;
import in.autopayguard.api.importing.CommitmentImportModels.ConfirmationOutcome;
import in.autopayguard.api.importing.CommitmentImportModels.ConfirmationResponse;
import in.autopayguard.api.importing.CommitmentImportModels.JobResponse;
import in.autopayguard.api.importing.CommitmentImportModels.UploadRequest;
import in.autopayguard.api.importing.CommitmentImportModels.UploadOutcome;
import in.autopayguard.api.importing.CommitmentImportModels.UploadResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.Part;
import jakarta.validation.Valid;
import jakarta.validation.ValidationException;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/imports")
@Tag(name = "imports")
public class CommitmentImportController {

    private static final Pattern SAFE_BOUNDARY =
            Pattern.compile("^[A-Za-z0-9'()+_,./:=?\\-]{1,70}$");
    private static final int MAXIMUM_FILENAME_LENGTH = 128;

    private final CommitmentImportService importService;

    CommitmentImportController(CommitmentImportService importService) {
        this.importService = importService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(
            operationId = "uploadCommitmentImport",
            summary = "Upload a controlled commitment CSV for preview",
            description =
                    "Accepts exactly one householdId part and one bounded text/csv file part. "
                            + "Only normalized preview rows are committed to product storage; "
                            + "the uploaded CSV bytes are never committed. No commitment is "
                            + "created until an explicit confirmation.",
            security = @SecurityRequirement(name = "bearerAuth"),
            requestBody =
                    @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            mediaType = MediaType.MULTIPART_FORM_DATA_VALUE,
                                            schema =
                                                    @Schema(
                                                            implementation =
                                                                    UploadRequest.class))),
            responses = {
                @ApiResponse(
                        responseCode = "201",
                        description = "Import preview created",
                        headers = {
                            @Header(
                                    name = HttpHeaders.LOCATION,
                                    description = "Safe path of the created import job",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern =
                                                            "^/v1/imports/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")),
                            @Header(
                                    name = HttpHeaders.ETAG,
                                    description = "Quoted numeric optimistic version",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern =
                                                            "^\"(0|[1-9][0-9]*)\"$")),
                            @Header(
                                    name = HttpHeaders.CACHE_CONTROL,
                                    description = "no-store",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern = "^no-store$"))
                        },
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_JSON_VALUE,
                                        schema =
                                                @Schema(
                                                        implementation =
                                                                UploadResponse.class))),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid multipart request, CSV, or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "401",
                        description = "Authentication required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "403",
                        description = "Role is not permitted to import commitments",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Owned household not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Idempotency key conflicts with another request",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "429",
                        description = "Upload rate limit exceeded",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<UploadResponse> upload(
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest request,
            @Parameter(
                            name = "Idempotency-Key",
                            in = ParameterIn.HEADER,
                            required = true,
                            description =
                                    "Actor-scoped replay key bound to the upload fingerprint",
                            schema =
                                    @Schema(
                                            type = "string",
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[!-~]{16,100}$"))
                    @RequestHeader("Idempotency-Key")
                    String idempotencyKey) {
        MultipartUpload upload = exactUpload(request);
        UploadOutcome outcome =
                importService.upload(
                        jwt,
                        upload.householdId(),
                        upload.bytes(),
                        idempotencyKey);
        return ResponseEntity.created(
                        URI.create("/v1/imports/" + outcome.response().id()))
                .eTag(Long.toString(outcome.response().version()))
                .cacheControl(CacheControl.noStore())
                .body(outcome.response());
    }

    @GetMapping("/{importId}")
    @Operation(
            operationId = "getCommitmentImport",
            summary = "Get an owner-only commitment import preview",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Import preview",
                        headers = {
                            @Header(
                                    name = HttpHeaders.ETAG,
                                    description = "Quoted numeric optimistic version",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern =
                                                            "^\"(0|[1-9][0-9]*)\"$")),
                            @Header(
                                    name = HttpHeaders.CACHE_CONTROL,
                                    description = "no-store",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern = "^no-store$"))
                        },
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_JSON_VALUE,
                                        schema = @Schema(implementation = JobResponse.class))),
                @ApiResponse(
                        responseCode = "401",
                        description = "Authentication required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "403",
                        description = "Role is not permitted to read imports",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Import job not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<JobResponse> get(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(
                            name = "importId",
                            in = ParameterIn.PATH,
                            required = true,
                            schema = @Schema(type = "string", format = "uuid"))
                    @PathVariable
                    UUID importId) {
        JobResponse response = importService.get(jwt, importId);
        return ResponseEntity.ok()
                .eTag(Long.toString(response.version()))
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @PostMapping(
            path = "/{importId}/confirm",
            consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            operationId = "confirmCommitmentImport",
            summary = "Atomically create selected commitments from an import preview",
            description =
                    "Revalidates all selected valid rows, creates private fixed CSV commitments "
                            + "atomically, and marks the normalized preview as confirmed. "
                            + "Uploaded CSV bytes were never committed to product storage.",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @ApiResponse(
                        responseCode = "200",
                        description = "Selected import rows confirmed",
                        headers = {
                            @Header(
                                    name = HttpHeaders.ETAG,
                                    description = "Quoted numeric optimistic version",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern =
                                                            "^\"(0|[1-9][0-9]*)\"$")),
                            @Header(
                                    name = HttpHeaders.CACHE_CONTROL,
                                    description = "no-store",
                                    schema =
                                            @Schema(
                                                    type = "string",
                                                    pattern = "^no-store$"))
                        },
                        content =
                                @Content(
                                        mediaType = MediaType.APPLICATION_JSON_VALUE,
                                        schema =
                                                @Schema(
                                                        implementation =
                                                                ConfirmationResponse.class))),
                @ApiResponse(
                        responseCode = "400",
                        description = "Invalid selection, precondition, or idempotency key",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "401",
                        description = "Authentication required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "403",
                        description = "Role is not permitted to confirm imports",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Import job not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Import state or idempotency key conflict",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "412",
                        description = "Stale ETag or expired import",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "428",
                        description = "If-Match is required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "429",
                        description = "Confirmation rate limit exceeded",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<ConfirmationResponse> confirm(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(
                            name = "importId",
                            in = ParameterIn.PATH,
                            required = true,
                            schema = @Schema(type = "string", format = "uuid"))
                    @PathVariable
                    UUID importId,
            @Parameter(
                            name = HttpHeaders.IF_MATCH,
                            in = ParameterIn.HEADER,
                            required = true,
                            description = "Current quoted numeric import-job ETag",
                            schema =
                                    @Schema(
                                            type = "string",
                                            pattern =
                                                    "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch,
            @Parameter(
                            name = "Idempotency-Key",
                            in = ParameterIn.HEADER,
                            required = true,
                            description =
                                    "Actor-scoped replay key bound to the import and selection",
                            schema =
                                    @Schema(
                                            type = "string",
                                            minLength = 16,
                                            maxLength = 100,
                                            pattern = "^[!-~]{16,100}$"))
                    @RequestHeader("Idempotency-Key")
                    String idempotencyKey,
            @Valid @RequestBody ConfirmRequest request) {
        long expectedVersion = EntityTags.requiredVersion(ifMatch);
        ConfirmationOutcome outcome =
                importService.confirm(
                        jwt,
                        importId,
                        expectedVersion,
                        request.selectedItemIds(),
                        idempotencyKey);
        return ResponseEntity.ok()
                .eTag(Long.toString(outcome.response().version()))
                .cacheControl(CacheControl.noStore())
                .body(outcome.response());
    }

    @DeleteMapping("/{importId}")
    @Operation(
            operationId = "discardCommitmentImport",
            summary = "Discard a normalized import preview",
            description =
                    "Marks the normalized preview as discarded. Uploaded CSV bytes were never "
                            + "committed to product storage.",
            security = @SecurityRequirement(name = "bearerAuth"),
            responses = {
                @ApiResponse(
                        responseCode = "204",
                        description = "Import preview discarded",
                        headers =
                                @Header(
                                        name = HttpHeaders.CACHE_CONTROL,
                                        description = "no-store",
                                        schema =
                                                @Schema(
                                                        type = "string",
                                                        pattern =
                                                                "^no-store$"))),
                @ApiResponse(
                        responseCode = "400",
                        description = "Malformed precondition",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "401",
                        description = "Authentication required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "403",
                        description = "Role is not permitted to discard imports",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "404",
                        description = "Import job not found",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "409",
                        description = "Import is already terminal",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "412",
                        description = "Stale ETag or expired import",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class))),
                @ApiResponse(
                        responseCode = "428",
                        description = "If-Match is required",
                        content = @Content(schema = @Schema(implementation = ApiProblem.class)))
            })
    ResponseEntity<Void> discard(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(
                            name = "importId",
                            in = ParameterIn.PATH,
                            required = true,
                            schema = @Schema(type = "string", format = "uuid"))
                    @PathVariable
                    UUID importId,
            @Parameter(
                            name = HttpHeaders.IF_MATCH,
                            in = ParameterIn.HEADER,
                            required = true,
                            description = "Current quoted numeric import-job ETag",
                            schema =
                                    @Schema(
                                            type = "string",
                                            pattern =
                                                    "^\"(0|[1-9][0-9]*)\"$"))
                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false)
                    String ifMatch) {
        importService.discard(
                jwt, importId, EntityTags.requiredVersion(ifMatch));
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }

    private static MultipartUpload exactUpload(HttpServletRequest request) {
        validateMultipartContentType(request.getContentType());
        try {
            Collection<Part> parts = request.getParts();
            if (parts.size() != 2) {
                throw invalidMultipart();
            }
            Part householdPart = null;
            Part filePart = null;
            for (Part part : parts) {
                if ("householdId".equals(part.getName())
                        && householdPart == null
                        && part.getSubmittedFileName() == null) {
                    householdPart = part;
                } else if ("file".equals(part.getName())
                        && filePart == null
                        && part.getSubmittedFileName() != null) {
                    filePart = part;
                } else {
                    throw invalidMultipart();
                }
            }
            if (householdPart == null || filePart == null) {
                throw invalidMultipart();
            }
            UUID householdId = readHouseholdId(householdPart);
            validateFilePart(filePart);
            return new MultipartUpload(
                    householdId, readBounded(filePart, CommitmentCsvParser.MAXIMUM_RAW_BYTES));
        } catch (IOException | ServletException | IllegalStateException exception) {
            throw invalidMultipart();
        }
    }

    private static void validateMultipartContentType(String rawContentType) {
        try {
            MediaType contentType = MediaType.parseMediaType(rawContentType);
            String boundary = contentType.getParameter("boundary");
            if (!MediaType.MULTIPART_FORM_DATA.getType()
                            .equals(contentType.getType())
                    || !MediaType.MULTIPART_FORM_DATA.getSubtype()
                            .equals(contentType.getSubtype())
                    || boundary == null
                    || !SAFE_BOUNDARY.matcher(boundary).matches()) {
                throw invalidMultipart();
            }
        } catch (IllegalArgumentException exception) {
            throw invalidMultipart();
        }
    }

    private static UUID readHouseholdId(Part part) throws IOException {
        if (part.getSize() < 1 || part.getSize() > 36) {
            throw invalidMultipart();
        }
        byte[] bytes = readBounded(part, 36);
        for (byte value : bytes) {
            if (value < 0x20 || value > 0x7e) {
                throw invalidMultipart();
            }
        }
        String value = new String(bytes, StandardCharsets.US_ASCII);
        try {
            UUID id = UUID.fromString(value);
            if (!id.toString().equalsIgnoreCase(value)) {
                throw invalidMultipart();
            }
            return id;
        } catch (IllegalArgumentException exception) {
            throw invalidMultipart();
        }
    }

    private static void validateFilePart(Part part) {
        String filename = part.getSubmittedFileName();
        if (filename == null
                || filename.isBlank()
                || filename.length() > MAXIMUM_FILENAME_LENGTH
                || filename.contains("/")
                || filename.contains("\\")
                || filename.contains("..")
                || filename.codePoints().anyMatch(Character::isISOControl)
                || !filename.toLowerCase(Locale.ROOT).endsWith(".csv")
                || !"text/csv".equals(part.getContentType())
                || part.getSize() < 1
                || part.getSize() > CommitmentCsvParser.MAXIMUM_RAW_BYTES) {
            throw invalidMultipart();
        }
    }

    private static byte[] readBounded(Part part, int maximum)
            throws IOException {
        try (InputStream input = part.getInputStream()) {
            byte[] bytes = input.readNBytes(maximum + 1);
            if (bytes.length < 1 || bytes.length > maximum || input.read() != -1) {
                throw invalidMultipart();
            }
            return bytes;
        }
    }

    private static ValidationException invalidMultipart() {
        return new ValidationException(
                "The multipart CSV upload does not match the controlled import contract.");
    }

    private record MultipartUpload(UUID householdId, byte[] bytes) {}
}
