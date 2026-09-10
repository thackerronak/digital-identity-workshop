#!/usr/bin/env bash
# Regenerates the throwaway demo PKI used to sign SD-JWT VCs.
#
# WHY THIS EXISTS: Keycloak refuses to sign SD-JWT VCs with a generated realm
# key -- HAIP requires an x5c chain whose leaf certificate is NOT self-signed.
# So we need a (demo) CA and a leaf certificate for the signing key.
#
# The generated material is committed to the repo on purpose: it is a workshop
# demo CA with a published password, and committing it means attendees need no
# openssl installed (notably on Windows). NEVER use any of this for real.
set -euo pipefail
cd "$(dirname "$0")/keycloak-keys"
PASS=workshop

openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 3650 -out ca.crt \
  -subj "/O=ACME Corp (WORKSHOP DEMO)/CN=ACME Workshop Root CA"

openssl ecparam -name prime256v1 -genkey -noout -out issuer.key
openssl req -new -key issuer.key -out issuer.csr \
  -subj "/O=ACME Corp (WORKSHOP DEMO)/CN=ACME Employee Badge Issuer"

# SANs cover both hostnames Keycloak is reached by: localhost (browser) and
# keycloak (compose DNS, used by wallet-api).
openssl x509 -req -in issuer.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out issuer.crt -days 3650 -sha256 -extfile <(cat <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
subjectAltName=DNS:localhost,DNS:keycloak,URI:http://localhost:8080/realms/workshop
EXT
)

# Chain order: leaf first, then the self-signed root. Keycloak strips a
# trailing self-signed root when building the SD-JWT VC x5c header.
openssl pkcs12 -export -inkey issuer.key -in issuer.crt -certfile ca.crt \
  -name workshop-issuer -out issuer.p12 -passout "pass:${PASS}"

rm -f issuer.csr ca.srl
echo "demo PKI written to $(pwd)"
