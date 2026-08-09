package in.autopayguard.api.identity;

import java.util.regex.Pattern;

public final class FakeLocalIdentityPolicy {

    private static final Pattern RESERVED_FAKE_EMAIL =
            Pattern.compile(
                    "^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
                            + "(?:autopayguard\\.local|(?:[a-z0-9-]+\\.)*example\\.test)$",
                    Pattern.CASE_INSENSITIVE);

    private FakeLocalIdentityPolicy() {}

    public static boolean isEligibleEmail(String email) {
        return email != null
                && email.equals(email.strip())
                && email.length() <= 320
                && RESERVED_FAKE_EMAIL.matcher(email).matches();
    }
}
