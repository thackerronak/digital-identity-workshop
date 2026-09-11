-- wwWallet keeps a trusted-issuer registry in its own database and has no API
-- to write it, so it must be seeded directly.
--
-- Why it matters: the wallet resolves the OAuth client_id for an issuer from
-- this table (OpenID4VCIHelper.getClientId). With no row it falls back to using
-- OPENID4VCI_REDIRECT_URI as the client_id, which is not a registered Keycloak
-- client, so the token request is rejected.
--
-- Idempotent: safe to re-run against the persistent volume.

INSERT INTO credential_issuer (credentialIssuerIdentifier, clientId, visible)
SELECT 'http://keycloak.localhost:8080/realms/workshop', 'workshop-badge', 1
WHERE NOT EXISTS (
  SELECT 1 FROM credential_issuer
  WHERE credentialIssuerIdentifier = 'http://keycloak.localhost:8080/realms/workshop'
);

-- Optional nicety: makes the issuer page appear in the wallet's
-- "Add credentials" screen, so the employee can reach it from the wallet.
INSERT INTO credential_portal (url, display, visible)
SELECT 'http://keycloak.localhost:8080/',
       JSON_ARRAY(
         JSON_OBJECT('name', 'Get Employee and Medical Identity', 'locale', 'en')
       ),
       1
WHERE NOT EXISTS (
  SELECT 1 FROM credential_portal WHERE url = 'http://keycloak.localhost:8080/'
);

