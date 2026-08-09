package in.autopayguard.api.common.error;

public class PreconditionRequiredException extends RuntimeException {

    public PreconditionRequiredException() {
        super("A current If-Match ETag is required.");
    }
}
