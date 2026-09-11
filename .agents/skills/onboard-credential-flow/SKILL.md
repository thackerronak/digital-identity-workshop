---
name: onboard-credential-flow
description: >-
  Step-by-step workflow to onboard any new Verifiable Credential (OID4VCI) and Verifier Portal Tab (OID4VP)
  into this digital identity workshop. Use whenever the user asks to add a new credential type, create a
  new issuer offer, support a new domain (e.g. driver license, degree, KYC, tickets, boarding pass), or build
  a new verification tab with custom business rules.
---

# Onboard Credential & Verifier Flow Skill

This skill guides you through adding a **new domain-specific Verifiable Credential** and an **end-to-end Verifier Tab** to this repository.

---

## 1. Architecture Checklist

Every new credential flow touches 6 components:
1. **Keycloak Scope** (`docker/keycloak-credential-scopes.json`)
2. **User Data & Provisioning** (`docker/keycloak-realm.json` & `docker/bootstrap.js`)
3. **Issuer Theme UI** (`docker/keycloak-theme/welcome/index.ftl` & `resources/offer.js`)
4. **Digital Wallet Registry** (`docker/wwwallet/seed.sql`)
5. **Verifier Backend** (`server.js`)
6. **Verifier Frontend** (`public/index.html`, `public/app.js`, `public/style.css`)

---

## 2. Step-by-Step Implementation Procedure

### Step 1: Register Keycloak Credential Scope (`docker/keycloak-credential-scopes.json`)
Append a new scope object to the JSON array:
```json
{
  "name": "<scope-id>",
  "description": "<Display Name>, issued as an SD-JWT VC",
  "protocol": "oid4vc",
  "attributes": {
    "vc.credential_configuration_id": "<scope-id>",
    "vc.format": "dc+sd-jwt",
    "vc.verifiable_credential_type": "https://<domain>.example/<credential-name>",
    "vc.credential_signing_alg": "ES256",
    "vc.expiry_in_seconds": "31536000",
    "vc.include_in_metadata": "true",
    "vc.display": "[{\"name\": \"<Display Name>\", \"locale\": \"en\", \"description\": \"<Description>\", \"background_color\": \"#1E3A8A\", \"text_color\": \"#FFFFFF\", \"logo\": {\"uri\": \"<logo-url>\", \"alt_text\": \"Logo\"}, \"background_image\": {\"uri\": \"<bg-image-url>\"}}]",
    "include.in.token.scope": "true",
    "display.on.consent.screen": "true",
    "vc.cryptographic_binding_methods_supported": "jwk",
    "vc.binding_required": "true",
    "vc.binding_required_proof_types": "jwt",
    "vc.credential_build_config.token_jws_type": "dc+sd-jwt"
  },
  "protocolMappers": [
    {
      "name": "subject-id",
      "protocol": "oid4vc",
      "protocolMapper": "oid4vc-subject-id-mapper",
      "config": {}
    },
    {
      "name": "issued-at",
      "protocol": "oid4vc",
      "protocolMapper": "oid4vc-issued-at-time-claim-mapper",
      "config": { "claim.name": "iat", "valueSource": "COMPUTE" }
    },
    {
      "name": "<claim-name>",
      "protocol": "oid4vc",
      "protocolMapper": "oid4vc-user-attribute-mapper",
      "config": {
        "claim.name": "<claim_name>",
        "userAttribute": "<claim_name>",
        "aggregateAttributes": "false"
      }
    }
  ]
}
```

### Step 2: Add Attributes to Demo Users & Bootstrap
1. In `docker/keycloak-realm.json`:
   - Under `users[0]` (`ronak`), `users[1]` (`raj`), and `users[2]` (`milan`), add sample attribute values inside `"attributes": { ... }`:
     ```json
     "<claim_name>": [ "<sample-value>" ]
     ```
2. In `docker/bootstrap.js`:
   - Add `<scope-id>` to the array of required scopes so it is automatically attached as optional to the `workshop-badge` client:
     ```javascript
     const REQUIRED_SCOPES = ['employee-badge', 'employee-badge-jwt', 'medical-certificate', '<scope-id>'];
     ```
   - Ensure demo user profile syncing assigns the new attributes.

### Step 3: Update Issuer Portal (`docker/keycloak-theme/welcome/`)
1. In `index.ftl`: Add a switcher tab and preview card for the new credential.
2. In `resources/offer.js`:
   - Add the credential to `CREDENTIAL_CONFIGS`:
     ```javascript
     '<scope-id>': {
       scope: '<scope-id>',
       vct: 'https://<domain>.example/<credential-name>',
       title: '<Display Name>',
       issuerOrg: '<Issuing Authority>'
     }
     ```
   - Wire the selection button to trigger `mintOffer('<scope-id>')`.

