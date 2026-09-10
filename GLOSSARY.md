# Digital Identity & Verifiable Credentials Glossary

This glossary defines core terminology, standards, protocols, and cryptographic concepts used across this workshop.

> [!IMPORTANT]
> **Educational and Demonstration Purpose Only**: This workshop and code repository are created strictly for educational, training, and local demonstration purposes. It is not designed or intended for real-world or production use.

## Quick Index
- [1. Roles and Architecture](#1-roles-and-architecture)
- [2. Credentials and Presentations](#2-credentials-and-presentations)
- [3. Credential Formats and Standards](#3-credential-formats-and-standards)
- [4. OpenID Protocols (OID4VCI & OID4VP)](#4-openid-protocols)
- [5. Security and Cryptography](#5-security-and-cryptography)
- [6. Workshop Components](#6-workshop-components)

---

## 1. Roles and Architecture

### Issuer
The authoritative organization that asserts claims about a subject, signs the resulting Verifiable Credential, and delivers it to the holder. In this workshop, Keycloak 26.6 acts as the Issuer issuing Google Employee Badges.

### Holder
The entity that receives, securely stores, and controls the presentation of Verifiable Credentials. Typically, the holder is an employee or end user operating a digital wallet application.

### Verifier (Relying Party / RP)
An application, service, or organization that requests a Verifiable Presentation from a holder, verifies its cryptographic signatures and issuer authenticity, and evaluates the disclosed claims. In this workshop, the Store Cart portal acts as the Verifier.

### Digital Wallet
Software running on a mobile device, desktop, or web browser that securely manages the holder's private cryptographic keys and stores verifiable credentials. It mediates interactions with issuers (OID4VCI) and verifiers (OID4VP).

---

## 2. Credentials and Presentations

### Verifiable Credential (VC)
A tamper-evident digital credential containing a set of claims made by an issuer about a subject. The credential is cryptographically signed by the issuer, allowing any verifier to validate its integrity and origin without contacting the issuer in real time.

### Verifiable Presentation (VP)
A package created by the holder containing one or more credentials (or selective disclosures from those credentials), combined with proof that the presenter holds the private key bound to the credential.

### Selective Disclosure
The capability of a credential format to allow the holder to disclose only a specific subset of claims to a verifier while keeping all other claims hidden, without invalidating the issuer's original digital signature.

### Holder Binding (Key Binding)
A cryptographic mechanism ensuring that a credential can only be presented by its legitimate owner. The credential contains the holder's public key; during presentation, the holder signs a fresh nonce or challenge using their corresponding private key.

---

## 3. Credential Formats and Standards

### SD-JWT (Selective Disclosure JSON Web Token)
An IETF standard format that extends JSON Web Tokens (JWT) to support selective disclosure. Attributes are replaced by cryptographic hashes (digests) in the main token payload, with the actual attribute values provided in separate disclosure arrays.

### SD-JWT VC (`dc+sd-jwt`)
The application of SD-JWT specifically designed for Verifiable Credentials. It defines standard fields such as `vct` (Verifiable Credential Type) and rules for issuer signing, status checking, and holder key binding.

### VCT (Verifiable Credential Type)
A unique URI identifying the schema, semantics, and expected claim structure of an SD-JWT credential (for example, `https://workshop.acme.test/employee-badge`).

### Disclosure
A base64url-encoded JSON array containing three elements: a cryptographically random salt, the claim name, and the claim value (e.g. `["salt_value", "department", "Engineering"]`). The SHA-256 hash of this array matches a digest in the issuer's signed payload.

### Salt
A high-entropy random string prepended to a claim before hashing. It prevents attackers or verifiers from guessing undisclosed claims through rainbow table or dictionary attacks.

---

## 4. OpenID Protocols

### OID4VCI (OpenID for Verifiable Credential Issuance)
**OpenID for Verifiable Credential Issuance (OID4VCI)** is an open standard developed by the OpenID Foundation defining how a digital wallet discovers, authorizes, and obtains verifiable credentials from an issuer.

- **Purpose**: Replaces legacy proprietary credential provisioning with a standardized REST and OAuth 2.0-based protocol.
- **Protocol Flow**:
  1. **Discovery**: The wallet retrieves the issuer's capabilities, supported formats (`dc+sd-jwt`), cryptographic algorithms, and credential types from `/.well-known/openid-credential-issuer`.
  2. **Offer Delivery**: The issuer generates a `credential_offer` (containing the issuer URL and offered credential IDs) and delivers it to the wallet via a deep link, QR code, or query parameter.
  3. **Authorization**: The wallet redirects the user to authenticate with the issuer via OAuth 2.0 with PKCE (or uses a pre-authorized code) to obtain an `access_token`.
  4. **Credential Request**: The wallet creates a public/private keypair for holder binding, constructs a proof of possession (POP), and sends an HTTP POST request to `/credential`.
  5. **Issuance**: The issuer returns the signed credential (e.g., an SD-JWT token) to the wallet.
- **In This Workshop**: Keycloak 26.6 hosts the OID4VCI endpoints on `http://localhost:8080/realms/workshop`. Users log in on the welcome portal, click "Add to Your Wallet", and receive an offer for the Google Employee Badge.

### Credential Offer
A structured JSON object or URI passed from an issuer to a holder wallet indicating which credentials are ready to be issued and where the wallet must connect to request them. Can be delivered via deep links, query parameters, or QR codes.

### Pre-Authorized Code Flow
An OID4VCI issuance flow where the holder's identity has already been established out-of-band or via an initial login session, allowing the wallet to redeem a single-use pre-authorized code directly for a credential without repeating interactive authentication.

### OID4VP (OpenID for Verifiable Presentations)
**OpenID for Verifiable Presentations (OID4VP)** is an open standard developed by the OpenID Foundation defining how a verifier (relying party) requests, receives, and cryptographically validates verifiable presentations from a digital wallet.

- **Purpose**: Enables privacy-preserving proof of identity and credentials across web and mobile platforms without relying on centralized identity brokers.
- **Protocol Flow**:
  1. **Authorization Request**: The verifier creates a session with a unique challenge/nonce and queries for specific credentials using DCQL (`dcql_query`) or Presentation Exchange (`presentation_definition`).
  2. **Request Delivery**: The verifier provides the authorization request to the wallet either via a signed request object URL (`request_uri`) or a custom scheme (`openid4vp://`).
  3. **Holder Consent**: The wallet decodes the request, displays which claims are requested, and prompts the user to consent to the selective disclosure.
  4. **Presentation Submission**: The wallet signs a presentation with holder key binding and transmits the `vp_token` to the verifier's `response_uri` via HTTP POST (`direct_post`).
  5. **Verification**: The verifier verifies the issuer's digital signature, validates the holder's key binding signature against the fresh nonce, checks expiration, and processes the disclosed claims.
- **In This Workshop**: The Store Cart service (`server.js` on port 4000) issues signed OID4VP requests using `typ: "oauth-authz-req+jwt"` and `client_id: x509_san_dns:verifier.localhost`. It accepts the employee badge presentation via `direct_post` and dynamically applies a 20% discount.

### DCQL (Digital Credential Query Language)
A modern query format defined in OID4VP enabling verifiers to specify exactly which credentials and claims they require, including acceptable formats, types, and attribute paths. It serves as a streamlined alternative to Presentation Exchange (PEX).

### Direct Post (`direct_post`)
An OID4VP response mode where the wallet submits the presentation (`vp_token`) directly to the verifier's backend HTTP endpoint via an HTTP POST request, rather than passing large credential payloads through browser URL redirects.

### Signed Request Object (JAR / RFC 9101)
A JWT containing all authorization request parameters, signed by the verifier's private key. Wallets verify the signature against the verifier's public certificate to confirm the request has not been tampered with.

---

## 5. Security and Cryptography

### ES256 (ECDSA P-256 with SHA-256)
The digital signature algorithm used throughout this workshop for signing credentials, request objects, and key binding proofs. It relies on the NIST P-256 elliptic curve and SHA-256 hashing.

### X.509 Certificate
A digital certificate conforming to the ITU-T X.509 standard that binds a public key to an organization or domain identity. Used in this workshop by the verifier to prove ownership of its domain.

### SAN (Subject Alternative Name)
An extension field in X.509 certificates that specifies DNS domain names, IP addresses, or URIs associated with the certificate.

### `x509_san_dns` Client ID Scheme
An OID4VP identifier format where the verifier's `client_id` begins with `x509_san_dns:` followed by a domain name (such as `x509_san_dns:verifier.localhost`). The wallet validates that the domain matches an entry in the certificate's SAN extension.

### PKCE (Proof Key for Code Exchange)
An OAuth 2.0 security extension that prevents authorization code interception attacks by requiring the client to prove possession of a randomly generated secret (`code_verifier`).

---

## 6. Workshop Components

### Keycloak Realm
An isolated security domain in Keycloak managing users, credentials, roles, and client applications. The `workshop` realm hosts demo employee credentials and the OID4VCI issuer service.

### Client Scope
A reusable configuration bundle in Keycloak that maps user profile attributes to credential claims (such as `employee-badge` mapping `department` and `employee_id`).

### `bootstrap.js`
A lightweight Node.js automation script executed on container startup that configures Keycloak encryption key providers, creates client scopes, and assigns credentials to demo employee users.

### Verifier Portal (`server.js`)
The Node.js Express service running on port 4000 that creates OID4VP sessions, signs request objects, receives presentations via `direct_post`, parses SD-JWT disclosures, and calculates shopping cart discounts.
