/* Issuer page: PKCE login against Keycloak, then mint a credential offer.
 *
 * Entirely client-side and served by Keycloak itself (custom welcome theme),
 * so it runs on the issuer's own origin -- no backend, no service account, no
 * CORS. The employee's own access token is what authorises the offer.
 */
'use strict';

// Where the holder lives. Accepts an offer via its query string
// (it acts on `credential_offer` / `credential_offer_uri`),
// so we can hand the credential over with a single link.
const WALLET_URL = 'http://localhost:3001/';

const REALM = 'workshop';
const CLIENT_ID = 'workshop-badge';
const CREDENTIAL = 'employee-badge';

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
    // The credential scope must be requested here, or the resulting token
    // cannot authorise an offer for it.
    scope: `openid profile ${CREDENTIAL}`,
    redirect_uri: REDIRECT_URI,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    // Fragment, not query. Keycloak's welcome page (which serves this very
    // page at /) answers any request carrying a query string with a 303 that
    // appends a trailing slash to it:
    //     GET /?code=abc&session_state=x
    //     303 Location: /?code=abc&session_state=x/
    // That rewrite corrupts the OAuth response before this page can read it.
    // A fragment is never sent to the server, so `GET /` stays clean.
    response_mode: 'fragment',
    // Always authenticate afresh. Two reasons:
    //  * The demo is ABOUT the password step, so showing it every time is right.
    //  * Keycloak here has no persistent session store (no DB volume), so a
    //    restart orphans the browser's KC cookies and a silent re-use of that
    //    state fails with `temporarily_unavailable: authentication_expired`
    //    or `already_logged_in`. Forcing login sidesteps stale state entirely.
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

async function mintOffer(accessToken) {
  const params = new URLSearchParams({
    credential_configuration_id: CREDENTIAL,
    // Pre-authorized: the wallet needs no client registration or redirect URI.
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

async function render(offer, claims) {
  // `issuer` is already the credential-offer base path; the nonce identifies
  // this particular offer.
  const offerUrl = `${offer.issuer}/${offer.nonce}`;

  // Two equivalent handover forms. Wallets differ in which they accept:
  // by reference makes the wallet fetch the document; by value embeds it.
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
  $('again').addEventListener('click', () => window.location.assign(REDIRECT_URI));
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

  // The authorization response arrives in the fragment (see response_mode above).
  const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = frag.get('code');
  const error = frag.get('error');

  if (error) {
    const detail = frag.get('error_description') || '';
    // Stale Keycloak login state (typically after the container restarted).
    // Recoverable: clear it with an RP-initiated logout, then start over.
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

  // An authorization code is single-use. Guard against the page running the
  // exchange twice (bfcache restore, double load), which would burn the code
  // and surface a confusing invalid_grant.
  const seen = sessionStorage.getItem('used_code');
  if (seen === code) return fail('This sign-in link was already used. Click Start again.');
  sessionStorage.setItem('used_code', code);

  // Clean the code out of the address bar so a refresh does not re-use it.
  window.history.replaceState({}, '', REDIRECT_URI);
  console.log('[issuer] exchanging code', code.slice(0, 12) + '...');
  try {
    const token = await exchangeCode(code);
    const offer = await mintOffer(token.access_token);
    await render(offer, decodeJwtPayload(token.access_token));
  } catch (e) {
    fail(e.message || e);
  }
}

main().catch(fail);
