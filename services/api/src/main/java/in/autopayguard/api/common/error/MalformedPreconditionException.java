package in.autopayguard.api.common.error;

public class MalformedPreconditionException extends RuntimeException {

    public MalformedPreconditionException() {
        super("If-Match must contain one quoted non-negative numeric version.");
    }
}
