const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  authenticateLegacyImageSignatureReferences,
  getLegacySignatureOwnerId,
  getLegacyImageSignatureOwnerCandidates,
  isAuthorizedCertificateSignatureCleanupPath,
  isAuthorizedCertificateSignatureCleanupTarget,
  isCertificateSignaturePathReferenced,
  isCertificateSignatureTargetReferenced,
  parseLegacyImageSignatureUrl,
  planCertificateSignatureCleanup
} = require('../certificate-signature-cleanup-core.cjs');

const legacyBucket = 'game-flow-img.firebasestorage.app';
const legacyPath = 'user-photos/1700000000000_certificate-signature_owner_admin_My_Signature.png';
const legacyUrl = `https://firebasestorage.googleapis.com/v0/b/${legacyBucket}/o/${encodeURIComponent(legacyPath)}?alt=media&token=legacy-token`;

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

test('parses only exact token-authenticated legacy signature URLs from the configured image bucket', () => {
  assert.deepEqual(parseLegacyImageSignatureUrl(legacyUrl, legacyBucket), {
    downloadToken: 'legacy-token',
    sourceUrlHash: '68127cf2c504fde8b2455e1dbfd251a0f319c56e650137a3237c58786174e576',
    storagePath: legacyPath,
    url: legacyUrl
  });
  assert.equal(parseLegacyImageSignatureUrl(legacyUrl.replace(legacyBucket, 'other-bucket'), legacyBucket), null);
  assert.equal(parseLegacyImageSignatureUrl(legacyUrl.replace('&token=legacy-token', ''), legacyBucket), null);
  assert.equal(parseLegacyImageSignatureUrl(
    `https://firebasestorage.googleapis.com/v0/b/${legacyBucket}/o/${encodeURIComponent('user-photos/1700_profile.jpg')}?alt=media&token=x`,
    legacyBucket
  ), null);
});

test('authenticates a URL-only legacy signature with unambiguous Auth identity and matching object token', async () => {
  const references = await authenticateLegacyImageSignatureReferences({
    defaults: { signers: [{ signatureImageUrl: legacyUrl }] },
    legacyBucketName: legacyBucket,
    allowedUploaderIds: ['owner_admin'],
    lookupExistingUserIds: async (candidates) => {
      assert.deepEqual(candidates, ['owner', 'owner_admin', 'owner_admin_My']);
      return ['owner_admin'];
    },
    getObjectMetadata: async (storagePath) => {
      assert.equal(storagePath, legacyPath);
      return { metadata: { firebaseStorageDownloadTokens: 'other-token,legacy-token' } };
    }
  });

  assert.deepEqual(references, [{
    legacyBucketName: legacyBucket,
    legacyOwnerId: 'owner_admin',
    legacyProvenance: 'auth-user-and-download-token',
    sourceUrlHash: '68127cf2c504fde8b2455e1dbfd251a0f319c56e650137a3237c58786174e576',
    storageBucket: 'legacy-image',
    storagePath: legacyPath,
    url: legacyUrl
  }]);
  assert.deepEqual(getLegacyImageSignatureOwnerCandidates(legacyPath), ['owner', 'owner_admin', 'owner_admin_My']);
});

test('fails closed for ambiguous, unrelated, or token-mismatched legacy signature provenance', async () => {
  const authenticate = (existingUserIds, allowedUploaderIds = ['owner_admin'], token = 'legacy-token') => (
    authenticateLegacyImageSignatureReferences({
      defaults: { signers: [{ signatureImageUrl: legacyUrl }] },
      legacyBucketName: legacyBucket,
      allowedUploaderIds,
      lookupExistingUserIds: async () => existingUserIds,
      getObjectMetadata: async () => ({ metadata: { firebaseStorageDownloadTokens: token } })
    })
  );

  assert.deepEqual(await authenticate(['owner', 'owner_admin']), []);
  assert.deepEqual(await authenticate(['owner_admin'], ['different-admin']), []);
  assert.deepEqual(await authenticate(['owner_admin'], ['owner_admin'], 'wrong-token'), []);
});

