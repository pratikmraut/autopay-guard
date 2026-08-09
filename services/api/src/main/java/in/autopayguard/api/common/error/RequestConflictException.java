package in.autopayguard.api.common.error;

public class RequestConflictException extends RuntimeException {

    public RequestConflictException(String message) {
        super(message);
    }
}
