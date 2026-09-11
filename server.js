const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jose = require('jose');

const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://verifier.localhost:4000';
const WALLET_URL = process.env.WALLET_URL || 'http://localhost:3001';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Load verifier EC private key and X.509 certificate
const keyPath = path.join(__dirname, 'keys', 'verifier.key');
const certPath = path.join(__dirname, 'keys', 'verifier.crt');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('Missing verifier.key or verifier.crt in keys/ directory!');
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
const certPem = fs.readFileSync(certPath, 'utf8');
const certDerBase64 = certPem
  .replace(/-----BEGIN CERTIFICATE-----/, '')
  .replace(/-----END CERTIFICATE-----/, '')
  .replace(/\s+/g, '');

let privateKey = null;
(async () => {
  try {
    privateKey = await jose.importPKCS8(privateKeyPem, 'ES256');
    console.log('[Verifier] Cryptographic keys & X.509 certificates loaded successfully.');
  } catch (err) {
    console.error('[Verifier] Failed to import private key:', err);
  }
})();

// Configuration & Trusted Authorities
const KEYCLOAK_INTERNAL_URL = process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak.localhost:8080';
const TRUSTED_ISSUERS = (process.env.TRUSTED_ISSUERS || 'http://keycloak.localhost:8080/realms/workshop,http://localhost:8080/realms/workshop')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const TRUSTED_VCTS = (process.env.TRUSTED_VCTS || 'https://workshop.acme.test/employee-badge,https://lilavati.example/medical-certificate')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const REQUIRE_KEY_BINDING = process.env.REQUIRE_KEY_BINDING !== 'false';

// In-memory session tracking
const sessions = new Map();
const stateToSessionId = new Map();

// Remote JWKS Cache
const jwksCache = new Map();
function getJwksForIssuer(iss) {
  if (!TRUSTED_ISSUERS.includes(iss)) {
    throw new Error(`Untrusted issuer: "${iss}". Allowed trusted issuers: ${TRUSTED_ISSUERS.join(', ')}`);
  }
  if (!jwksCache.has(iss)) {
    // Map localhost to internal docker network alias if running in container
    const fetchUrl = iss.replace('http://localhost:8080', KEYCLOAK_INTERNAL_URL) + '/protocol/openid-connect/certs';
    console.log(`[Verifier] Initializing JWKS for issuer "${iss}" via ${fetchUrl}`);
    jwksCache.set(iss, jose.createRemoteJWKSet(new URL(fetchUrl)));
  }
  return jwksCache.get(iss);
}

// Helper to decode Base64Url
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Spec-compliant SD-JWT VC Presentation Verification Engine:
 * 1. Unpacks SD-JWT presentation: Issuer-JWT ~ Disclosures ~ [KB-JWT]
 * 2. Validates Issuer JWT signature against Keycloak JWKS and checks trusted issuer & vct
 * 3. Recomputes SHA-256 digests of all presented disclosures against payload._sd
 * 4. Verifies Holder Key-Binding JWT (KB-JWT) against cnf.jwk, validating nonce, aud, and sd_hash
 */
