#!/usr/bin/env node
/**
 * One-shot Keycloak bootstrap for the workshop realm (Node.js).
 * 
 * Configures OID4VCI credential scopes and encryption keys, ensuring
 * standard and compliant Keycloak metadata and user credential entitlements.
 * Zero external npm dependencies (uses native Node 18+ fetch).
 */

const fs = require('fs');

const KC = process.env.KC_URL || 'http://keycloak:8080';
const REALM = process.env.KC_REALM || 'workshop';
const ADMIN = process.env.KC_ADMIN || 'admin';
const PASSWORD = process.env.KC_ADMIN_PASSWORD || 'admin';
const SCOPE = process.env.CREDENTIAL_SCOPE || 'employee-badge';
const SCOPES_FILE = process.env.CREDENTIAL_SCOPES_FILE || '/credential-scopes.json';
const CLIENT_ID = process.env.OID4VCI_CLIENT_ID || 'workshop-badge';
const USERS = (process.env.DEMO_USERS || 'ronak,raj,milan')
  .split(',')
  .map(u => u.trim())
  .filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, options = {}) {
  const { token, body, form } = options;
  const url = `${KC}${path}`;
  const headers = {};

  let requestBody;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    requestBody = new URLSearchParams(form).toString();
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: requestBody,
    });

    const raw = await res.text();
    let data = {};
    if (raw && raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = raw;
      }
    } else {
      data = raw;
    }

    return { status: res.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function waitForKeycloak(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    const { status } = await call('GET', `/realms/${REALM}/.well-known/openid-configuration`);
    if (status === 200) {
      return;
    }
    await sleep(2000);
  }
  console.error(`!! ${KC} realm '${REALM}' never became reachable`);
  process.exit(1);
}

async function ensureCredentialScopes(token) {
  let wanted = [];
  try {
    const fileContent = fs.readFileSync(SCOPES_FILE, 'utf8');
    wanted = JSON.parse(fileContent);
  } catch (err) {
    console.log(`   (no ${SCOPES_FILE}; skipping scope creation)`);
    return;
  }

  const { data: existing } = await call('GET', `/admin/realms/${REALM}/client-scopes`, { token });
  const byName = Array.isArray(existing)
    ? Object.fromEntries(existing.map((s) => [s.name, s]))
    : {};

  const { status: clientStatus, data: clients } = await call(
    'GET',
    `/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`,
    { token }
  );

  if (clientStatus !== 200 || !Array.isArray(clients) || clients.length === 0) {
    console.error(`!! client '${CLIENT_ID}' not found; cannot attach scopes`);
    return;
  }
  const clientUuid = clients[0].id;

  for (const scope of wanted) {
    const name = scope.name;
    let scopeId;

    if (byName[name]) {
      scopeId = byName[name].id;
      const scopeToPut = {
        ...byName[name],
        attributes: {
          ...(byName[name].attributes || {}),
          ...(scope.attributes || {}),
        },
      };
      const { status } = await call('PUT', `/admin/realms/${REALM}/client-scopes/${scopeId}`, {
        token,
        body: scopeToPut,
      });
      console.log(`   scope '${name}': updated attributes (${status})`);
    } else {
      const { status, data: resp } = await call('POST', `/admin/realms/${REALM}/client-scopes`, {
        token,
        body: scope,
      });
      if (status !== 200 && status !== 201) {
        console.error(`   scope '${name}': FAILED (${status})`, resp);
        continue;
      }
      const { data: refreshed } = await call('GET', `/admin/realms/${REALM}/client-scopes`, { token });
      const found = Array.isArray(refreshed) ? refreshed.find((s) => s.name === name) : null;
      scopeId = found ? found.id : null;
      console.log(`   scope '${name}': created`);
    }

    if (scopeId) {
      const { status } = await call(
        'PUT',
        `/admin/realms/${REALM}/clients/${clientUuid}/optional-client-scopes/${scopeId}`,
        { token }
      );
      if (status === 200 || status === 204) {
        console.log(`   scope '${name}': attached to ${CLIENT_ID} as optional`);
      } else {
        console.log(`   scope '${name}': attach FAILED (${status})`);
      }
    }
  }
}

async function ensureEncryptionKeys(token) {
  const { status, data: components } = await call(
    'GET',
    `/admin/realms/${REALM}/components?type=org.keycloak.keys.KeyProvider`,
    { token }
  );

  if (status !== 200 || !Array.isArray(components)) {
    return;
  }

  const hasEnc = components.some((c) => c.providerId === 'rsa-enc-generated');
  if (!hasEnc) {
    const { status: postStatus } = await call('POST', `/admin/realms/${REALM}/components`, {
      token,
      body: {
        name: 'rsa-enc-generated',
        providerId: 'rsa-enc-generated',
        providerType: 'org.keycloak.keys.KeyProvider',
        config: {
          priority: ['100'],
          algorithm: ['RSA-OAEP'],
          enabled: ['true'],
          active: ['true'],
        },
      },
    });
    console.log(`   encryption keys: added rsa-enc-generated (${postStatus})`);
  } else {
    console.log('   encryption keys: rsa-enc-generated present');
  }
}

