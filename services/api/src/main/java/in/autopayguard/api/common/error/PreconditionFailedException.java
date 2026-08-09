package in.autopayguard.api.common.error;

public class PreconditionFailedException extends RuntimeException {

    public PreconditionFailedException() {
        super("The resource changed after it was read. Fetch it again before retrying.");
    }
}
