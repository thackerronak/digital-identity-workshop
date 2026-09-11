#!/usr/bin/env node
/**
 * Automated Verification & Security Test Suite
 *
 * Tests the OID4VP / SD-JWT VC verification engine in server.js:
 * 1. Valid Keycloak SD-JWT VC presentation with Holder Key Binding (PASS)
 * 2. Replay attack rejection (PASS -> REJECT)
 * 3. Untrusted issuer rejection (REJECT)
 * 4. Forged issuer signature rejection (REJECT)
 * 5. Tampered disclosure digest rejection (REJECT)
 * 6. Bearer replay: key-bound credential presented without KB-JWT (REJECT)
 * 7. KB-JWT carrying a stale/foreign nonce on a fresh session (REJECT)
 * 8. KB-JWT addressed to a different audience (REJECT)
 * 9. KB-JWT whose sd_hash does not match the presented SD-JWT (REJECT)
 */

const crypto = require('crypto');
const jose = require('jose');

const VERIFIER_URL = process.env.VERIFIER_URL || 'http://localhost:4000';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:8080';

const toB64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

async function getRealKeycloakCredential(username = 'ronak', password = 'workshop') {
  // 1. Authenticate with direct grant
  const tRes = await fetch(`${KEYCLOAK_URL}/realms/workshop/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'workshop-badge',
      username,
      password,
      scope: 'openid profile employee-badge'
    })
  });
  if (!tRes.ok) throw new Error(`Keycloak login failed: ${tRes.status} ${await tRes.text()}`);
  const token = await tRes.json();

  // 2. Mint pre-authorized offer
  const oRes = await fetch(`${KEYCLOAK_URL}/realms/workshop/protocol/oid4vc/create-credential-offer?credential_configuration_id=employee-badge&pre_authorized=true`, {
    headers: { authorization: `Bearer ${token.access_token}` }
  });
  if (!oRes.ok) throw new Error(`Offer creation failed: ${oRes.status}`);
  const offer = await oRes.json();
  const doc = await fetch(`${offer.issuer}/${offer.nonce}`).then(r => r.json());
  const preAuthCode = doc.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code']['pre-authorized_code'];

  // 3. Exchange pre-auth code
  const tokRes = await fetch(`${KEYCLOAK_URL}/realms/workshop/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:pre-authorized_code',
      'pre-authorized_code': preAuthCode
    })
  });
  const credTok = await tokRes.json();

  // 4. Request fresh c_nonce
  const nRes = await fetch(`${KEYCLOAK_URL}/realms/workshop/protocol/oid4vc/nonce`, { method: 'POST' });
  const { c_nonce } = await nRes.json();

  // 5. Generate holder key pair & proof
  const { publicKey, privateKey } = await jose.generateKeyPair('ES256');
  const holderJwk = await jose.exportJWK(publicKey);
  const proofJwt = await new jose.SignJWT({
    iss: 'workshop-badge',
    aud: 'http://keycloak.localhost:8080/realms/workshop',
    iat: Math.floor(Date.now() / 1000),
    nonce: c_nonce
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'openid4vci-proof+jwt', jwk: holderJwk })
    .sign(privateKey);

  // 6. Request SD-JWT VC credential
  const cRes = await fetch(`${KEYCLOAK_URL}/realms/workshop/protocol/oid4vc/credential`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${credTok.access_token}`
    },
    body: JSON.stringify({
      credential_configuration_id: 'employee-badge',
      proof: {
        proof_type: 'jwt',
        jwt: proofJwt
      }
    })
  });

  if (!cRes.ok) throw new Error(`Credential request failed: ${cRes.status} ${await cRes.text()}`);
  const credData = await cRes.json();
  const rawSdJwt = credData.credentials[0].credential;

  return {
    rawSdJwt,
    holderKey: privateKey,
    holderJwk
  };
}

async function createVerifierSession(useCase = 'cart_discount') {
  const res = await fetch(`${VERIFIER_URL}/api/oid4vp/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ useCase, returnOrigin: VERIFIER_URL })
  });
  if (!res.ok) throw new Error(`Failed to create verifier session: ${res.status}`);
  const session = await res.json();

  // Fetch nonce from request object
  const reqObjRes = await fetch(session.requestUri);
  const reqJwt = await reqObjRes.text();
  const reqPayload = jose.decodeJwt(reqJwt);

  return {
    ...session,
    nonce: reqPayload.nonce,
    client_id: reqPayload.client_id
  };
}

