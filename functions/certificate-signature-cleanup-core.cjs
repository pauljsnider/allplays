const crypto = require('node:crypto');

const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LEGACY_SIGNATURE_PATH_PATTERN = /^certificate-signatures\/users\/[A-Za-z0-9_-]+\/[^/]+$/;
const LEGACY_IMAGE_SIGNATURE_PATH_PATTERN = /^user-photos\/\d+_certificate-signature_(.+)$/;
const LEGACY_IMAGE_STORAGE_KIND = 'legacy-image';
const PRIMARY_STORAGE_KIND = 'primary';

function normalizeCertificateTeamId(value) {
  const teamId = String(value || '').trim();
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error('Invalid team ID.');
  }
  return teamId;
}

function getTeamSignaturePrefix(teamId) {
  return `certificate-signatures/teams/${normalizeCertificateTeamId(teamId)}/`;
}

function isTeamSignaturePath(teamId, storagePath) {
  const path = String(storagePath || '').trim();
  const prefix = getTeamSignaturePrefix(teamId);
  const objectName = path.slice(prefix.length);
  return path.startsWith(prefix) && Boolean(objectName) && !objectName.includes('/');
}

function isLegacyUserSignaturePath(storagePath) {
  return LEGACY_SIGNATURE_PATH_PATTERN.test(String(storagePath || '').trim());
}

function getLegacySignatureOwnerId(storagePath) {
  const path = String(storagePath || '').trim();
  if (!isLegacyUserSignaturePath(path)) return null;
  return path.split('/')[2] || null;
}

function hashLegacyImageSignatureReference(bucketName, storagePath, downloadToken) {
  return crypto.createHash('sha256')
    .update(`${String(bucketName || '').trim()}\n${String(storagePath || '').trim()}\n${String(downloadToken || '').trim()}`)
    .digest('hex');
}

function parseLegacyImageSignatureUrl(value, legacyBucketName) {
  const rawUrl = String(value || '').trim();
  const expectedBucket = String(legacyBucketName || '').trim();
  if (!rawUrl || !expectedBucket) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') return null;
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match || decodeURIComponent(match[1]) !== expectedBucket) return null;
    const storagePath = decodeURIComponent(match[2]);
    if (!LEGACY_IMAGE_SIGNATURE_PATH_PATTERN.test(storagePath)) return null;
    const downloadToken = String(url.searchParams.get('token') || '').trim();
    if (url.searchParams.get('alt') !== 'media' || !downloadToken) return null;
    return {
      downloadToken,
      sourceUrlHash: hashLegacyImageSignatureReference(expectedBucket, storagePath, downloadToken),
      storagePath,
      url: rawUrl
    };
  } catch {
    return null;
  }
}

function getLegacyImageSignatureOwnerCandidates(storagePath) {
  const match = String(storagePath || '').trim().match(LEGACY_IMAGE_SIGNATURE_PATH_PATTERN);
  if (!match) return [];
  const ownerAndName = match[1];
  const candidates = [];
  for (let index = ownerAndName.indexOf('_'); index > 0; index = ownerAndName.indexOf('_', index + 1)) {
    const candidate = ownerAndName.slice(0, index);
    const originalFilename = ownerAndName.slice(index + 1);
    if (originalFilename && /^[A-Za-z0-9_-]{1,128}$/.test(candidate)) candidates.push(candidate);
  }
  return [...new Set(candidates)].slice(0, 100);
}

function collectCertificateSignerEntries(record = {}) {
  return [record?.signers, record?.shared?.signers]
    .flatMap((signers) => Array.isArray(signers) ? signers : []);
}

function extractFirebaseStoragePathFromUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') return '';
    if (url.hostname === 'firebasestorage.googleapis.com') {
      const match = url.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
      return match ? decodeURIComponent(match[1]) : '';
    }
    if (url.hostname === 'storage.googleapis.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      return parts.length > 1 ? parts.slice(1).join('/') : '';
    }
  } catch {
    return '';
  }
  return '';
}

function collectLegacyImageSignatureUrls(defaults = {}, legacyBucketName) {
  const signers = collectCertificateSignerEntries(defaults);
  return new Set(signers
    .map((signer) => parseLegacyImageSignatureUrl(signer?.signatureImageUrl, legacyBucketName)?.url || '')
    .filter(Boolean));
}

