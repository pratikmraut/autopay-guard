package in.autopayguard.api.common.error;

public class AccountEnrollmentRequiredException extends RuntimeException {

    public AccountEnrollmentRequiredException() {
        super("Review and accept the current notice to create your application account.");
    }
}