/**
 * Extracts selective disclosures for specified claim names from a full SD-JWT.
 */
function extractSelectiveSdJwt(rawSdJwt, allowedClaimNames) {
  const parts = rawSdJwt.split('~');
  const issuerJwt = parts[0];
  const selectedDisclosures = [];

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    try {
      const decoded = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
      if (Array.isArray(decoded) && decoded.length >= 3) {
        const claimName = decoded[1];
        if (allowedClaimNames.includes(claimName)) {
          selectedDisclosures.push(part);
        }
      }
    } catch (e) {
      // ignore non-disclosure parts
    }
  }

  return `${issuerJwt}~${selectedDisclosures.join('~')}~`;
}

/**
 * Builds a key-bound presentation, allowing one field of the KB-JWT to be
 * subverted at a time. Used by the KB-JWT field checks (tests 7-9): each
 * varies exactly one input so a failure names the check that regressed.
 */
async function buildKeyBoundPresentation(rawSdJwt, holderKey, { nonce, aud, sdHash } = {}) {
  const sdJwtWithoutKb = rawSdJwt.endsWith('~') ? rawSdJwt : rawSdJwt + '~';
  const kbJwt = await new jose.SignJWT({
    nonce,
    aud,
    iat: Math.floor(Date.now() / 1000),
    sd_hash: sdHash !== undefined
      ? sdHash
      : crypto.createHash('sha256').update(sdJwtWithoutKb).digest('base64url')
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'kb+jwt' })
    .sign(holderKey);

  return `${sdJwtWithoutKb}${kbJwt}`;
}

