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

function collectCertificateSignaturePaths(defaults = {}) {
  const signers = Array.isArray(defaults?.signers) ? defaults.signers : [];
  return new Set(signers
    .map((signer) => String(signer?.signatureImagePath || '').trim())
    .filter(Boolean));
}

function planCertificateSignatureCleanup({ teamId, previousDefaults = {}, nextDefaults = {} }) {
  const normalizedTeamId = normalizeCertificateTeamId(teamId);
  const previousPaths = collectCertificateSignaturePaths(previousDefaults);
  const nextPaths = collectCertificateSignaturePaths(nextDefaults);

  for (const path of nextPaths) {
    if (isTeamSignaturePath(normalizedTeamId, path)) continue;
    if (isLegacyUserSignaturePath(path) && previousPaths.has(path)) continue;
    throw new Error('Certificate defaults contain an invalid signature path.');
  }

  const cleanupPaths = [...previousPaths].filter((path) => (
    !nextPaths.has(path) &&
    (isTeamSignaturePath(normalizedTeamId, path) || isLegacyUserSignaturePath(path))
  ));
  return { previousPaths, nextPaths, cleanupPaths };
}

function isAuthorizedCertificateSignatureCleanupPath(teamId, storagePath) {
  return isTeamSignaturePath(teamId, storagePath) || isLegacyUserSignaturePath(storagePath);
}

module.exports = {
  collectCertificateSignaturePaths,
  isAuthorizedCertificateSignatureCleanupPath,
  isLegacyUserSignaturePath,
  isTeamSignaturePath,
  normalizeCertificateTeamId,
  planCertificateSignatureCleanup
};
