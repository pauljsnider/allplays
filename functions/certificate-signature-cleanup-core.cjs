const crypto = require('node:crypto');

const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LEGACY_SIGNATURE_PATH_PATTERN = /^certificate-signatures\/users\/[A-Za-z0-9_-]+\/[^/]+$/;
const LEGACY_IMAGE_SIGNATURE_PATH_PATTERN = /^user-photos\/\d+_certificate-signature_(.+)$/;
const LEGACY_IMAGE_STORAGE_KIND = 'legacy-image';
const PRIMARY_STORAGE_KIND = 'primary';

function getCertificateLegacyManagerEmails(team = {}) {
  const hasCanonicalOwner = Boolean(String(team.ownerId || '').trim());
  const normalizeEmails = (emails) => [...new Set(
    emails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)
  )];
  const adminEmails = normalizeEmails(Array.isArray(team.adminEmails) ? team.adminEmails : []);
  if (hasCanonicalOwner) return adminEmails;

  const ownerAliases = normalizeEmails([team.ownerEmail, team.ownerEmailLower]);
  return [...new Set([
    ...(ownerAliases.length === 1 ? ownerAliases : []),
    ...adminEmails
  ])];
}

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

function getCertificateLegacySignatureInventoryId(reference = {}) {
  const objectKey = getCertificateSignatureObjectKey(reference);
  return objectKey
    ? crypto.createHash('sha256').update(objectKey).digest('hex')
    : '';
}

function normalizeObjectGeneration(value) {
  const generation = String(value || '').trim();
  return /^\d+$/.test(generation) ? generation : '';
}

