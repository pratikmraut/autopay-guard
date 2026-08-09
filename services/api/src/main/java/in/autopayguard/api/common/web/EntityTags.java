package in.autopayguard.api.common.web;

import in.autopayguard.api.common.error.MalformedPreconditionException;
import in.autopayguard.api.common.error.PreconditionRequiredException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class EntityTags {

    private static final Pattern NUMERIC_ETAG = Pattern.compile("^\"(0|[1-9][0-9]*)\"$");

    private EntityTags() {}

    public static String forVersion(long version) {
        return "\"" + version + "\"";
    }

    public static long requiredVersion(String ifMatch) {
        if (ifMatch == null || ifMatch.isBlank()) {
            throw new PreconditionRequiredException();
        }
        Matcher matcher = NUMERIC_ETAG.matcher(ifMatch);
        if (!matcher.matches()) {
            throw new MalformedPreconditionException();
        }
        try {
            return Long.parseLong(matcher.group(1));
        } catch (NumberFormatException exception) {
            throw new MalformedPreconditionException();
        }
    }
}