async function authenticateLegacyImageSignatureReferences({
  defaults = {},
  legacyBucketName,
  allowedUploaderIds = [],
  lookupExistingUserIds,
  getObjectMetadata
}) {
  const allowed = new Set(allowedUploaderIds.map((value) => String(value || '').trim()).filter(Boolean));
  const signers = Array.isArray(defaults?.signers) ? defaults.signers : [];
  const references = [];
  for (const signer of signers) {
    if (String(signer?.signatureImagePath || '').trim()) continue;
    const parsed = parseLegacyImageSignatureUrl(signer?.signatureImageUrl, legacyBucketName);
    if (!parsed) continue;
    const candidates = getLegacyImageSignatureOwnerCandidates(parsed.storagePath);
    if (!candidates.length || typeof lookupExistingUserIds !== 'function') continue;
    try {
      const existingUserIds = [...new Set((await lookupExistingUserIds(candidates))
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
      if (existingUserIds.length !== 1 || !allowed.has(existingUserIds[0])) continue;
      if (typeof getObjectMetadata !== 'function') continue;
      const metadata = await getObjectMetadata(parsed.storagePath);
      const tokenMetadata = metadata?.metadata?.firebaseStorageDownloadTokens ?? metadata?.firebaseStorageDownloadTokens;
      const storedTokens = Array.isArray(tokenMetadata)
        ? tokenMetadata.map(String)
        : String(tokenMetadata || '').split(',').map((value) => value.trim()).filter(Boolean);
      if (!storedTokens.includes(parsed.downloadToken)) continue;
      references.push({
        legacyBucketName: String(legacyBucketName || '').trim(),
        legacyOwnerId: existingUserIds[0],
        legacyProvenance: 'auth-user-and-download-token',
        sourceUrlHash: parsed.sourceUrlHash,
        storageBucket: LEGACY_IMAGE_STORAGE_KIND,
        storagePath: parsed.storagePath,
        url: parsed.url
      });
    } catch {
      // Missing objects and unavailable Auth/Storage evidence are unverified.
    }
  }
  return references;
}

function collectCertificateSignaturePaths(defaults = {}) {
  const signers = collectCertificateSignerEntries(defaults);
  return new Set(signers
    .map((signer) => String(signer?.signatureImagePath || '').trim())
    .filter(Boolean));
}

function collectCertificateSignatureTargets(defaults = {}, authenticatedLegacyReferences = []) {
  const targets = [];
  collectCertificateSignaturePaths(defaults).forEach((storagePath) => {
    targets.push({ storageBucket: PRIMARY_STORAGE_KIND, storagePath });
  });
  const signerUrls = new Set((Array.isArray(defaults?.signers) ? defaults.signers : [])
    .map((signer) => String(signer?.signatureImageUrl || '').trim())
    .filter(Boolean));
  authenticatedLegacyReferences.forEach((reference) => {
    const remainsReferenced = [...signerUrls].some((signerUrl) => (
      parseLegacyImageSignatureUrl(signerUrl, reference?.legacyBucketName)?.sourceUrlHash === reference?.sourceUrlHash
    ));
    if (remainsReferenced) targets.push(reference);
  });
  return new Map(targets.map((target) => [
    `${target.storageBucket || PRIMARY_STORAGE_KIND}\n${String(target.storagePath || '').trim()}`,
    target
  ]));
}

function planCertificateSignatureCleanup({
  teamId,
  previousDefaults = {},
  nextDefaults = {},
  requestedBy = null,
  legacyBucketName = '',
  authenticatedLegacyReferences = []
}) {
  const normalizedTeamId = normalizeCertificateTeamId(teamId);
  const previousTargets = collectCertificateSignatureTargets(previousDefaults, authenticatedLegacyReferences);
  const nextTargets = collectCertificateSignatureTargets(nextDefaults, authenticatedLegacyReferences);
  const previousPaths = new Set([...previousTargets.values()].map((target) => target.storagePath));
  const nextPaths = new Set([...nextTargets.values()].map((target) => target.storagePath));

  const previousLegacyUrls = collectLegacyImageSignatureUrls(previousDefaults, legacyBucketName);
  const nextLegacyUrls = collectLegacyImageSignatureUrls(nextDefaults, legacyBucketName);
  const previousLegacyUrlHashes = new Set([...previousLegacyUrls]
    .map((legacyUrl) => parseLegacyImageSignatureUrl(legacyUrl, legacyBucketName)?.sourceUrlHash)
    .filter(Boolean));
  const nextLegacyUrlHashes = new Set([...nextLegacyUrls]
    .map((legacyUrl) => parseLegacyImageSignatureUrl(legacyUrl, legacyBucketName)?.sourceUrlHash)
    .filter(Boolean));
  const authenticatedUrlHashes = new Set(authenticatedLegacyReferences.map((reference) => reference.sourceUrlHash));
  for (const legacyUrlHash of nextLegacyUrlHashes) {
    if (!previousLegacyUrlHashes.has(legacyUrlHash)) {
      throw new Error('Certificate defaults contain a newly injected legacy signature URL.');
    }
  }
  for (const legacyUrlHash of previousLegacyUrlHashes) {
    if (nextLegacyUrlHashes.has(legacyUrlHash)) continue;
    if (!authenticatedUrlHashes.has(legacyUrlHash)) {
      throw new Error('Legacy signature ownership could not be verified. Ask a current team signer to replace it.');
    }
  }

  for (const [key, target] of nextTargets) {
    const path = target.storagePath;
    if (target.storageBucket === LEGACY_IMAGE_STORAGE_KIND && previousTargets.has(key)) continue;
    if (isTeamSignaturePath(normalizedTeamId, path)) continue;
    if (isLegacyUserSignaturePath(path) && previousPaths.has(path)) continue;
    throw new Error('Certificate defaults contain an invalid signature path.');
  }

  const cleanupTargets = [...previousTargets.entries()].filter(([key, target]) => {
    if (nextTargets.has(key)) return false;
    if (target.storageBucket === LEGACY_IMAGE_STORAGE_KIND) return true;
    const path = target.storagePath;
    if (isTeamSignaturePath(normalizedTeamId, path)) return true;
    return getLegacySignatureOwnerId(path) === String(requestedBy || '').trim();
  }).map(([, target]) => target);
  return {
    previousPaths,
    nextPaths,
    cleanupPaths: cleanupTargets.map((target) => target.storagePath),
    cleanupTargets,
    previousTargets,
    nextTargets
  };
}

function isAuthorizedCertificateSignatureCleanupPath(teamId, storagePath, requestedBy = null) {
  return isTeamSignaturePath(teamId, storagePath) ||
    getLegacySignatureOwnerId(storagePath) === String(requestedBy || '').trim();
}

function isCertificateSignaturePathReferenced(defaults, storagePath) {
  return collectCertificateSignaturePaths(defaults).has(String(storagePath || '').trim());
}

function isAuthorizedCertificateSignatureCleanupTarget(teamId, target = {}) {
  if (target.storageBucket === LEGACY_IMAGE_STORAGE_KIND) {
    return LEGACY_IMAGE_SIGNATURE_PATH_PATTERN.test(String(target.storagePath || '').trim()) &&
      /^[a-f0-9]{64}$/.test(String(target.sourceUrlHash || '').trim()) &&
      target.legacyProvenance === 'auth-user-and-download-token' &&
      getLegacyImageSignatureOwnerCandidates(target.storagePath)
        .includes(String(target.legacyOwnerId || '').trim());
  }
  return isAuthorizedCertificateSignatureCleanupPath(teamId, target.storagePath, target.requestedBy);
}

function isCertificateSignatureTargetReferenced(defaults, target = {}) {
  if (target.storageBucket === LEGACY_IMAGE_STORAGE_KIND) {
    return collectCertificateSignerEntries(defaults)
      .some((signer) => (
        parseLegacyImageSignatureUrl(signer?.signatureImageUrl, target.legacyBucketName)?.storagePath === target.storagePath
      ));
  }
  if (isCertificateSignaturePathReferenced(defaults, target.storagePath)) return true;
  return collectCertificateSignerEntries(defaults)
    .some((signer) => extractFirebaseStoragePathFromUrl(signer?.signatureImageUrl) === target.storagePath);
}

module.exports = {
  authenticateLegacyImageSignatureReferences,
  collectCertificateSignaturePaths,
  collectCertificateSignerEntries,
  collectLegacyImageSignatureUrls,
  extractFirebaseStoragePathFromUrl,
  getLegacySignatureOwnerId,
  getLegacyImageSignatureOwnerCandidates,
  isAuthorizedCertificateSignatureCleanupPath,
  isAuthorizedCertificateSignatureCleanupTarget,
  isCertificateSignaturePathReferenced,
  isCertificateSignatureTargetReferenced,
  isLegacyUserSignaturePath,
  isTeamSignaturePath,
  parseLegacyImageSignatureUrl,
  normalizeCertificateTeamId,
  planCertificateSignatureCleanup
};
