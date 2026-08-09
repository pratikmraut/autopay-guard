package in.autopayguard.api.common.error;

import jakarta.validation.ConstraintViolationException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private static final URI VALIDATION_TYPE =
            URI.create("https://autopayguard.local/problems/validation");
    private static final URI IDENTITY_TYPE =
            URI.create("https://autopayguard.local/problems/identity-claims");
    private static final URI CONFLICT_TYPE =
            URI.create("https://autopayguard.local/problems/conflict");
    private static final URI NOT_PROVISIONED_TYPE =
            URI.create("https://autopayguard.local/problems/user-not-provisioned");
    private static final URI NOT_FOUND_TYPE =
            URI.create("https://autopayguard.local/problems/not-found");
    private static final URI PRECONDITION_REQUIRED_TYPE =
            URI.create("https://autopayguard.local/problems/precondition-required");
    private static final URI PRECONDITION_FAILED_TYPE =
            URI.create("https://autopayguard.local/problems/precondition-failed");
    private static final URI RATE_LIMIT_TYPE =
            URI.create("https://autopayguard.local/problems/rate-limit");
    private static final URI UNSUPPORTED_MEDIA_TYPE =
            URI.create("https://autopayguard.local/problems/unsupported-media-type");
    private static final URI NOT_ACCEPTABLE_TYPE =
            URI.create("https://autopayguard.local/problems/not-acceptable");
    private static final URI METHOD_NOT_ALLOWED_TYPE =
            URI.create("https://autopayguard.local/problems/method-not-allowed");
    private static final URI PAYLOAD_TOO_LARGE_TYPE =
            URI.create("https://autopayguard.local/problems/payload-too-large");

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> handleMethodArgumentNotValid(
            MethodArgumentNotValidException exception) {
        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError error : exception.getBindingResult().getFieldErrors()) {
            errors.putIfAbsent(error.getField(), safeMessage(error.getDefaultMessage()));
        }

        ProblemDetail problem =
                problem(
                        HttpStatus.BAD_REQUEST,
                        VALIDATION_TYPE,
                        "Request validation failed",
                        "One or more request fields are invalid.");
        problem.setProperty("errors", errors);
        return ResponseEntity.badRequest().body(problem);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ProblemDetail> handleConstraintViolation(ConstraintViolationException exception) {
        Map<String, String> errors = new LinkedHashMap<>();
        exception
                .getConstraintViolations()
                .forEach(
                        violation ->
                                errors.putIfAbsent(
                                        violation.getPropertyPath().toString(),
                                        safeMessage(violation.getMessage())));

        ProblemDetail problem =
                problem(
                        HttpStatus.BAD_REQUEST,
                        VALIDATION_TYPE,
                        "Request validation failed",
                        "One or more request values are invalid.");
        problem.setProperty("errors", errors);
        return ResponseEntity.badRequest().body(problem);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ProblemDetail> handleUnreadableBody() {
        return ResponseEntity.badRequest()
                .body(
                        problem(
                                HttpStatus.BAD_REQUEST,
                                VALIDATION_TYPE,
                                "Malformed request",
                                "The request body is missing or is not valid JSON."));
    }

    @ExceptionHandler({
        MethodArgumentTypeMismatchException.class,
        MissingServletRequestParameterException.class,
        MissingRequestHeaderException.class,
        MissingServletRequestPartException.class,
        MalformedPreconditionException.class
    })
    ResponseEntity<ProblemDetail> handleMalformedRequest() {
        return ResponseEntity.badRequest()
                .body(
                        problem(
                                HttpStatus.BAD_REQUEST,
                                VALIDATION_TYPE,
                                "Malformed request",
                                "One or more request parameters or headers are invalid."));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ProblemDetail> handleUnsupportedMediaType() {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(
                        problem(
                                HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                                UNSUPPORTED_MEDIA_TYPE,
                                "Unsupported Media Type",
                                "The request media type is not supported for this operation."));
    }

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    ResponseEntity<ProblemDetail> handleNotAcceptable() {
        return ResponseEntity.status(HttpStatus.NOT_ACCEPTABLE)
                .body(
                        problem(
                                HttpStatus.NOT_ACCEPTABLE,
                                NOT_ACCEPTABLE_TYPE,
                                "Not Acceptable",
                                "The requested response media type is not available."));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ProblemDetail> handleMethodNotSupported(
            HttpRequestMethodNotSupportedException exception) {
        ResponseEntity.BodyBuilder response =
                ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                        .headers(exception.getHeaders());
        return response.body(
                problem(
                        HttpStatus.METHOD_NOT_ALLOWED,
                        METHOD_NOT_ALLOWED_TYPE,
                        "Method Not Allowed",
                        "The request method is not supported for this operation."));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ProblemDetail> handlePayloadTooLarge() {
        return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE)
                .body(
                        problem(
                                HttpStatus.CONTENT_TOO_LARGE,
                                PAYLOAD_TOO_LARGE_TYPE,
                                "Payload Too Large",
                                "The multipart upload exceeds the allowed request size."));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ProblemDetail> handleNoResourceFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(
                        problem(
                                HttpStatus.NOT_FOUND,
                                NOT_FOUND_TYPE,
                                "Resource not found",
                                "The requested resource was not found."));
    }

    @ExceptionHandler(jakarta.validation.ValidationException.class)
    ResponseEntity<ProblemDetail> handleDomainValidation(
            jakarta.validation.ValidationException exception) {
        return ResponseEntity.badRequest()
                .body(
                        problem(
                                HttpStatus.BAD_REQUEST,
                                VALIDATION_TYPE,
                                "Request validation failed",
                                exception.getMessage()));
    }

    @ExceptionHandler(IdentityClaimsException.class)
    ResponseEntity<ProblemDetail> handleIdentityClaims(IdentityClaimsException exception) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_CONTENT)
                .body(
                        problem(
                                HttpStatus.UNPROCESSABLE_CONTENT,
                                IDENTITY_TYPE,
                                "Identity profile is incomplete",
                                exception.getMessage()));
    }

    @ExceptionHandler(LocalUserNotProvisionedException.class)
    ResponseEntity<ProblemDetail> handleNotProvisioned(
            LocalUserNotProvisionedException exception) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(
                        problem(
                                HttpStatus.FORBIDDEN,
                                NOT_PROVISIONED_TYPE,
                                "Local user is not provisioned",
                                exception.getMessage()));
    }

    @ExceptionHandler(RequestConflictException.class)
    ResponseEntity<ProblemDetail> handleRequestConflict(RequestConflictException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(
                        problem(
                                HttpStatus.CONFLICT,
                                CONFLICT_TYPE,
                                "Request conflicts with current state",
                                exception.getMessage()));
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    ResponseEntity<ProblemDetail> handleNotFound(ResourceNotFoundException exception) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(
                        problem(
                                HttpStatus.NOT_FOUND,
                                NOT_FOUND_TYPE,
                                "Resource not found",
                                exception.getMessage()));
    }

    @ExceptionHandler(PreconditionRequiredException.class)
    ResponseEntity<ProblemDetail> handlePreconditionRequired(
            PreconditionRequiredException exception) {
        return ResponseEntity.status(HttpStatus.PRECONDITION_REQUIRED)
                .body(
                        problem(
                                HttpStatus.PRECONDITION_REQUIRED,
                                PRECONDITION_REQUIRED_TYPE,
                                "Precondition required",
                                exception.getMessage()));
    }

    @ExceptionHandler({
        PreconditionFailedException.class,
        OptimisticLockingFailureException.class,
        CannotAcquireLockException.class
    })
    ResponseEntity<ProblemDetail> handlePreconditionFailed() {
        return ResponseEntity.status(HttpStatus.PRECONDITION_FAILED)
                .body(
                        problem(
                                HttpStatus.PRECONDITION_FAILED,
                                PRECONDITION_FAILED_TYPE,
                                "Precondition failed",
                                "The resource changed after it was read. Fetch it again before retrying."));
    }

    @ExceptionHandler(RateLimitExceededException.class)
    ResponseEntity<ProblemDetail> handleRateLimit(RateLimitExceededException exception) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(
                        org.springframework.http.HttpHeaders.RETRY_AFTER,
                        Long.toString(exception.retryAfterSeconds()))
                .body(
                        problem(
                                HttpStatus.TOO_MANY_REQUESTS,
                                RATE_LIMIT_TYPE,
                                "Too many requests",
                                exception.getMessage()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ProblemDetail> handleDataIntegrityViolation() {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(
                        problem(
                                HttpStatus.CONFLICT,
                                CONFLICT_TYPE,
                                "Request conflicts with current state",
                                "The requested change could not be applied."));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpected(Exception exception) {
        String errorId = UUID.randomUUID().toString();
        log.atError()
                .addKeyValue("errorId", errorId)
                .addKeyValue("exceptionType", exception.getClass().getName())
                .log("request.failed");

        ProblemDetail problem =
                problem(
                        HttpStatus.INTERNAL_SERVER_ERROR,
                        URI.create("about:blank"),
                        "Internal Server Error",
                        "An unexpected error occurred.");
        problem.setProperty("errorId", errorId);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(problem);
    }

    private static ProblemDetail problem(
            HttpStatus status, URI type, String title, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setType(type);
        problem.setTitle(title);
        String correlationId = MDC.get(CorrelationIdFilter.MDC_KEY);
        if (correlationId != null) {
            problem.setProperty("correlationId", correlationId);
        }
        return problem;
    }

    private static String safeMessage(String message) {
        return message == null ? "Invalid value." : message;
    }
}
