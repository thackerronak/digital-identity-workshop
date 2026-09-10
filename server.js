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

// In-memory session tracking
const sessions = new Map();
const stateToSessionId = new Map();

// Helper to decode Base64Url
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

// Parse SD-JWT disclosures
function parseSdJwt(sdJwtString) {
  const parts = sdJwtString.split('~');
  const issuerJwt = parts[0];
  const disclosures = parts.slice(1);

  // Parse Issuer payload
  let issuerPayload = {};
  try {
    const payloadSegment = issuerJwt.split('.')[1];
    issuerPayload = JSON.parse(base64UrlDecode(payloadSegment));
  } catch (e) {
    console.warn('[Verifier] Could not parse issuer JWT payload:', e.message);
  }

  const claims = {};
  for (const disc of disclosures) {
    if (!disc) continue;
    try {
      const decoded = JSON.parse(base64UrlDecode(disc));
      if (Array.isArray(decoded) && decoded.length >= 3) {
        const claimName = decoded[1];
        const claimValue = decoded[2];
        claims[claimName] = claimValue;
      }
    } catch (e) {
      // Might be key binding JWT at the very end
    }
  }

  return {
    issuerPayload,
    disclosedClaims: claims
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
    let requestedClaims = [
      { path: ['employee_id'] },
      { path: ['department'] },
      { path: ['given_name'] },
      { path: ['family_name'] },
      { path: ['email'] }
    ];

    if (useCase === 'building_access') {
      requestedClaims = [
        { path: ['employee_id'] },
        { path: ['given_name'] },
        { path: ['family_name'] },
        { path: ['department'] }
      ];
    } else if (useCase === 'it_access') {
      requestedClaims = [
        { path: ['email'] },
        { path: ['employee_id'] },
        { path: ['department'] }
      ];
    }

    const dcqlQuery = {
      credentials: [
        {
          id: 'employee_badge',
          format: 'dc+sd-jwt',
          meta: {
            vct_values: ['https://workshop.acme.test/employee-badge']
          },
          claims: requestedClaims
        }
      ]
    };

    const requestPayload = {
      client_id: 'x509_san_dns:verifier.localhost',
      response_uri: `${PUBLIC_URL}/api/oid4vp/response`,
      response_mode: 'direct_post',
      nonce,
      state,
      client_metadata: {
        client_name: 'Google Store & Corporate Portal',
        vp_formats_supported: {
          'dc+sd-jwt': {
            sd_jwt_alg_values: ['ES256']
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
      claims: null
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
app.post('/api/oid4vp/response', (req, res) => {
  try {
    const { vp_token, state, presentation_submission } = req.body;
    console.log('[Verifier] Received Direct Post response for state:', state);

    if (!state) {
      return res.status(400).json({ error: 'Missing state parameter' });
    }

    const sessionId = stateToSessionId.get(state);
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({ error: 'Unknown or expired session state' });
    }

    const session = sessions.get(sessionId);

    // Extract SD-JWT VC
    let rawVp = vp_token;
    if (typeof vp_token === 'string' && (vp_token.startsWith('{') || vp_token.startsWith('['))) {
      try {
        const parsed = JSON.parse(vp_token);
        if (parsed.employee_badge && Array.isArray(parsed.employee_badge)) {
          rawVp = parsed.employee_badge[0];
        } else if (Array.isArray(parsed)) {
          rawVp = parsed[0];
        }
      } catch (e) {}
    }

    // Parse claims
    const { issuerPayload, disclosedClaims } = parseSdJwt(rawVp);
    console.log('[Verifier] Disclosed claims:', disclosedClaims);

    session.status = 'verified';
    session.claims = {
      ...disclosedClaims,
      iss: issuerPayload.iss,
      vct: issuerPayload.vct
    };
    session.verifiedAt = Date.now();

    const origin = session.returnOrigin || PUBLIC_URL;
    const tab = session.useCase === 'cart_discount' ? 'cart' : (session.useCase || 'cart');
    const redirectUri = `${origin}/?session_id=${sessionId}&verified=true&tab=${tab}`;

    // Standard OID4VP direct_post response: return redirect_uri for wwWallet to navigate back
    res.json({
      redirect_uri: redirectUri
    });
  } catch (err) {
    console.error('[Verifier] Error processing response:', err);
    res.status(500).json({ error: err.message });
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
