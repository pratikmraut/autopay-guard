package in.autopayguard.api.common.error;

public class LocalUserNotProvisionedException extends RuntimeException {

    public LocalUserNotProvisionedException() {
        super("The authenticated identity is not provisioned for this environment.");
    }
}
