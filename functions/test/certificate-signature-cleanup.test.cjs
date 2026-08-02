const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  getLegacySignatureOwnerId,
  isAuthorizedCertificateSignatureCleanupPath,
  isCertificateSignaturePathReferenced,
  planCertificateSignatureCleanup
} = require('../certificate-signature-cleanup-core.cjs');

test('queues removed legacy user-scoped signatures only for their original uploader', () => {
  const legacyPath = 'certificate-signatures/users/original-admin/legacy.png';
  const nextPath = 'certificate-signatures/teams/team-1/new.png';
  const ownedPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [{ signatureImagePath: legacyPath }] },
    nextDefaults: { signers: [{ signatureImagePath: nextPath }] },
    requestedBy: 'original-admin'
  });
  const foreignPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [{ signatureImagePath: legacyPath }] },
    nextDefaults: { signers: [{ signatureImagePath: nextPath }] },
    requestedBy: 'other-admin'
  });

  assert.deepEqual(ownedPlan.cleanupPaths, [legacyPath]);
  assert.deepEqual(foreignPlan.cleanupPaths, []);
  assert.equal(getLegacySignatureOwnerId(legacyPath), 'original-admin');
});

test('allows an unchanged legacy reference but rejects a newly injected legacy path', () => {
  const legacyPath = 'certificate-signatures/users/original-admin/legacy.png';
  assert.doesNotThrow(() => planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [{ signatureImagePath: legacyPath }] },
    nextDefaults: { signers: [{ signatureImagePath: legacyPath }] }
  }));
  assert.throws(() => planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [] },
    nextDefaults: { signers: [{ signatureImagePath: legacyPath }] }
  }), /invalid signature path/);
});

test('rejects cross-team and nested new signature paths', () => {
  for (const path of [
    'certificate-signatures/teams/team-2/other.png',
    'certificate-signatures/teams/team-1/nested/other.png'
  ]) {
    assert.throws(() => planCertificateSignatureCleanup({
      teamId: 'team-1',
      nextDefaults: { signers: [{ signatureImagePath: path }] }
    }), /invalid signature path/);
  }
});

test('cleanup workers accept exact team paths and only caller-owned legacy paths', () => {
  assert.equal(isAuthorizedCertificateSignatureCleanupPath(
    'team-1',
    'certificate-signatures/teams/team-1/current.png',
    'other-admin'
  ), true);
  assert.equal(isAuthorizedCertificateSignatureCleanupPath(
    'team-1',
    'certificate-signatures/users/original-admin/legacy.png',
    'original-admin'
  ), true);
  assert.equal(isAuthorizedCertificateSignatureCleanupPath(
    'team-1',
    'certificate-signatures/users/original-admin/legacy.png',
    'other-admin'
  ), false);
  assert.equal(isAuthorizedCertificateSignatureCleanupPath(
    'team-1',
    'certificate-signatures/teams/team-2/other.png',
    'original-admin'
  ), false);
  assert.equal(isAuthorizedCertificateSignatureCleanupPath('team-1', 'profile-photos/users/victim/photo.png'), false);
});

test('cleanup workers retain any signature still referenced by current defaults', () => {
  const path = 'certificate-signatures/teams/team-1/current.png';
  assert.equal(isCertificateSignaturePathReferenced({ signers: [{ signatureImagePath: path }] }, path), true);
  assert.equal(isCertificateSignaturePathReferenced({ signers: [] }, path), false);
});

test('wires defaults commits and cleanup through server-only tombstone and trigger boundaries', () => {
  const functionsSource = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
  const dbSource = readFileSync(join(__dirname, '..', '..', 'js', 'db.js'), 'utf8');
  const rulesSource = readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8');

  assert.match(functionsSource, /exports\.commitCertificateDefaults\s*=\s*functions\.https\.onCall/);
  assert.match(functionsSource, /firestore\.runTransaction[\s\S]*planCertificateSignatureCleanup/);
  assert.match(functionsSource, /transaction\.get\(cleanupRef\)[\s\S]*removed signature image cannot be restored/i);
  assert.match(functionsSource, /certificateSignatureCleanup\/\$\{cleanupId\}/);
  assert.match(functionsSource, /status: 'pending'/);
  assert.match(functionsSource, /exports\.cleanupCertificateSignature[\s\S]*\.onWrite/);
  assert.match(functionsSource, /isAuthorizedCertificateSignatureCleanupPath\(teamId, storagePath, cleanup\.requestedBy\)/);
  assert.match(functionsSource, /transaction\.get\(defaultsRef\)[\s\S]*isCertificateSignaturePathReferenced[\s\S]*status: 'blocked-referenced'/);
  assert.match(functionsSource, /admin\.storage\(\)\.bucket\(\)\.file\(storagePath\)\.delete[\s\S]*status: 'completed'/);
  assert.match(dbSource, /export async function setCertificateDefaults[\s\S]*return commitCertificateDefaults\(teamId, defaults\)/);
  assert.doesNotMatch(dbSource, /setDoc\(doc\(db, 'teams', teamId, 'settings', 'certificateDefaults'\)/);
  assert.match(rulesSource, /match \/settings\/\{settingId\}[\s\S]*allow read:[\s\S]*certificateDefaults[\s\S]*allow create, update, delete: if false;/);
});