function getCertificateSignatureObjectKey(target = {}) {
  const storageBucketName = String(target.storageBucketName || target.legacyBucketName || '').trim();
  const storagePath = String(target.storagePath || '').trim();
  const objectGeneration = normalizeObjectGeneration(target.objectGeneration);
  if (!storageBucketName || !storagePath || !objectGeneration) return '';
  return `${storageBucketName}\n${storagePath}\n${objectGeneration}`;
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

function getFirebaseStorageDownloadTokens(metadata = {}) {
  const tokenMetadata = metadata?.metadata?.firebaseStorageDownloadTokens ?? metadata?.firebaseStorageDownloadTokens;
  return [...new Set((Array.isArray(tokenMetadata) ? tokenMetadata : String(tokenMetadata || '').split(','))
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function doesLegacyImageMetadataMatchSourceHash(reference = {}, metadata = {}) {
  const bucketName = String(reference.storageBucketName || reference.legacyBucketName || '').trim();
  const storagePath = String(reference.storagePath || '').trim();
  const sourceUrlHash = String(reference.sourceUrlHash || '').trim();
  if (!bucketName || !storagePath || !/^[a-f0-9]{64}$/.test(sourceUrlHash)) return false;
  return getFirebaseStorageDownloadTokens(metadata).some((downloadToken) => (
    hashLegacyImageSignatureReference(bucketName, storagePath, downloadToken) === sourceUrlHash
  ));
}

function isMatchingCertificateLegacySignatureBinding(binding = {}, reference = {}) {
  return binding?.conflicted !== true &&
    String(binding?.teamId || '').trim() === String(reference?.legacyTeamId || '').trim() &&
    String(binding?.signerField || '').trim() === String(reference?.legacySignerField || '').trim() &&
    String(binding?.legacyOwnerId || '').trim() === String(reference?.legacyOwnerId || '').trim() &&
    String(binding?.sourceUrlHash || '').trim() === String(reference?.sourceUrlHash || '').trim() &&
    String(binding?.objectKey || '').trim() === getCertificateSignatureObjectKey(reference);
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

async function discoverLegacyImageSignatureReferences({
  defaults = {},
  teamId,
  legacyBucketName,
  allowedUploaderIds = [],
  lookupExistingUserIds,
  getObjectMetadata
}) {
  const normalizedTeamId = normalizeCertificateTeamId(teamId);
  const allowed = new Set(allowedUploaderIds.map((value) => String(value || '').trim()).filter(Boolean));
  const signers = Array.isArray(defaults?.signers) ? defaults.signers : [];
  const references = [];
  for (const [signerIndex, signer] of signers.entries()) {
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
      if (!getFirebaseStorageDownloadTokens(metadata).includes(parsed.downloadToken)) continue;
      const reference = {
        legacyBucketName: String(legacyBucketName || '').trim(),
        legacyOwnerId: existingUserIds[0],
        legacySignerField: `certificateDefaults.signers.${signerIndex}.signatureImageUrl`,
        legacyTeamId: normalizedTeamId,
        objectGeneration: normalizeObjectGeneration(metadata?.generation),
        sourceUrlHash: parsed.sourceUrlHash,
        storageBucket: LEGACY_IMAGE_STORAGE_KIND,
        storageBucketName: String(legacyBucketName || '').trim(),
        storagePath: parsed.storagePath,
        url: parsed.url
      };
      reference.objectKey = getCertificateSignatureObjectKey(reference);
      if (reference.objectKey) references.push(reference);
    } catch {
      // Missing objects and unavailable Auth/Storage evidence are unverified.
    }
  }
  return references;
}

async function authenticateLegacyImageSignatureReferences(options = {}) {
  const references = await discoverLegacyImageSignatureReferences(options);
  if (typeof options.lookupTeamObjectBinding !== 'function') return [];
  const authenticated = [];
  for (const reference of references) {
    try {
      const binding = await options.lookupTeamObjectBinding(reference);
      if (!isMatchingCertificateLegacySignatureBinding(binding, reference)) continue;
      authenticated.push({
        ...reference,
        legacyProvenance: 'server-inventory-team-binding'
      });
    } catch {
      // An unavailable or conflicting server binding is unverified.
    }
  }
  return authenticated;
}

async function authenticatePrimaryCertificateSignatureReferences({
  defaults = {},
  storageBucketName,
  getObjectMetadata
}) {
  const bucketName = String(storageBucketName || '').trim();
  if (!bucketName || typeof getObjectMetadata !== 'function') return [];
  const references = [];
  for (const storagePath of collectCertificateSignaturePaths(defaults)) {
    try {
      const metadata = await getObjectMetadata(storagePath);
      const reference = {
        objectGeneration: normalizeObjectGeneration(metadata?.generation),
        storageBucket: PRIMARY_STORAGE_KIND,
        storageBucketName: bucketName,
        storagePath
      };
      reference.objectKey = getCertificateSignatureObjectKey(reference);
      if (reference.objectKey) references.push(reference);
    } catch {
      // A missing object or unavailable generation is not safe to delete.
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

function collectCertificateSignatureTargets(
  defaults = {},
  authenticatedLegacyReferences = [],
  authenticatedPrimaryReferences = []
) {
  const targets = [];
  const authenticatedPrimaryByPath = new Map(authenticatedPrimaryReferences.map((reference) => [
    String(reference?.storagePath || '').trim(),
    reference
  ]));
  const signerEntries = collectCertificateSignerEntries(defaults);
  collectCertificateSignaturePaths(defaults).forEach((storagePath) => {
    const sourceUrls = signerEntries
      .filter((signer) => String(signer?.signatureImagePath || '').trim() === storagePath)
      .map((signer) => String(signer?.signatureImageUrl || '').trim())
      .filter(Boolean);
    targets.push({
      ...(authenticatedPrimaryByPath.get(storagePath) || {}),
      storageBucket: PRIMARY_STORAGE_KIND,
      storagePath,
      sourceUrls: [...new Set(sourceUrls)]
    });
  });
  const defaultSigners = Array.isArray(defaults?.signers) ? defaults.signers : [];
  authenticatedLegacyReferences.forEach((reference) => {
    const signerIndexMatch = String(reference?.legacySignerField || '').match(
      /^certificateDefaults\.signers\.([0-3])\.signatureImageUrl$/
    );
    const signerIndex = signerIndexMatch ? Number(signerIndexMatch[1]) : -1;
    const signerUrl = signerIndex >= 0 && signerIndex < defaultSigners.length
      ? String(defaultSigners[signerIndex]?.signatureImageUrl || '').trim()
      : '';
    const remainsReferenced = Boolean(signerUrl) &&
      parseLegacyImageSignatureUrl(signerUrl, reference?.legacyBucketName)?.sourceUrlHash === reference?.sourceUrlHash;
    if (remainsReferenced) targets.push({
      ...reference,
      sourceUrls: [String(reference?.url || '').trim()].filter(Boolean)
    });
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
  authenticatedLegacyReferences = [],
  authenticatedPrimaryReferences = []
}) {
  const normalizedTeamId = normalizeCertificateTeamId(teamId);
  const previousTargets = collectCertificateSignatureTargets(
    previousDefaults,
    authenticatedLegacyReferences,
    authenticatedPrimaryReferences
  );
  const nextTargets = collectCertificateSignatureTargets(
    nextDefaults,
    authenticatedLegacyReferences,
    authenticatedPrimaryReferences
  );
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
  for (const legacyUrlHash of nextLegacyUrlHashes) {
    if (!previousLegacyUrlHashes.has(legacyUrlHash)) {
      throw new Error('Certificate defaults contain a newly injected legacy signature URL.');
    }
  }

  for (const [key, target] of nextTargets) {
    const path = target.storagePath;
    if (target.storageBucket === LEGACY_IMAGE_STORAGE_KIND && previousTargets.has(key)) continue;
    if (isTeamSignaturePath(normalizedTeamId, path)) continue;
    if (isLegacyUserSignaturePath(path) && previousPaths.has(path)) continue;
    throw new Error('Certificate defaults contain an invalid signature path.');
  }

  const retiredTargets = [...previousTargets.entries()].filter(([key, target]) => {
    if (nextTargets.has(key)) return false;
    if (target.storageBucket === LEGACY_IMAGE_STORAGE_KIND) return true;
    const path = target.storagePath;
    if (isTeamSignaturePath(normalizedTeamId, path)) return true;
    return getLegacySignatureOwnerId(path) === String(requestedBy || '').trim();
  }).map(([, target]) => target);
  const cleanupTargets = retiredTargets.filter((target) => (
    getCertificateSignatureObjectKey(target) &&
    (target.storageBucket !== LEGACY_IMAGE_STORAGE_KIND ||
      target.legacyProvenance === 'server-inventory-team-binding')
  ));
  return {
    previousPaths,
    nextPaths,
    cleanupPaths: cleanupTargets.map((target) => target.storagePath),
    cleanupTargets,
    retiredObjectKeys: [...new Set(cleanupTargets
      .map((target) => getCertificateSignatureObjectKey(target))
      .filter(Boolean))],
    retiredPaths: [...new Set(retiredTargets
      .filter((target) => target.storageBucket === PRIMARY_STORAGE_KIND)
      .map((target) => String(target.storagePath || '').trim())
      .filter(Boolean))],
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
  const objectKey = getCertificateSignatureObjectKey(target);
  if (target.storageBucket === LEGACY_IMAGE_STORAGE_KIND) {
    return LEGACY_IMAGE_SIGNATURE_PATH_PATTERN.test(String(target.storagePath || '').trim()) &&
      /^[a-f0-9]{64}$/.test(String(target.sourceUrlHash || '').trim()) &&
      target.legacyProvenance === 'server-inventory-team-binding' &&
      String(target.legacyTeamId || '').trim() === normalizeCertificateTeamId(teamId) &&
      /^certificateDefaults\.signers\.[0-3]\.signatureImageUrl$/.test(
        String(target.legacySignerField || '').trim()
      ) &&
      getLegacyImageSignatureOwnerCandidates(target.storagePath)
        .includes(String(target.legacyOwnerId || '').trim()) &&
      Boolean(objectKey) &&
      objectKey === String(target.objectKey || '').trim();
  }
  return isAuthorizedCertificateSignatureCleanupPath(teamId, target.storagePath, target.requestedBy) &&
    Boolean(objectKey) &&
    objectKey === String(target.objectKey || '').trim();
}

async function upgradeCertificateSignatureCleanupTarget({
  teamId,
  target = {},
  primaryBucketName,
  legacyBucketName,
  getObjectMetadata,
  lookupTeamObjectBinding
}) {
  const normalizedTeamId = normalizeCertificateTeamId(teamId);
  if (String(target.teamId || '').trim() !== normalizedTeamId) return null;
  const isCanonicalTarget = isAuthorizedCertificateSignatureCleanupTarget(normalizedTeamId, target);
  if (isCanonicalTarget && target.storageBucket !== LEGACY_IMAGE_STORAGE_KIND) {
    return { target, missing: false };
  }
  if (isCanonicalTarget) {
    if (typeof lookupTeamObjectBinding !== 'function') return null;
    const binding = await lookupTeamObjectBinding(target);
    return isMatchingCertificateLegacySignatureBinding(binding, target)
      ? { target, missing: false }
      : null;
  }
  const storageBucket = target.storageBucket === LEGACY_IMAGE_STORAGE_KIND
    ? LEGACY_IMAGE_STORAGE_KIND
    : PRIMARY_STORAGE_KIND;
  const storagePath = String(target.storagePath || '').trim();
  const requestedBy = String(target.requestedBy || '').trim();
  const expectedLegacyBucket = String(legacyBucketName || '').trim();
  if (storageBucket === PRIMARY_STORAGE_KIND) {
    if (!isAuthorizedCertificateSignatureCleanupPath(normalizedTeamId, storagePath, requestedBy)) return null;
    const recordedGeneration = normalizeObjectGeneration(target.objectGeneration);
    if (!recordedGeneration) {
      if (typeof getObjectMetadata !== 'function') return null;
      try {
        await getObjectMetadata(storageBucket, storagePath);
      } catch (error) {
        if (Number(error?.code) === 404) return { target, missing: true };
        throw error;
      }
      return {
        target,
        missing: false,
        blockedReason: 'unverified-historical-generation'
      };
    }
    const upgradedPrimary = {
      ...target,
      storageBucket,
      storageBucketName: String(primaryBucketName || '').trim(),
      objectGeneration: recordedGeneration
    };
    upgradedPrimary.objectKey = getCertificateSignatureObjectKey(upgradedPrimary);
    return isAuthorizedCertificateSignatureCleanupTarget(normalizedTeamId, upgradedPrimary)
      ? { target: upgradedPrimary, missing: false }
      : null;
  } else if (
    String(target.legacyBucketName || '').trim() !== expectedLegacyBucket ||
    !/^[a-f0-9]{64}$/.test(String(target.sourceUrlHash || '').trim()) ||
    !getLegacyImageSignatureOwnerCandidates(storagePath)
      .includes(String(target.legacyOwnerId || '').trim())
  ) {
    return null;
  }
  if (typeof getObjectMetadata !== 'function') return null;
  let metadata;
  try {
    metadata = await getObjectMetadata(storageBucket, storagePath);
  } catch (error) {
    if (Number(error?.code) === 404) return { target, missing: true };
    throw error;
  }
  const upgraded = {
    ...target,
    storageBucket,
    storageBucketName: storageBucket === LEGACY_IMAGE_STORAGE_KIND
      ? expectedLegacyBucket
      : String(primaryBucketName || '').trim(),
    objectGeneration: normalizeObjectGeneration(metadata?.generation)
  };
  upgraded.objectKey = getCertificateSignatureObjectKey(upgraded);
  if (!upgraded.objectKey) return null;
  if (storageBucket === LEGACY_IMAGE_STORAGE_KIND) {
    if (
      !doesLegacyImageMetadataMatchSourceHash(upgraded, metadata) ||
      typeof lookupTeamObjectBinding !== 'function'
    ) return null;
    const binding = await lookupTeamObjectBinding(upgraded);
    if (
      binding?.conflicted === true ||
      String(binding?.objectKey || '').trim() !== upgraded.objectKey ||
      String(binding?.legacyOwnerId || '').trim() !== String(upgraded.legacyOwnerId || '').trim() ||
      String(binding?.sourceUrlHash || '').trim() !== String(upgraded.sourceUrlHash || '').trim()
    ) return null;
    upgraded.legacyTeamId = String(binding?.teamId || '').trim();
    upgraded.legacySignerField = String(binding?.signerField || '').trim();
    upgraded.legacyProvenance = 'server-inventory-team-binding';
  }
  return isAuthorizedCertificateSignatureCleanupTarget(normalizedTeamId, upgraded)
    ? { target: upgraded, missing: false }
    : null;
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
  authenticatePrimaryCertificateSignatureReferences,
  collectCertificateSignaturePaths,
  collectCertificateSignerEntries,
  collectLegacyImageSignatureUrls,
  discoverLegacyImageSignatureReferences,
  doesLegacyImageMetadataMatchSourceHash,
  extractFirebaseStoragePathFromUrl,
  getCertificateLegacySignatureInventoryId,
  getCertificateSignatureObjectKey,
  getLegacySignatureOwnerId,
  getLegacyImageSignatureOwnerCandidates,
  isAuthorizedCertificateSignatureCleanupPath,
  isAuthorizedCertificateSignatureCleanupTarget,
  isCertificateSignaturePathReferenced,
  isCertificateSignatureTargetReferenced,
  isLegacyUserSignaturePath,
  isMatchingCertificateLegacySignatureBinding,
  isTeamSignaturePath,
  parseLegacyImageSignatureUrl,
  normalizeCertificateTeamId,
  planCertificateSignatureCleanup,
  upgradeCertificateSignatureCleanupTarget
};
