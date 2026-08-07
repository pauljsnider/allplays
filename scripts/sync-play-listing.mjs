import { createSign } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LISTING_ROOT = path.join(ROOT, 'store/google-play');
const IMAGE_TYPES = [
  ['icon', 'icon.png'],
  ['featureGraphic', 'feature-graphic.png']
];

function textLength(value) {
  return Array.from(value || '').length;
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  if (textLength(value) > maxLength) {
    throw new Error(`${label} exceeds ${maxLength} characters.`);
  }
}

export function readPngInfo(buffer, label = 'PNG') {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(signature) || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${label} must be a valid PNG.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    byteLength: buffer.length
  };
}

export function validateListing(listing) {
  requireText(listing?.title, 'Title', 30);
  requireText(listing?.shortDescription, 'Short description', 80);
  requireText(listing?.fullDescription, 'Full description', 4000);
  if (listing.language !== 'en-US') {
    throw new Error('The initial Google Play listing language must be en-US.');
  }
}

export function validatePng(info, kind, label) {
  if (info.bitDepth !== 8) {
    throw new Error(`${label} must use 8-bit PNG channels.`);
  }
  if (kind === 'icon') {
    if (info.width !== 512 || info.height !== 512 || info.colorType !== 6 || info.byteLength > 1024 * 1024) {
      throw new Error(`${label} must be a 512x512 RGBA PNG no larger than 1MB.`);
    }
    return;
  }
  if (info.colorType === 4 || info.colorType === 6) {
    throw new Error(`${label} must not contain an alpha channel.`);
  }
  if (kind === 'featureGraphic') {
    if (info.width !== 1024 || info.height !== 500) {
      throw new Error(`${label} must be exactly 1024x500.`);
    }
    return;
  }
  const minimum = Math.min(info.width, info.height);
  const maximum = Math.max(info.width, info.height);
  if (minimum < 320 || maximum > 3840 || maximum > minimum * 2) {
    throw new Error(`${label} must be 320-3840px with a longest side no more than twice its shortest side.`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function loadListingPackage(listingRoot = DEFAULT_LISTING_ROOT) {
  const details = await readJson(path.join(listingRoot, 'app-details.json'));
  const languageRoot = path.join(listingRoot, 'en-US');
  const graphicsRoot = path.join(languageRoot, 'graphics');
  const listing = await readJson(path.join(languageRoot, 'listing.json'));
  validateListing(listing);

  if (details.defaultLanguage !== 'en-US') {
    throw new Error('Default language must be en-US.');
  }
  if (!/^https:\/\//.test(details.contactWebsite || '')) {
    throw new Error('Contact website must use HTTPS.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.contactEmail || '')) {
    throw new Error('Contact email is invalid.');
  }

  const images = [];
  for (const [imageType, fileName] of IMAGE_TYPES) {
    const filePath = path.join(graphicsRoot, fileName);
    const bytes = await readFile(filePath);
    validatePng(readPngInfo(bytes, fileName), imageType, fileName);
    images.push({ imageType, fileName, bytes });
  }

  const screenshotNames = (await readdir(graphicsRoot))
    .filter((name) => /^\d{2}-.*\.png$/.test(name))
    .sort();
  if (screenshotNames.length < 2 || screenshotNames.length > 8) {
    throw new Error('Provide between 2 and 8 numbered phone screenshots.');
  }
  for (const fileName of screenshotNames) {
    const bytes = await readFile(path.join(graphicsRoot, fileName));
    validatePng(readPngInfo(bytes, fileName), 'phoneScreenshot', fileName);
    images.push({ imageType: 'phoneScreenshots', fileName, bytes });
  }

  return { details, listing, images };
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function getAccessToken(serviceAccount) {
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
    throw new Error(`Unable to authorize Google Play listing sync (${response.status}).`);
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
  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};
  if (!response.ok) {
    throw new Error(`Google Play request failed (${response.status}): ${payload?.error?.message || 'unknown error'}`);
  }
  return payload;
}

export async function syncListing({ listingPackage, serviceAccount, packageName }) {
  const token = await getAccessToken(serviceAccount);
  const encodedPackage = encodeURIComponent(packageName);
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}`;
  const uploadBase = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodedPackage}`;
  const edit = await playRequest(`${base}/edits`, token, { method: 'POST' });
  const editId = encodeURIComponent(edit.id);
  let committed = false;

  try {
    await playRequest(`${base}/edits/${editId}/details`, token, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(listingPackage.details)
    });
    const language = encodeURIComponent(listingPackage.listing.language);
    await playRequest(`${base}/edits/${editId}/listings/${language}`, token, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(listingPackage.listing)
    });

    for (const imageType of [...new Set(listingPackage.images.map((image) => image.imageType))]) {
      const encodedType = encodeURIComponent(imageType);
      await playRequest(`${base}/edits/${editId}/listings/${language}/${encodedType}`, token, { method: 'DELETE' });
      for (const image of listingPackage.images.filter((candidate) => candidate.imageType === imageType)) {
        await playRequest(
          `${uploadBase}/edits/${editId}/listings/${language}/${encodedType}?uploadType=media`,
          token,
          {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: image.bytes
          }
        );
      }
    }

    await playRequest(`${base}/edits/${editId}:commit`, token, { method: 'POST' });
    committed = true;
  } finally {
    if (!committed) {
      await fetch(`${base}/edits/${editId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
  }
}

async function main() {
  const listingRoot = process.env.PLAY_LISTING_DIR
    ? path.resolve(process.env.PLAY_LISTING_DIR)
    : DEFAULT_LISTING_ROOT;
  const listingPackage = await loadListingPackage(listingRoot);
  if (process.argv.includes('--validate-only')) {
    process.stdout.write(`Validated ${listingPackage.listing.title}: ${listingPackage.images.length} Google Play images.\n`);
    return;
  }

  const serviceAccount = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '{}');
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'ai.allplays.lite';
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is required for listing sync.');
  }
  await syncListing({ listingPackage, serviceAccount, packageName });
  process.stdout.write(`Synced Google Play listing for ${packageName}.\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  await main();
}