test('queues an authenticated removed URL-only signature in the legacy bucket and blocks unverified removal', () => {
  const reference = {
    legacyBucketName: legacyBucket,
    legacyOwnerId: 'owner_admin',
    legacyProvenance: 'auth-user-and-download-token',
    sourceUrlHash: '68127cf2c504fde8b2455e1dbfd251a0f319c56e650137a3237c58786174e576',
    storageBucket: 'legacy-image',
    storagePath: legacyPath,
    url: legacyUrl
  };
  const previousDefaults = { signers: [{ signatureImageUrl: legacyUrl }] };
  const retainedPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults,
    nextDefaults: previousDefaults,
    legacyBucketName: legacyBucket,
    authenticatedLegacyReferences: [reference]
  });
  const reorderedRetainedPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults,
    nextDefaults: {
      signers: [{ signatureImageUrl: legacyUrl.replace('?alt=media&token=legacy-token', '?token=legacy-token&alt=media') }]
    },
    legacyBucketName: legacyBucket,
    authenticatedLegacyReferences: [reference]
  });
  const removalPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults,
    nextDefaults: { signers: [] },
    legacyBucketName: legacyBucket,
    authenticatedLegacyReferences: [reference]
  });

  assert.deepEqual(retainedPlan.cleanupTargets, []);
  assert.deepEqual(reorderedRetainedPlan.cleanupTargets, []);
  assert.deepEqual(removalPlan.cleanupTargets, [reference]);
  assert.equal(isAuthorizedCertificateSignatureCleanupTarget('team-1', {
    ...reference,
    requestedBy: 'different-current-admin'
  }), true);
  assert.equal(isCertificateSignatureTargetReferenced(previousDefaults, reference), true);
  assert.equal(isCertificateSignatureTargetReferenced({
    signers: [{ signatureImageUrl: legacyUrl.replace('token=legacy-token', 'token=other-token') }]
  }, reference), true);
  assert.equal(isCertificateSignatureTargetReferenced({
    signers: [{ signatureImageUrl: legacyUrl.replace('?alt=media&token=legacy-token', '?token=legacy-token&alt=media') }]
  }, reference), true);
  assert.equal(isCertificateSignatureTargetReferenced({ signers: [] }, reference), false);
  assert.throws(() => planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults,
    nextDefaults: { signers: [] },
    legacyBucketName: legacyBucket
  }), /ownership could not be verified/);
  assert.throws(() => planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [] },
    nextDefaults: previousDefaults,
    legacyBucketName: legacyBucket,
    authenticatedLegacyReferences: [reference]
  }), /newly injected legacy signature URL/);
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
  assert.match(functionsSource, /authenticateLegacyImageSignatureReferences[\s\S]*getObjectMetadata[\s\S]*getMetadata/);
  assert.match(functionsSource, /isAuthorizedCertificateSignatureCleanupTarget\(teamId, cleanup\)/);
  assert.match(functionsSource, /transaction\.get\(defaultsRef\)[\s\S]*isCertificateSignatureTargetReferenced[\s\S]*status: 'blocked-referenced'/);
  assert.match(functionsSource, /cleanup\.storageBucket === 'legacy-image'[\s\S]*IMAGE_STORAGE_BUCKET[\s\S]*cleanupBucket\.file\(storagePath\)\.delete[\s\S]*status: 'completed'/);
  assert.match(dbSource, /export async function setCertificateDefaults[\s\S]*return commitCertificateDefaults\(teamId, defaults\)/);
  assert.doesNotMatch(dbSource, /setDoc\(doc\(db, 'teams', teamId, 'settings', 'certificateDefaults'\)/);
  assert.match(rulesSource, /match \/settings\/\{settingId\}[\s\S]*allow read:[\s\S]*certificateDefaults[\s\S]*allow create, update, delete: if false;/);
});
