const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LEGACY_SIGNATURE_PATH_PATTERN = /^certificate-signatures\/users\/[A-Za-z0-9_-]+\/[^/]+$/;

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

function collectCertificateSignaturePaths(defaults = {}) {
  const signers = Array.isArray(defaults?.signers) ? defaults.signers : [];
  return new Set(signers
    .map((signer) => String(signer?.signatureImagePath || '').trim())
    .filter(Boolean));
}

function planCertificateSignatureCleanup({
  teamId,
  previousDefaults = {},
  nextDefaults = {},
  requestedBy = null
}) {
  const normalizedTeamId = normalizeCertificateTeamId(teamId);
  const previousPaths = collectCertificateSignaturePaths(previousDefaults);
  const nextPaths = collectCertificateSignaturePaths(nextDefaults);

  for (const path of nextPaths) {
    if (isTeamSignaturePath(normalizedTeamId, path)) continue;
    if (isLegacyUserSignaturePath(path) && previousPaths.has(path)) continue;
    throw new Error('Certificate defaults contain an invalid signature path.');
  }

  const cleanupPaths = [...previousPaths].filter((path) => {
    if (nextPaths.has(path)) return false;
    if (isTeamSignaturePath(normalizedTeamId, path)) return true;
    return getLegacySignatureOwnerId(path) === String(requestedBy || '').trim();
  });
  return { previousPaths, nextPaths, cleanupPaths };
}

function isAuthorizedCertificateSignatureCleanupPath(teamId, storagePath, requestedBy = null) {
  return isTeamSignaturePath(teamId, storagePath) ||
    getLegacySignatureOwnerId(storagePath) === String(requestedBy || '').trim();
}

function isCertificateSignaturePathReferenced(defaults, storagePath) {
  return collectCertificateSignaturePaths(defaults).has(String(storagePath || '').trim());
}

module.exports = {
  collectCertificateSignaturePaths,
  getLegacySignatureOwnerId,
  isAuthorizedCertificateSignatureCleanupPath,
  isCertificateSignaturePathReferenced,
  isLegacyUserSignaturePath,
  isTeamSignaturePath,
  normalizeCertificateTeamId,
  planCertificateSignatureCleanup
};
