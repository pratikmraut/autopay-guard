package in.autopayguard.api.common.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

class JwtValidationTest {

    private static final String ISSUER =
            "https://issuer.test.example/realms/autopay-guard";
    private static final String AUDIENCE = "autopay-guard-api";
    private static final String AUTHORIZED_PARTY = "autopay-guard-web";

    private static RSAPublicKey publicKey;
    private static RSAPrivateKey privateKey;

    @BeforeAll
    static void createSigningKey() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keyPair = generator.generateKeyPair();
        publicKey = (RSAPublicKey) keyPair.getPublic();
        privateKey = (RSAPrivateKey) keyPair.getPrivate();
    }

    @Test
    void validatesSignatureIssuerExpiryAndAudienceTogether() throws Exception {
        SecurityConfiguration configuration = new SecurityConfiguration();
        SecurityProperties properties =
                new SecurityProperties(ISSUER, "", AUDIENCE, AUTHORIZED_PARTY);
        OAuth2TokenValidator<Jwt> validator = configuration.apiJwtValidator(properties);
        JwtDecoder signatureDecoder = NimbusJwtDecoder.withPublicKey(publicKey).build();
        JwtDecoder decoder =
                SecurityConfiguration.validatingDecoder(signatureDecoder, validator);
        Instant now = Instant.now();

        Jwt valid =
                decoder.decode(
                        signedToken(
                                privateKey,
                                ISSUER,
                                List.of(AUDIENCE),
                                now.minusSeconds(5),
                                now.plusSeconds(300)));
        assertThat(valid.getSubject()).isEqualTo("fake-user");

        assertThatThrownBy(
                        () ->
                                decoder.decode(
                                        signedToken(
                                                privateKey,
                                                ISSUER,
                                                List.of("other-api"),
                                                now.minusSeconds(5),
                                                now.plusSeconds(300))))
                .isInstanceOf(JwtException.class);
        assertThatThrownBy(
                        () ->
                                decoder.decode(
                                        signedToken(
                                                privateKey,
                                                ISSUER,
                                                List.of(AUDIENCE),
                                                "different-web-client",
                                                now.minusSeconds(5),
                                                now.plusSeconds(300))))
                .isInstanceOf(JwtException.class);
        assertThatThrownBy(
                        () ->
                                decoder.decode(
                                        signedToken(
                                                privateKey,
                                                "https://wrong-issuer.example",
                                                List.of(AUDIENCE),
                                                now.minusSeconds(5),
                                                now.plusSeconds(300))))
                .isInstanceOf(JwtException.class);
        assertThatThrownBy(
                        () ->
                                decoder.decode(
                                        signedToken(
                                                privateKey,
                                                ISSUER,
                                                List.of(AUDIENCE),
                                                now.minusSeconds(300),
                                                now.minusSeconds(120))))
                .isInstanceOf(JwtException.class);

        KeyPairGenerator otherGenerator = KeyPairGenerator.getInstance("RSA");
        otherGenerator.initialize(2048);
        RSAPrivateKey otherPrivateKey =
                (RSAPrivateKey) otherGenerator.generateKeyPair().getPrivate();
        assertThatThrownBy(
                        () ->
                                decoder.decode(
                                        signedToken(
                                                otherPrivateKey,
                                                ISSUER,
                                                List.of(AUDIENCE),
                                                now.minusSeconds(5),
                                                now.plusSeconds(300))))
                .isInstanceOf(JwtException.class);
    }

    private static String signedToken(
            RSAPrivateKey signingKey,
            String issuer,
            List<String> audience,
            Instant issuedAt,
            Instant expiresAt)
            throws Exception {
        return signedToken(
                signingKey,
                issuer,
                audience,
                AUTHORIZED_PARTY,
                issuedAt,
                expiresAt);
    }

    private static String signedToken(
            RSAPrivateKey signingKey,
            String issuer,
            List<String> audience,
            String authorizedParty,
            Instant issuedAt,
            Instant expiresAt)
            throws Exception {
        JWTClaimsSet claims =
                new JWTClaimsSet.Builder()
                        .subject("fake-user")
                        .issuer(issuer)
                        .audience(audience)
                        .claim("azp", authorizedParty)
                        .issueTime(Date.from(issuedAt))
                        .expirationTime(Date.from(expiresAt))
                        .build();
        SignedJWT jwt =
                new SignedJWT(
                        new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test-key").build(),
                        claims);
        jwt.sign(new RSASSASigner(signingKey));
        return jwt.serialize();
    }
}
