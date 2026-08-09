package in.autopayguard.api.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

class ApiExceptionHandlerProtocolTest {

    private final ApiExceptionHandler handler = new ApiExceptionHandler();

    @Test
    void methodNotSupportedReturns405AndPreservesAllowHeader() throws Exception {
        HttpRequestMethodNotSupportedException exception =
                new HttpRequestMethodNotSupportedException(
                        "TRACE", List.of(HttpMethod.GET.name(), HttpMethod.POST.name()));

        ResponseEntity<ProblemDetail> response = handler.handleMethodNotSupported(exception);

        assertProblem(
                response,
                HttpStatus.METHOD_NOT_ALLOWED,
                "https://autopayguard.local/problems/method-not-allowed",
                "Method Not Allowed",
                "The request method is not supported for this operation.");
        assertThat(response.getHeaders().getAllow())
                .containsExactlyInAnyOrder(HttpMethod.GET, HttpMethod.POST);
        assertMaps(
                "handleMethodNotSupported",
                HttpRequestMethodNotSupportedException.class,
                HttpRequestMethodNotSupportedException.class);
    }

    @Test
    void mediaTypeNotAcceptableReturns406() throws Exception {
        assertProblem(
                handler.handleNotAcceptable(),
                HttpStatus.NOT_ACCEPTABLE,
                "https://autopayguard.local/problems/not-acceptable",
                "Not Acceptable",
                "The requested response media type is not available.");
        assertMaps(
                "handleNotAcceptable", HttpMediaTypeNotAcceptableException.class);
    }

    @Test
    void oversizedMultipartUploadReturns413() throws Exception {
        assertProblem(
                handler.handlePayloadTooLarge(),
                HttpStatus.CONTENT_TOO_LARGE,
                "https://autopayguard.local/problems/payload-too-large",
                "Payload Too Large",
                "The multipart upload exceeds the allowed request size.");
        assertMaps(
                "handlePayloadTooLarge", MaxUploadSizeExceededException.class);
    }

    @Test
    void missingMultipartPartReturns400() throws Exception {
        assertProblem(
                handler.handleMalformedRequest(),
                HttpStatus.BAD_REQUEST,
                "https://autopayguard.local/problems/validation",
                "Malformed request",
                "One or more request parameters or headers are invalid.");
        assertMaps(
                "handleMalformedRequest", MissingServletRequestPartException.class);
    }

    @Test
    void missingStaticResourceReturns404() throws Exception {
        assertProblem(
                handler.handleNoResourceFound(),
                HttpStatus.NOT_FOUND,
                "https://autopayguard.local/problems/not-found",
                "Resource not found",
                "The requested resource was not found.");
        assertMaps("handleNoResourceFound", NoResourceFoundException.class);
    }

    @Test
    void lockAcquisitionLoserReturns412() throws Exception {
        assertProblem(
                handler.handlePreconditionFailed(),
                HttpStatus.PRECONDITION_FAILED,
                "https://autopayguard.local/problems/precondition-failed",
                "Precondition failed",
                "The resource changed after it was read. Fetch it again before retrying.");
        assertMaps("handlePreconditionFailed", CannotAcquireLockException.class);
    }

    private static void assertProblem(
            ResponseEntity<ProblemDetail> response,
            HttpStatus status,
            String type,
            String title,
            String detail) {
        assertThat(response.getStatusCode()).isEqualTo(status);
        ProblemDetail problem = Objects.requireNonNull(response.getBody());
        assertThat(problem.getStatus()).isEqualTo(status.value());
        assertThat(problem.getType()).isEqualTo(URI.create(type));
        assertThat(problem.getTitle()).isEqualTo(title);
        assertThat(problem.getDetail()).isEqualTo(detail);
    }

    private static void assertMaps(
            String methodName, Class<? extends Exception> exceptionType, Class<?>... parameters)
            throws NoSuchMethodException {
        Method method = ApiExceptionHandler.class.getDeclaredMethod(methodName, parameters);
        ExceptionHandler mapping = method.getAnnotation(ExceptionHandler.class);

        assertThat(mapping).isNotNull();
        assertThat(Arrays.asList(Objects.requireNonNull(mapping).value())).contains(exceptionType);
    }
}