async function main() {
  await waitForKeycloak();

  const { status, data: tok } = await call('POST', '/realms/master/protocol/openid-connect/token', {
    form: {
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN,
      password: PASSWORD,
    },
  });

  if (status !== 200 || !tok.access_token) {
    console.error(`!! admin login failed (${status}):`, tok);
    process.exit(1);
  }
  const token = tok.access_token;

  const { status: realmStatus, data: realm } = await call('GET', `/admin/realms/${REALM}`, { token });
  if (realmStatus === 200 && !realm.verifiableCredentialsEnabled) {
    console.log('!! realm has verifiableCredentialsEnabled=false; OID4VCI endpoints will 404');
  }

  await ensureEncryptionKeys(token);
  await ensureCredentialScopes(token);

  // Ensure Declarative User Profile permits custom unmanaged attributes (medical data, employee_id, etc.)
  const { status: upStatus, data: up } = await call('GET', `/admin/realms/${REALM}/users/profile`, { token });
  if (upStatus === 200 && typeof up === 'object') {
    if (up.unmanagedAttributePolicy !== 'ENABLED') {
      up.unmanagedAttributePolicy = 'ENABLED';
      const { status: putUpStatus } = await call('PUT', `/admin/realms/${REALM}/users/profile`, {
        token,
        body: up
      });
      console.log(`   user profile: enabled unmanagedAttributePolicy (${putUpStatus})`);
    }
  }

  const userMedicalDefaults = {
    ronak: { employee_id: 'ACME-0417', department: 'Platform Engineering', age_over_18: 'true', medical_record_number: 'LH-84920', hospital_name: 'Lilavati Hospital & Research Centre', fitness_status: 'Fit for Duty', blood_group: 'O+', physician_name: 'Dr. P. Deshmukh, MD' },
    raj: { employee_id: 'ACME-1182', department: 'Security', age_over_18: 'true', medical_record_number: 'LH-77215', hospital_name: 'Lilavati Hospital & Research Centre', fitness_status: 'Fit for Duty', blood_group: 'B+', physician_name: 'Dr. P. Deshmukh, MD' },
    milan: { employee_id: 'ACME-2043', department: 'Finance', age_over_18: 'true', medical_record_number: 'LH-63491', hospital_name: 'Lilavati Hospital & Research Centre', fitness_status: 'Fit for Duty', blood_group: 'A+', physician_name: 'Dr. P. Deshmukh, MD' }
  };

  for (const username of USERS) {
    const { status: uStatus, data: found } = await call(
      'GET',
      `/admin/realms/${REALM}/users?username=${encodeURIComponent(username)}&exact=true`,
      { token }
    );

    if (uStatus !== 200 || !Array.isArray(found) || found.length === 0) {
      console.log(`   ${username}: NOT FOUND (skipped)`);
      continue;
    }
    const uid = found[0].id;
    const { status: fullStatus, data: userObj } = await call(
      'GET',
      `/admin/realms/${REALM}/users/${uid}`,
      { token }
    );

    // Ensure medical certificate attributes are set on the user
    if (userMedicalDefaults[username] && fullStatus === 200) {
      const currentAttrs = userObj.attributes || {};
      const newAttrs = { ...currentAttrs };
      let updated = false;
      for (const [k, v] of Object.entries(userMedicalDefaults[username])) {
        if (!currentAttrs[k] || currentAttrs[k][0] !== v) {
          newAttrs[k] = [v];
          updated = true;
        }
      }
      if (updated) {
        await call('PUT', `/admin/realms/${REALM}/users/${uid}`, {
          token,
          body: { ...userObj, attributes: newAttrs }
        });
        console.log(`   ${username}: updated medical attributes in Keycloak`);
      }
    }

    const { status: credStatus, data: existing } = await call(
      'GET',
      `/admin/realms/${REALM}/users/${uid}/vc/credentials`,
      { token }
    );

    if (credStatus === 404) {
      console.log(`   ${username}: no /vc/credentials API on this Keycloak (26.7+ only) -- not required here`);
      continue;
    }

    const names = Array.isArray(existing) ? new Set(existing.map((c) => c.credentialScopeName)) : new Set();
    for (const sc of ['employee-badge', 'medical-certificate']) {
      if (!names.has(sc)) {
        await call('POST', `/admin/realms/${REALM}/users/${uid}/vc/credentials`, {
          token,
          body: { credentialScopeName: sc }
        });
      }
    }
  }

  console.log('bootstrap done');
}

main().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