async function verifySdJwtPresentation(rawVp, session) {
  if (!rawVp || typeof rawVp !== 'string') {
    throw new Error('Missing or invalid vp_token format');
  }

  const parts = rawVp.split('~');
  if (parts.length < 2) {
    throw new Error('Invalid SD-JWT structure: expected at least issuer JWT and disclosure separator');
  }

  const issuerJwt = parts[0];
  const lastPart = parts[parts.length - 1];

  let kbJwt = null;
  let rawDisclosures = [];
  let sdJwtWithoutKb = '';

  // A trailing item with 3 dot-separated parts is the Key-Binding JWT
  if (lastPart && lastPart.split('.').length === 3) {
    kbJwt = lastPart;
    rawDisclosures = parts.slice(1, parts.length - 1);
    sdJwtWithoutKb = parts.slice(0, parts.length - 1).join('~') + '~';
  } else {
    rawDisclosures = parts.slice(1);
    sdJwtWithoutKb = parts.join('~');
    if (!sdJwtWithoutKb.endsWith('~')) {
      sdJwtWithoutKb += '~';
    }
  }

  // Filter empty disclosures (e.g. trailing ~)
  rawDisclosures = rawDisclosures.filter(d => d && d.trim().length > 0);

  // 1. Decode unverified header/payload to identify the issuer
  let unverifiedPayload;
  let unverifiedHeader;
  try {
    unverifiedHeader = jose.decodeProtectedHeader(issuerJwt);
    unverifiedPayload = jose.decodeJwt(issuerJwt);
  } catch (err) {
    throw new Error(`Malformed Issuer JWT: ${err.message}`);
  }

  const iss = unverifiedPayload.iss;
  if (!iss) {
    throw new Error('Issuer JWT missing "iss" claim');
  }

  // 2. Resolve JWKS and cryptographically verify Issuer JWT
  const jwks = getJwksForIssuer(iss);
  let verified;
  try {
    verified = await jose.jwtVerify(issuerJwt, jwks, {
      issuer: iss,
      algorithms: ['ES256', 'RS256']
    });
  } catch (err) {
    throw new Error(`Issuer signature verification failed: ${err.message}`);
  }

  const issuerPayload = verified.payload;

  // 3. Verify Verifiable Credential Type (vct)
  if (issuerPayload.vct && !TRUSTED_VCTS.includes(issuerPayload.vct)) {
    throw new Error(`Unexpected verifiable credential type (vct): "${issuerPayload.vct}", expected one of [${TRUSTED_VCTS.join(', ')}]`);
  }

  // 4. Verify Disclosures against _sd digests
  const sdAlg = (issuerPayload._sd_alg || 'sha-256').toLowerCase();
  if (sdAlg !== 'sha-256') {
    throw new Error(`Unsupported _sd_alg: ${sdAlg}`);
  }

  const validDigests = new Set(Array.isArray(issuerPayload._sd) ? issuerPayload._sd : []);
  const disclosedClaims = {};

  for (const disc of rawDisclosures) {
    // Recompute digest: base64url(sha256(raw_disclosure_string))
    const digest = crypto.createHash('sha256').update(disc).digest('base64url');
    if (!validDigests.has(digest)) {
      throw new Error(`Tampered or unlinked disclosure detected (digest mismatch: ${digest})`);
    }

    try {
      const decoded = JSON.parse(base64UrlDecode(disc));
      if (Array.isArray(decoded) && decoded.length >= 3) {
        const claimName = decoded[1];
        const claimValue = decoded[2];
        disclosedClaims[claimName] = claimValue;
      }
    } catch (err) {
      throw new Error(`Malformed disclosure JSON: ${err.message}`);
    }
  }

  // 5. Enforce required claims & filter to requested selective disclosures
  const allowedClaims = new Set([
    'employee_id',
    'patient_id',
    'given_name',
    'family_name',
    'hospital_name',
    'medical_record_number',
    'fitness_status',
    'blood_group',
    'physician_name'
  ]);
  const validatedClaims = {};
  for (const [k, v] of Object.entries(disclosedClaims)) {
    if (allowedClaims.has(k)) {
      validatedClaims[k] = v;
    }
  }

  // Type-specific or use-case-specific claim requirement enforcement:
  const isMedicalCert = issuerPayload.vct === 'https://lilavati.example/medical-certificate';
  const isEmployeeBadge = issuerPayload.vct === 'https://workshop.acme.test/employee-badge';

  if (isMedicalCert) {
    if (!validatedClaims.fitness_status) {
      throw new Error('Missing required claim: fitness_status');
    }
  } else if (isEmployeeBadge || session.useCase === 'cart_discount') {
    const idClaim = validatedClaims.employee_id || validatedClaims.patient_id;
    if (!idClaim) {
      throw new Error('Missing required claim: employee_id');
    }
    // Standardize ID claim so downstream consumers always find employee_id
    if (!validatedClaims.employee_id && validatedClaims.patient_id) {
      validatedClaims.employee_id = validatedClaims.patient_id;
    }
    if (!validatedClaims.given_name && !validatedClaims.family_name) {
      throw new Error('Missing required claim: name (given_name / family_name)');
    }
  } else {
    // Generic fallback for any other credential
    const idClaim = validatedClaims.employee_id || validatedClaims.patient_id;
    if (!idClaim && !validatedClaims.fitness_status) {
      throw new Error('Missing required claim: employee_id or fitness_status');
    }
  }

  // 6. Key-Binding JWT Verification
  let keyBindingVerified = false;
  if (kbJwt) {
    if (!issuerPayload.cnf || !issuerPayload.cnf.jwk) {
      throw new Error('Presentation includes Key-Binding JWT, but credential has no cnf.jwk');
    }

    let holderKey;
    try {
      holderKey = await jose.importJWK(issuerPayload.cnf.jwk, 'ES256');
    } catch (err) {
      throw new Error(`Failed to import holder key from cnf.jwk: ${err.message}`);
    }

    let kbResult;
    try {
      kbResult = await jose.jwtVerify(kbJwt, holderKey, {
        algorithms: ['ES256']
      });
    } catch (err) {
      throw new Error(`Key-Binding JWT signature verification failed: ${err.message}`);
    }

    if (kbResult.protectedHeader.typ !== 'kb+jwt') {
      throw new Error(`Invalid Key-Binding JWT header typ: "${kbResult.protectedHeader.typ}", expected "kb+jwt"`);
    }

    // Strict nonce check against verifier session
    if (kbResult.payload.nonce !== session.nonce) {
      throw new Error(`Key-Binding JWT nonce mismatch (replay or expired session). Expected "${session.nonce}", got "${kbResult.payload.nonce}"`);
    }

    // Verify audience
    const expectedAud = ['x509_san_dns:verifier.localhost', 'verifier.localhost', session.clientId || 'x509_san_dns:verifier.localhost'];
    const kbAud = Array.isArray(kbResult.payload.aud) ? kbResult.payload.aud : [kbResult.payload.aud];
    const audMatch = kbAud.some(a => expectedAud.includes(a));
    if (!audMatch) {
      throw new Error(`Key-Binding JWT audience mismatch: "${kbResult.payload.aud}"`);
    }

    // Verify sd_hash integrity if present
    if (kbResult.payload.sd_hash) {
      const expectedSdHash = crypto.createHash('sha256').update(sdJwtWithoutKb).digest('base64url');
      if (kbResult.payload.sd_hash !== expectedSdHash) {
        throw new Error('Key-Binding JWT sd_hash mismatch with presented SD-JWT');
      }
    }

    keyBindingVerified = true;
  } else if (REQUIRE_KEY_BINDING || (issuerPayload.cnf && issuerPayload.cnf.jwk)) {
    throw new Error('Key-Binding JWT (kb+jwt) is required for key-bound credentials, but none was provided');
  }

  return {
    issuerPayload,
    disclosedClaims: validatedClaims,
    keyBindingVerified
  };
}