### Step 4: Digital Wallet Registry (`docker/wwwallet/seed.sql`)
Add the credential to `credential_portal` display JSON in `docker/wwwallet/seed.sql` so the digital wallet lists it under "Add credentials":
```sql
JSON_OBJECT('name', '<Display Name>', 'locale', 'en')
```

### Step 5: Update Verifier Backend (`server.js`)
1. **Register Trusted VCT**:
   ```javascript
   const TRUSTED_VCTS = new Set([
     'https://workshop.acme.test/employee-badge',
     'https://lilavati.example/medical-certificate',
     'https://<domain>.example/<credential-name>'
   ]);
   ```
2. **Add Session DCQL Query (`/api/oid4vp/session`)**:
   ```javascript
   if (useCase === '<scenario_id>') {
     clientName = '<Portal Name>';
     dcqlQuery = {
       credentials: [
         {
           id: '<credential_id>',
           format: 'dc+sd-jwt',
           meta: {
             vct_values: ['https://<domain>.example/<credential-name>']
           },
           claims: [
             { path: ['<claim_1>'] },
             { path: ['<claim_2>'] }
           ]
         }
       ]
     };
   }
   ```
3. **Add Claim Validation (`verifySdJwtPresentation`)**:
   Add the new claims to `allowedClaims` Set.
   Add credential-type validation:
   ```javascript
   if (issuerPayload.vct === 'https://<domain>.example/<credential-name>') {
     if (!validatedClaims.<required_claim>) {
       throw new Error('Missing required claim: <required_claim>');
     }
   }
   ```
4. **Calculate Business Logic Outcome**:
   Compute score/tier/discount in `/api/oid4vp/response` and attach to `session.claims.<outcomeObject>`.

### Step 6: Verifier Frontend (`public/`)
1. In `public/index.html`:
   - Add `<button class="nav-tab" data-tab="<scenario_id>">` to `.nav-tabs`.
   - Add `<section id="tab-<scenario_id>" class="tab-panel">` with:
     - Left column: Scenario guidelines and required credential breakdown.
     - Right column: Verification card with `id="<scenario_id>-unverified-state"` (buttons for Web Wallet & QR) and `id="<scenario_id>-verified-state"` (dynamic outcome).
2. In `public/app.js`:
   - Add state variables: `is<Scenario>Verified`, `<scenario>Claims`.
   - Update `checkUrlParamsForVerification()` to handle `activeTab === '<scenario_id>'`.
   - Implement `render<Scenario>()` to populate verified claims and outcomes.
   - Wire event listeners for `startVerificationFlow('<scenario_id>', ...)` and `openQrModal('<scenario_id>')`.
3. In `public/style.css`:
   - Add card, badge, and grid styles for the new tab.

---

## 3. Verification & Testing

1. Run automated test suite:
   ```bash
   npm test
   ```
2. Restart verifier to reload static files:
   ```bash
   docker compose -f docker/docker-compose.yml restart verifier
   ```
3. Test issuance at `http://localhost:8080/`.
4. Test verification at `http://localhost:4000/`.

---

## 4. Reference Implementation Examples

### Example A: 🎓 University Degree (Alumni Fellowship)
- **Scope ID**: `university-degree`
- **VCT**: `https://stanford.edu/degree`
- **Claims**: `degree_name`, `graduation_year`, `gpa`, `honors_status`, `student_id`
- **Verifier Tab**: `tab="alumni_fellowship"`
- **Business Rule**: If `gpa >= 3.5` or `honors_status === 'Summa Cum Laude'`, grant `Full Tuition Fellowship`; otherwise standard access.

### Example B: ✈️ Airline Boarding Pass (Priority Security Lane)
- **Scope ID**: `boarding-pass`
- **VCT**: `https://skyteam.example/boarding-pass`
- **Claims**: `flight_number`, `seat_number`, `passenger_name`, `tsa_precheck`, `frequent_flyer_tier`
- **Verifier Tab**: `tab="fast_track"`
- **Business Rule**: If `tsa_precheck === true` or `frequent_flyer_tier` contains 'Gold', approve Fast-Track Security lane.

### Example C: 🚗 Digital Driver's License (Express Car Rental)
- **Scope ID**: `driver-license`
- **VCT**: `https://dmv.example/driver-license`
- **Claims**: `license_number`, `issue_state`, `age_over_21`, `organ_donor`
- **Verifier Tab**: `tab="car_rental"`
- **Business Rule**: If `age_over_21 === true`, approve luxury rental checkout. Selective disclosure: request only `license_number` and `age_over_21`.

