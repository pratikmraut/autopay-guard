package in.autopayguard.api.common.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

final class AuthorizedPartyValidator implements OAuth2TokenValidator<Jwt> {

    private final String requiredAuthorizedParty;

    AuthorizedPartyValidator(String requiredAuthorizedParty) {
        this.requiredAuthorizedParty = requiredAuthorizedParty;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        if (requiredAuthorizedParty.equals(jwt.getClaims().get("azp"))) {
            return OAuth2TokenValidatorResult.success();
        }

        OAuth2Error error =
                new OAuth2Error(
                        "invalid_token",
                        "The token was not issued to the approved web client.",
                        null);
        return OAuth2TokenValidatorResult.failure(error);
    }
}
