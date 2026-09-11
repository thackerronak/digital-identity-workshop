/* Issuer page: PKCE login against Keycloak, then mint credential offers.
 *
 * Supports both Google Employee Badge and Lilavati Hospital Medical Certificate
 * on the same page.
 */
'use strict';

const WALLET_URL = 'http://localhost:3001/';

const REALM = 'workshop';
const CLIENT_ID = 'workshop-badge';
const SCOPES = 'openid profile employee-badge medical-certificate';

const CREDENTIALS = {
  'employee-badge': {
    id: 'employee-badge',
    title: 'Google Employee Badge',
    desc: 'Verified corporate identity credential for building access and discounts.',
    format: 'dc+sd-jwt'
  },
  'medical-certificate': {
    id: 'medical-certificate',
    title: 'Lilavati Hospital Medical Certificate',
    desc: 'Official medical fitness & health record certificate issued by Lilavati Hospital & Research Centre.',
    format: 'dc+sd-jwt'
  }
};

let currentAccessToken = null;
let currentClaims = null;
let currentCredential = 'employee-badge';

const ORIGIN = window.location.origin;
const REALM_BASE = `${ORIGIN}/realms/${REALM}`;
const REDIRECT_URI = `${ORIGIN}/`;

const $ = (id) => document.getElementById(id);
const show = (which) => {
  for (const s of ['step-login', 'step-offer', 'step-error']) $(s).hidden = s !== which;
};
const fail = (msg, logoutUrl) => {
  $('error').textContent = String(msg);
  const btn = $('clear-state');
  btn.hidden = !logoutUrl;
  if (logoutUrl) btn.onclick = () => window.location.assign(logoutUrl);
  show('step-error');
};

/* ---------- PKCE helpers ---------- */

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const randomVerifier = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

async function startLogin() {
  const verifier = randomVerifier();
  sessionStorage.setItem('pkce_verifier', verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    response_mode: 'fragment',
    prompt: 'login',
  });
  window.location.assign(`${REALM_BASE}/protocol/openid-connect/auth?${params}`);
}

async function exchangeCode(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');
  if (!verifier) throw new Error('Missing PKCE verifier - please start again.');

  const res = await fetch(`${REALM_BASE}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const body = await res.json();
  console.log('[issuer] token response', res.status, body.error || 'ok');
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

/* ---------- offer minting ---------- */

async function mintOffer(accessToken, credentialId = 'employee-badge') {
  const params = new URLSearchParams({
    credential_configuration_id: credentialId,
    pre_authorized: 'true',
    type: 'uri_qr',
  });
  const res = await fetch(`${REALM_BASE}/protocol/oid4vc/create-credential-offer?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Offer creation failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

async function render(offer, claims, credentialId = 'employee-badge') {
  const credInfo = CREDENTIALS[credentialId] || CREDENTIALS['employee-badge'];
  
  if ($('cred-banner-title')) $('cred-banner-title').textContent = credInfo.title;
  if ($('cred-banner-desc')) $('cred-banner-desc').textContent = credInfo.desc;
  if ($('cred-format-tag')) $('cred-format-tag').textContent = credInfo.format;

  // `issuer` is already the credential-offer base path; the nonce identifies
  // this particular offer.
  const offerUrl = `${offer.issuer}/${offer.nonce}`;

  const byReference =
    `openid-credential-offer://?${new URLSearchParams({ credential_offer_uri: offerUrl })}`;

  const doc = await fetch(offerUrl).then((r) => r.json());
  const byValue =
    `openid-credential-offer://?${new URLSearchParams({ credential_offer: JSON.stringify(doc) })}`;

  const displayName = claims.name ? `${claims.name} (${claims.preferred_username || ''})` : (claims.preferred_username || 'employee');
  $('who').textContent = displayName;
  $('open-wallet').href =
    `${WALLET_URL}?${new URLSearchParams({ credential_offer: JSON.stringify(doc) })}`;
  $('uri').value = byValue;
  $('uri-ref').value = byReference;
  if (offer.qr_code) $('qr').src = offer.qr_code;
  $('offer-json').textContent = JSON.stringify(doc, null, 2);
  show('step-offer');
}

async function selectCredential(credentialId) {
  if (!currentAccessToken) return;
  currentCredential = credentialId;

  const tabEmp = $('tab-employee-badge');
  const tabMed = $('tab-medical-certificate');
  if (tabEmp) tabEmp.classList.toggle('active', credentialId === 'employee-badge');
  if (tabMed) tabMed.classList.toggle('active', credentialId === 'medical-certificate');

  try {
    $('open-wallet').textContent = 'Generating offer...';
    const offer = await mintOffer(currentAccessToken, credentialId);
    $('open-wallet').textContent = 'Open in my wallet →';
    await render(offer, currentClaims, credentialId);
  } catch (err) {
    $('open-wallet').textContent = 'Open in my wallet →';
    fail(`Failed to generate offer for ${credentialId}: ${err.message}`);
  }
}

function decodeJwtPayload(jwt) {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(part.length + ((4 - part.length % 4) % 4), '=')));
  } catch { return {}; }
}

/* ---------- wiring ---------- */

async function main() {
  $('login').addEventListener('click', () => startLogin().catch(fail));
  $('retry').addEventListener('click', () => window.location.assign(REDIRECT_URI));
  $('again').addEventListener('click', () => selectCredential(currentCredential).catch(fail));

  const tabEmp = $('tab-employee-badge');
  if (tabEmp) {
    tabEmp.addEventListener('click', () => {
      if (currentCredential !== 'employee-badge') {
        selectCredential('employee-badge').catch(fail);
      }
    });
  }

  const tabMed = $('tab-medical-certificate');
  if (tabMed) {
    tabMed.addEventListener('click', () => {
      if (currentCredential !== 'medical-certificate') {
        selectCredential('medical-certificate').catch(fail);
      }
    });
  }

  $('copy').addEventListener('click', async () => {
    $('uri').select();
    try {
      await navigator.clipboard.writeText($('uri').value);
      $('copy').textContent = 'Copied';
      setTimeout(() => ($('copy').textContent = 'Copy offer link'), 1500);
    } catch {
      document.execCommand('copy');
    }
  });

  const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = frag.get('code');
  const error = frag.get('error');

  if (error) {
    const detail = frag.get('error_description') || '';
    if (/authentication_expired|already_logged_in|session/i.test(`${error} ${detail}`)) {
      const logout = `${REALM_BASE}/protocol/openid-connect/logout?` + new URLSearchParams({
        client_id: CLIENT_ID,
        post_logout_redirect_uri: REDIRECT_URI,
      });
      return fail(`${error}: ${detail}\n\n` +
        'Stale sign-in state from a Keycloak restart. Click "Clear sign-in state" ' +
        'below and try again.', logout);
    }
    return fail(`${error}: ${detail}`);
  }
  if (!code) return show('step-login');

  const seen = sessionStorage.getItem('used_code');
  if (seen === code) return fail('This sign-in link was already used. Click Start again.');
  sessionStorage.setItem('used_code', code);

  window.history.replaceState({}, '', REDIRECT_URI);
  console.log('[issuer] exchanging code', code.slice(0, 12) + '...');
  try {
    const token = await exchangeCode(code);
    currentAccessToken = token.access_token;
    currentClaims = decodeJwtPayload(token.access_token);
    const offer = await mintOffer(currentAccessToken, currentCredential);
    await render(offer, currentClaims, currentCredential);
  } catch (e) {
    fail(e.message || e);
  }
}

main().catch(fail);