async function postPresentation(state, vpToken) {
  const params = new URLSearchParams();
  params.append('state', state);
  params.append('vp_token', typeof vpToken === 'string' ? vpToken : JSON.stringify(vpToken));

  const res = await fetch(`${VERIFIER_URL}/api/oid4vp/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function runTests() {
  console.log('===========================================================');
  console.log('  OID4VP / SD-JWT VC Verifier Cryptographic Test Suite');
  console.log('===========================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // Fetch real credential from Keycloak
  console.log('\n[Setup] Issuing real SD-JWT VC from Keycloak for "ronak"...');
  const { rawSdJwt, holderKey } = await getRealKeycloakCredential('ronak', 'workshop');
  console.log('  -> Received genuine SD-JWT VC credential with cnf.jwk');

  // Test 1: Valid Selective Presentation (only name and company ID) with Holder Key Binding
  console.log('\n[Test 1] Valid Selective Disclosure (only name & company ID) with Key-Binding JWT...');
  const s1 = await createVerifierSession('cart_discount');
  const selectiveSdJwt1 = extractSelectiveSdJwt(rawSdJwt, ['given_name', 'family_name', 'employee_id']);
  const validPresentation = await buildKeyBoundPresentation(selectiveSdJwt1, holderKey, {
    nonce: s1.nonce,
    aud: s1.client_id
  });

  const r1 = await postPresentation(s1.state, { employee_badge: [validPresentation] });
  assert(r1.status === 200, 'Direct Post returns 200 OK');
  assert(r1.data.redirect_uri && r1.data.redirect_uri.includes('verified=true'), 'Redirect URI signals verified=true');

  const stat1 = await fetch(`${VERIFIER_URL}/api/oid4vp/status/${s1.sessionId}`).then(r => r.json());
  assert(stat1.status === 'verified', 'Session status is "verified"');
  assert(stat1.claims && stat1.claims.employee_id === 'ACME-0417', 'Company ID correctly verified (employee_id: ACME-0417)');
  assert(stat1.claims && stat1.claims.given_name === 'Ronak', 'Name correctly verified (given_name: Ronak)');
  assert(stat1.claims && stat1.claims.department === undefined, 'Selective disclosure: department is NOT disclosed');
  assert(stat1.claims && stat1.claims.email === undefined, 'Selective disclosure: email is NOT disclosed');
  assert(stat1.keyBindingVerified === true, 'Holder Key Binding cryptographically verified');

  // Test 2: Replay Attack Protection
  console.log('\n[Test 2] Replay Attack: Re-submitting the same presentation on consumed session...');
  const r2 = await postPresentation(s1.state, { employee_badge: [validPresentation] });
  assert(r2.status === 400, 'Direct Post rejects replay with HTTP 400');
  assert(r2.data.error === 'invalid_request', 'Error response indicates invalid_request (replay protection)');

  // Test 3: Untrusted Issuer Rejection (Mallory Forgery Test)
  console.log('\n[Test 3] Untrusted Issuer: Mallory posting evil issuer credential...');
  const s3 = await createVerifierSession('cart_discount');
  const evilPayload = toB64u({
    iss: 'https://totally-not-keycloak.example/evil',
    vct: 'https://workshop.acme.test/employee-badge',
    _sd: []
  });
  const evilJwt = `eyJhbGciOiJFUzI1NiJ9.${evilPayload}.NOT_A_REAL_SIGNATURE`;
  const evilDisc = toB64u(['salt1', 'employee_id', 'FORGED-0001']);
  const evilSdJwt = `${evilJwt}~${evilDisc}~`;

  const r3 = await postPresentation(s3.state, { employee_badge: [evilSdJwt] });
  assert(r3.status === 400, 'Direct Post rejects untrusted issuer with HTTP 400');
  assert(r3.data.error === 'invalid_presentation', 'Error response indicates invalid_presentation');
  assert(r3.data.error_description && r3.data.error_description.includes('Untrusted issuer'), 'Rejection explicitly names untrusted issuer');

  const stat3 = await fetch(`${VERIFIER_URL}/api/oid4vp/status/${s3.sessionId}`).then(r => r.json());
  assert(stat3.status === 'failed', 'Session status marked "failed"');
  assert(stat3.claims === null, 'No forged claims granted in session');

  // Test 4: Forged Issuer Signature
  console.log('\n[Test 4] Forged Signature: Real issuer URL with dummy signature...');
  const s4 = await createVerifierSession('cart_discount');
  const fakeSigPayload = toB64u({
    iss: 'http://keycloak.localhost:8080/realms/workshop',
    vct: 'https://workshop.acme.test/employee-badge',
    _sd: []
  });
  const fakeSigJwt = `eyJhbGciOiJFUzI1NiJ9.${fakeSigPayload}.NOT_A_REAL_SIGNATURE`;
  const fakeSdJwt = `${fakeSigJwt}~${evilDisc}~`;

  const r4 = await postPresentation(s4.state, { employee_badge: [fakeSdJwt] });
  assert(r4.status === 400, 'Direct Post rejects invalid JWS signature with HTTP 400');
  assert(r4.data.error_description && r4.data.error_description.includes('signature verification failed'), 'Error description reports signature verification failure');

  // Test 5: Tampered Disclosure Digest (Integrity Check)
  console.log('\n[Test 5] Tampered Disclosure: Modifying claim value in real SD-JWT...');
  const s5 = await createVerifierSession('cart_discount');
  const parts = rawSdJwt.split('~');
  const realIssuerJwt = parts[0];
  const tamperedDisc = toB64u(['attackerSalt', 'department', 'Executive Board of Directors']);
  const tamperedSdJwt = `${realIssuerJwt}~${tamperedDisc}~`;

  const r5 = await postPresentation(s5.state, { employee_badge: [tamperedSdJwt] });
  assert(r5.status === 400, 'Direct Post rejects tampered disclosure with HTTP 400');
  assert(r5.data.error_description && r5.data.error_description.includes('Tampered or unlinked disclosure detected'), 'Error description reports disclosure digest mismatch');

  // Test 6: Bearer Replay Attack: Key-bound credential without KB-JWT
  console.log('\n[Test 6] Bearer Replay Attack: Key-bound SD-JWT presented without KB-JWT...');
  const s6 = await createVerifierSession('cart_discount');
  const bearerPresentation = selectiveSdJwt1; // No KB-JWT attached

  const r6 = await postPresentation(s6.state, { employee_badge: [bearerPresentation] });
  assert(r6.status === 400, 'Direct Post rejects unbound presentation with HTTP 400');
  assert(r6.data.error_description && r6.data.error_description.includes('Key-Binding JWT (kb+jwt) is required'), 'Error description reports missing KB-JWT requirement');

  // Test 7: KB-JWT nonce mismatch (stolen presentation replayed into a new session)
  console.log('\n[Test 7] Stale Nonce: KB-JWT bound to a different session nonce...');
  const s7 = await createVerifierSession('cart_discount');
  const stalePresentation = await buildKeyBoundPresentation(rawSdJwt, holderKey, {
    nonce: '0'.repeat(32),          // not the nonce this session issued
    aud: s7.client_id
  });
  const r7 = await postPresentation(s7.state, { employee_badge: [stalePresentation] });
  assert(r7.status === 400, 'Direct Post rejects KB-JWT with foreign nonce (HTTP 400)');
  assert(r7.data.error_description && r7.data.error_description.includes('nonce mismatch'), 'Error description reports nonce mismatch');

  // Test 8: KB-JWT audience mismatch (presentation intended for another verifier)
  console.log('\n[Test 8] Wrong Audience: KB-JWT addressed to a different verifier...');
  const s8 = await createVerifierSession('cart_discount');
  const misaddressed = await buildKeyBoundPresentation(rawSdJwt, holderKey, {
    nonce: s8.nonce,
    aud: 'https://evil.example'
  });
  const r8 = await postPresentation(s8.state, { employee_badge: [misaddressed] });
  assert(r8.status === 400, 'Direct Post rejects KB-JWT with foreign audience (HTTP 400)');
  assert(r8.data.error_description && r8.data.error_description.includes('audience mismatch'), 'Error description reports audience mismatch');

  // Test 9: sd_hash mismatch (KB-JWT lifted onto a different SD-JWT)
  console.log('\n[Test 9] Broken Binding: KB-JWT sd_hash not matching the presented SD-JWT...');
  const s9 = await createVerifierSession('cart_discount');
  const wrongHash = await buildKeyBoundPresentation(rawSdJwt, holderKey, {
    nonce: s9.nonce,
    aud: s9.client_id,
    sdHash: crypto.createHash('sha256').update('some other sd-jwt').digest('base64url')
  });
  const r9 = await postPresentation(s9.state, { employee_badge: [wrongHash] });
  assert(r9.status === 400, 'Direct Post rejects KB-JWT with mismatched sd_hash (HTTP 400)');
  assert(r9.data.error_description && r9.data.error_description.includes('sd_hash mismatch'), 'Error description reports sd_hash mismatch');

  // Test 10: Missing Company ID (employee_id) rejection
  console.log('\n[Test 10] Missing Company ID: Presenting only name without employee_id...');
  const s10 = await createVerifierSession('cart_discount');
  const noEmpIdSdJwt = extractSelectiveSdJwt(rawSdJwt, ['given_name', 'family_name']);
  const noEmpIdPresentation = await buildKeyBoundPresentation(noEmpIdSdJwt, holderKey, {
    nonce: s10.nonce,
    aud: s10.client_id
  });
  const r10 = await postPresentation(s10.state, { employee_badge: [noEmpIdPresentation] });
  assert(r10.status === 400, 'Direct Post rejects presentation missing employee_id (HTTP 400)');
  assert(r10.data.error_description && r10.data.error_description.includes('Missing required claim: employee_id'), 'Rejection explicitly states missing employee_id');

  // Test 11: Missing Name (given_name / family_name) rejection
  console.log('\n[Test 11] Missing Name: Presenting only employee_id without name claims...');
  const s11 = await createVerifierSession('cart_discount');
  const noNameSdJwt = extractSelectiveSdJwt(rawSdJwt, ['employee_id']);
  const noNamePresentation = await buildKeyBoundPresentation(noNameSdJwt, holderKey, {
    nonce: s11.nonce,
    aud: s11.client_id
  });
  const r11 = await postPresentation(s11.state, { employee_badge: [noNamePresentation] });
  assert(r11.status === 400, 'Direct Post rejects presentation missing name (HTTP 400)');
  assert(r11.data.error_description && r11.data.error_description.includes('Missing required claim: name'), 'Rejection explicitly states missing name');

  console.log('\n===========================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('===========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