// 1. Create OID4VP Session
app.post('/api/oid4vp/session', async (req, res) => {
  try {
    if (!privateKey) {
      privateKey = await jose.importPKCS8(privateKeyPem, 'ES256');
    }

    const { useCase = 'cart_discount', returnOrigin } = req.body;
    const sessionId = crypto.randomUUID();
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = crypto.randomBytes(16).toString('hex');

    // Select query depending on use case
    let dcqlQuery;
    let clientName = 'Google Store & Corporate Portal';

    if (useCase === 'term_plan') {
      clientName = 'Corporate Term Life Insurance Underwriting Portal';
      dcqlQuery = {
        credentials: [
          {
            id: 'employee_badge',
            format: 'dc+sd-jwt',
            meta: {
              vct_values: ['https://workshop.acme.test/employee-badge']
            },
            claims: [
              { path: ['given_name'] },
              { path: ['family_name'] },
              { path: ['employee_id'] }
            ]
          },
          {
            id: 'medical_certificate',
            format: 'dc+sd-jwt',
            meta: {
              vct_values: ['https://lilavati.example/medical-certificate']
            },
            claims: [
              { path: ['fitness_status'] },
              { path: ['blood_group'] },
              { path: ['hospital_name'] },
              { path: ['medical_record_number'] },
              { path: ['physician_name'] },
              { path: ['patient_id'] }
            ]
          }
        ]
      };
    } else {
      // Default: cart_discount
      const requestedClaims = [
        { path: ['given_name'] },
        { path: ['family_name'] },
        { path: ['employee_id'] }
      ];

      dcqlQuery = {
        credentials: [
          {
            id: 'employee_badge',
            format: 'dc+sd-jwt',
            meta: {
              vct_values: TRUSTED_VCTS
            },
            claims: requestedClaims
          }
        ]
      };
    }

    const requestPayload = {
      client_id: 'x509_san_dns:verifier.localhost',
      response_uri: `${PUBLIC_URL}/api/oid4vp/response`,
      response_mode: 'direct_post',
      nonce,
      state,
      client_metadata: {
        client_name: clientName,
        vp_formats_supported: {
          'dc+sd-jwt': {
            sd_jwt_alg_values: ['ES256'],
            kb_jwt_alg_values: ['ES256']
          }
        }
      },
      dcql_query: dcqlQuery
    };

    const requestJwt = await new jose.SignJWT(requestPayload)
      .setProtectedHeader({
        alg: 'ES256',
        typ: 'oauth-authz-req+jwt',
        x5c: [certDerBase64]
      })
      .sign(privateKey);

    const sessionData = {
      sessionId,
      nonce,
      state,
      useCase,
      returnOrigin,
      status: 'pending',
      requestJwt,
      createdAt: Date.now(),
      claims: null,
      error: null,
      keyBindingVerified: false,
      requestedClaims: ['given_name', 'family_name', 'employee_id']
    };

    sessions.set(sessionId, sessionData);
    stateToSessionId.set(state, sessionId);

    const requestUri = `${PUBLIC_URL}/api/oid4vp/request/${sessionId}`;
    const walletAuthUrl = `${WALLET_URL}/?client_id=x509_san_dns:verifier.localhost&request_uri=${encodeURIComponent(requestUri)}`;

    res.json({
      sessionId,
      state,
      requestUri,
      walletAuthUrl
    });
  } catch (err) {
    console.error('[Verifier] Error creating session:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Serve Request Object JWT to wwWallet
app.get('/api/oid4vp/request/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).send('Session not found or expired');
  }

  res.setHeader('Content-Type', 'application/oauth-authz-req+jwt');
  res.send(session.requestJwt);
});

// 3. Direct Post receiver from wwWallet
app.post('/api/oid4vp/response', async (req, res) => {
  try {
    const { vp_token, state, presentation_submission } = req.body;
    console.log('[Verifier] Received Direct Post response for state:', state);

    if (!state) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing state parameter' });
    }

    const sessionId = stateToSessionId.get(state);
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({ error: 'invalid_request', error_description: 'Unknown or expired session state' });
    }

    const session = sessions.get(sessionId);

    // Replay protection: single-use session
    if (session.status === 'verified') {
      console.warn('[Verifier] Replay detected! Session already verified:', sessionId);
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Session has already been verified (replay attack protection).'
      });
    }

    // Extract SD-JWT VC presentations from vp_token
    let presentationsToVerify = [];
    if (typeof vp_token === 'string' && (vp_token.startsWith('{') || vp_token.startsWith('['))) {
      try {
        const parsed = JSON.parse(vp_token);
        if (parsed.employee_badge && Array.isArray(parsed.employee_badge)) {
          presentationsToVerify.push(...parsed.employee_badge);
        }
        if (parsed.medical_certificate && Array.isArray(parsed.medical_certificate)) {
          presentationsToVerify.push(...parsed.medical_certificate);
        }
        if (presentationsToVerify.length === 0 && Array.isArray(parsed)) {
          presentationsToVerify = parsed;
        }
      } catch (e) {}
    }
    if (presentationsToVerify.length === 0) {
      presentationsToVerify = [vp_token];
    }

    // Spec-compliant cryptographic verification across all presented credentials
    const combinedDisclosedClaims = {};
    const presentedVcts = [];
    let allKeyBindingVerified = true;

    try {
      for (const token of presentationsToVerify) {
        const result = await verifySdJwtPresentation(token, session);
        Object.assign(combinedDisclosedClaims, result.disclosedClaims);
        if (result.issuerPayload.vct) presentedVcts.push(result.issuerPayload.vct);
        if (!result.keyBindingVerified) allKeyBindingVerified = false;
      }
    } catch (verifyErr) {
      console.error(`[Verifier] Cryptographic verification FAILED for session ${sessionId}:`, verifyErr.message);
      session.status = 'failed';
      session.error = verifyErr.message;
      session.failedAt = Date.now();

      const origin = session.returnOrigin || PUBLIC_URL;
      const tab = session.useCase === 'term_plan' ? 'term_plan' : 'cart';
      const failRedirectUri = `${origin}/?session_id=${sessionId}&verified=false&error=${encodeURIComponent(verifyErr.message)}&tab=${tab}`;

      return res.status(400).json({
        error: 'invalid_presentation',
        error_description: verifyErr.message,
        redirect_uri: failRedirectUri
      });
    }

    console.log('[Verifier] Cryptographic verification SUCCESSFUL for session:', sessionId);
    console.log('[Verifier] Disclosed claims:', combinedDisclosedClaims);
    console.log('[Verifier] Holder Key Binding verified:', allKeyBindingVerified);

    // Dynamic health-based Term Plan quote calculation
    let termPlanQuote = null;
    const isFit = (combinedDisclosedClaims.fitness_status || '').toLowerCase().includes('fit');
    if (session.useCase === 'term_plan' || combinedDisclosedClaims.fitness_status) {
      if (isFit) {
        termPlanQuote = {
          eligibility: 'Pre-Approved (Preferred Platinum Tier)',
          coverageAmount: '$2,000,000',
          basePremium: 65.00,
          discountAmount: 40.00,
          finalMonthlyPremium: 25.00,
          corporateSubsidyPct: '60%',
          healthRating: 'Super Preferred (Fit for Duty)',
          medicalExamWaiver: 'Approved (Certified by Lilavati Hospital)',
          hospitalName: combinedDisclosedClaims.hospital_name || 'Lilavati Hospital & Research Centre',
          physicianName: combinedDisclosedClaims.physician_name || 'Dr. P. Deshmukh, MD',
          bloodGroup: combinedDisclosedClaims.blood_group || 'Verified',
          medicalRecordNumber: combinedDisclosedClaims.medical_record_number || 'LH-VERIFIED',
          termLength: '20-Year Guaranteed Level Term'
        };
      } else {
        termPlanQuote = {
          eligibility: 'Standard Approval',
          coverageAmount: '$1,000,000',
          basePremium: 75.00,
          discountAmount: 25.00,
          finalMonthlyPremium: 50.00,
          corporateSubsidyPct: '33%',
          healthRating: 'Standard Health Tier',
          medicalExamWaiver: 'Conditional',
          hospitalName: combinedDisclosedClaims.hospital_name || 'Lilavati Hospital',
          physicianName: combinedDisclosedClaims.physician_name || 'Attending Physician',
          bloodGroup: combinedDisclosedClaims.blood_group || 'Verified',
          medicalRecordNumber: combinedDisclosedClaims.medical_record_number || 'Verified',
          termLength: '10-Year Level Term'
        };
      }
    }

    session.status = 'verified';
    session.claims = {
      ...combinedDisclosedClaims,
      vcts: presentedVcts,
      termPlanQuote
    };
    session.keyBindingVerified = allKeyBindingVerified;
    session.verifiedAt = Date.now();

    const origin = session.returnOrigin || PUBLIC_URL;
    const tab = session.useCase === 'term_plan' ? 'term_plan' : 'cart';
    const redirectUri = `${origin}/?session_id=${sessionId}&verified=true&tab=${tab}`;

    // Standard OID4VP direct_post response: return redirect_uri for wwWallet to navigate back
    res.json({
      redirect_uri: redirectUri
    });
  } catch (err) {
    console.error('[Verifier] Error processing response:', err);
    res.status(500).json({ error: 'server_error', error_description: err.message });
  }
});

// 4. Session status endpoint for polling or page refresh
app.get('/api/oid4vp/status/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    sessionId: session.sessionId,
    status: session.status,
    useCase: session.useCase,
    claims: session.claims,
    error: session.error || null,
    keyBindingVerified: session.keyBindingVerified || false,
    verifiedAt: session.verifiedAt
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  ACME Multi-Use Verifier Portal running on:`);
  console.log(`  Public URL: ${PUBLIC_URL}`);
  console.log(`  Port:       ${PORT}`);
  console.log(`  Wallet:     ${WALLET_URL}`);
  console.log(`====================================================`);
});
