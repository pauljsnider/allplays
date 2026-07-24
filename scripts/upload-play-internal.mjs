import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const serviceAccount = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '{}');
const bundlePath = process.env.ANDROID_BUNDLE_PATH;
const packageName = process.env.ANDROID_PACKAGE_NAME || 'ai.allplays.lite';
const releaseName = process.env.ALLPLAYS_RELEASE_NAME || 'ALL PLAYS internal';

if (!serviceAccount.client_email || !serviceAccount.private_key || !bundlePath) {
  throw new Error('Google Play service-account JSON and ANDROID_BUNDLE_PATH are required.');
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const assertion = `${header}.${claims}.${signer.sign(serviceAccount.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(`Unable to authorize Google Play upload: ${payload.error_description || response.status}`);
  }
  return payload.access_token;
}

async function playRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google Play request failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

const token = await getAccessToken();
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
const edit = await playRequest(`${base}/edits`, token, { method: 'POST' });
const bundleBytes = await readFile(bundlePath);
const bundle = await playRequest(
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(edit.id)}/bundles?uploadType=media`,
  token,
  {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bundleBytes
  }
);
await playRequest(`${base}/edits/${encodeURIComponent(edit.id)}/tracks/internal`, token, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    track: 'internal',
    releases: [{
      name: releaseName,
      versionCodes: [String(bundle.versionCode)],
      status: 'completed'
    }]
  })
});
await playRequest(`${base}/edits/${encodeURIComponent(edit.id)}:commit`, token, { method: 'POST' });

process.stdout.write(`Uploaded Android version code ${bundle.versionCode} to the internal track.\n`);
