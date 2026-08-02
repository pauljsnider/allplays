const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  isAuthorizedCertificateSignatureCleanupPath,
  planCertificateSignatureCleanup
} = require('../certificate-signature-cleanup-core.cjs');

test('queues removed legacy user-scoped signatures for authorized server cleanup', () => {
  const legacyPath = 'certificate-signatures/users/original-admin/legacy.png';
  const nextPath = 'certificate-signatures/teams/team-1/new.png';
  const plan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [{ signatureImagePath: legacyPath }] },
    nextDefaults: { signers: [{ signatureImagePath: nextPath }] }
  });

  assert.deepEqual(plan.cleanupPaths, [legacyPath]);
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

test('cleanup workers accept only exact team paths or legacy user paths', () => {
  assert.equal(isAuthorizedCertificateSignatureCleanupPath(
    'team-1',
    'certificate-signatures/teams/team-1/current.png'
  ), true);
  assert.equal(isAuthorizedCertificateSignatureCleanupPath(
    'team-1',
    'certificate-signatures/users/original-admin/legacy.png'
  ), true);
  assert.equal(isAuthorizedCertificateSignatureCleanupPath(
    'team-1',
    'certificate-signatures/teams/team-2/other.png'
  ), false);
  assert.equal(isAuthorizedCertificateSignatureCleanupPath('team-1', 'profile-photos/users/victim/photo.png'), false);
});

test('wires defaults commits and cleanup through server-only transaction and trigger boundaries', () => {
  const functionsSource = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
  const dbSource = readFileSync(join(__dirname, '..', '..', 'js', 'db.js'), 'utf8');

  assert.match(functionsSource, /exports\.commitCertificateDefaults\s*=\s*functions\.https\.onCall/);
  assert.match(functionsSource, /firestore\.runTransaction[\s\S]*planCertificateSignatureCleanup/);
  assert.match(functionsSource, /certificateSignatureCleanup\/\$\{cleanupId\}/);
  assert.match(functionsSource, /exports\.cleanupCertificateSignature[\s\S]*\.onCreate/);
  assert.match(functionsSource, /isAuthorizedCertificateSignatureCleanupPath[\s\S]*admin\.storage\(\)\.bucket\(\)\.file\(storagePath\)\.delete/);
  assert.match(dbSource, /export async function setCertificateDefaults[\s\S]*return commitCertificateDefaults\(teamId, defaults\)/);
  assert.doesNotMatch(dbSource, /setDoc\(doc\(db, 'teams', teamId, 'settings', 'certificateDefaults'\)/);
});
