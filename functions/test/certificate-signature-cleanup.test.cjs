const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  authenticateLegacyImageSignatureReferences,
  authenticatePrimaryCertificateSignatureReferences,
  getCertificateSignatureObjectKey,
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
const primaryBucket = 'all-plays-ai.firebasestorage.app';
const legacyPath = 'user-photos/1700000000000_certificate-signature_owner_admin_My_Signature.png';
const legacyUrl = `https://firebasestorage.googleapis.com/v0/b/${legacyBucket}/o/${encodeURIComponent(legacyPath)}?alt=media&token=legacy-token`;

test('queues removed legacy user-scoped signatures only for their original uploader', () => {
  const legacyPath = 'certificate-signatures/users/original-admin/legacy.png';
  const legacyDisplayUrl = 'https://firebasestorage.googleapis.com/v0/b/all-plays-ai.appspot.com/o/certificate-signatures%2Fusers%2Foriginal-admin%2Flegacy.png?alt=media&token=old-token';
  const nextPath = 'certificate-signatures/teams/team-1/new.png';
  const authenticatedPrimaryReference = {
    objectGeneration: '1700000000000000',
    storageBucket: 'primary',
    storageBucketName: primaryBucket,
    storagePath: legacyPath
  };
  authenticatedPrimaryReference.objectKey = getCertificateSignatureObjectKey(authenticatedPrimaryReference);
  const ownedPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [{ signatureImagePath: legacyPath, signatureImageUrl: legacyDisplayUrl }] },
    nextDefaults: { signers: [{ signatureImagePath: nextPath }] },
    requestedBy: 'original-admin',
    authenticatedPrimaryReferences: [authenticatedPrimaryReference]
  });
  const foreignPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [{ signatureImagePath: legacyPath }] },
    nextDefaults: { signers: [{ signatureImagePath: nextPath }] },
    requestedBy: 'other-admin',
    authenticatedPrimaryReferences: [authenticatedPrimaryReference]
  });

  assert.deepEqual(ownedPlan.cleanupPaths, [legacyPath]);
  assert.deepEqual(ownedPlan.retiredPaths, [legacyPath]);
  assert.deepEqual(ownedPlan.retiredObjectKeys, [authenticatedPrimaryReference.objectKey]);
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

test('retains primary signature images referenced by saved certificates and batch snapshots', () => {
  const path = 'certificate-signatures/teams/team-1/current.png';
  const primaryUrl = `https://firebasestorage.googleapis.com/v0/b/all-plays-ai.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=current-token`;
  const target = { storageBucket: 'primary', storagePath: path, requestedBy: 'admin-1' };

  assert.equal(isCertificateSignatureTargetReferenced({
    signers: [{ signatureImageUrl: primaryUrl }]
  }, target), true);
  assert.equal(isCertificateSignatureTargetReferenced({
    shared: { signers: [{ signatureImagePath: path, signatureImageUrl: primaryUrl }] }
  }, target), true);
  assert.equal(isCertificateSignatureTargetReferenced({
    shared: { signers: [{ signatureImageUrl: primaryUrl.replace('current.png', 'other.png') }] }
  }, target), false);
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
    teamId: 'team-1',
    legacyBucketName: legacyBucket,
    allowedUploaderIds: ['owner_admin'],
    lookupExistingUserIds: async (candidates) => {
      assert.deepEqual(candidates, ['owner', 'owner_admin', 'owner_admin_My']);
      return ['owner_admin'];
    },
    getObjectMetadata: async (storagePath) => {
      assert.equal(storagePath, legacyPath);
      return {
        generation: '1700000000000001',
        metadata: { firebaseStorageDownloadTokens: 'other-token,legacy-token' }
      };
    },
    lookupTeamObjectBinding: async (reference) => ({
      teamId: 'team-1',
      signerField: 'certificateDefaults.signers.0.signatureImageUrl',
      objectKey: reference.objectKey
    })
  });

  assert.deepEqual(references, [{
    legacyBucketName: legacyBucket,
    legacyOwnerId: 'owner_admin',
    legacyProvenance: 'server-inventory-team-binding',
    legacySignerField: 'certificateDefaults.signers.0.signatureImageUrl',
    legacyTeamId: 'team-1',
    objectGeneration: '1700000000000001',
    objectKey: `${legacyBucket}\n${legacyPath}\n1700000000000001`,
    sourceUrlHash: '68127cf2c504fde8b2455e1dbfd251a0f319c56e650137a3237c58786174e576',
    storageBucket: 'legacy-image',
    storageBucketName: legacyBucket,
    storagePath: legacyPath,
    url: legacyUrl
  }]);
  assert.deepEqual(getLegacyImageSignatureOwnerCandidates(legacyPath), ['owner', 'owner_admin', 'owner_admin_My']);
});

test('fails closed for ambiguous, unrelated, or token-mismatched legacy signature provenance', async () => {
  const authenticate = (existingUserIds, allowedUploaderIds = ['owner_admin'], token = 'legacy-token') => (
    authenticateLegacyImageSignatureReferences({
      defaults: { signers: [{ signatureImageUrl: legacyUrl }] },
      teamId: 'team-1',
      legacyBucketName: legacyBucket,
      allowedUploaderIds,
      lookupExistingUserIds: async () => existingUserIds,
      getObjectMetadata: async () => ({
        generation: '1700000000000001',
        metadata: { firebaseStorageDownloadTokens: token }
      }),
      lookupTeamObjectBinding: async (reference) => ({
        teamId: 'team-1',
        signerField: 'certificateDefaults.signers.0.signatureImageUrl',
        objectKey: reference.objectKey
      })
    })
  );

  assert.deepEqual(await authenticate(['owner', 'owner_admin']), []);
  assert.deepEqual(await authenticate(['owner_admin'], ['different-admin']), []);
  assert.deepEqual(await authenticate(['owner_admin'], ['owner_admin'], 'wrong-token'), []);
  assert.deepEqual(await authenticateLegacyImageSignatureReferences({
    defaults: { signers: [{ signatureImageUrl: legacyUrl }] },
    teamId: 'team-1',
    legacyBucketName: legacyBucket,
    allowedUploaderIds: ['owner_admin'],
    lookupExistingUserIds: async () => ['owner_admin'],
    getObjectMetadata: async () => ({
      generation: '1700000000000001',
      metadata: { firebaseStorageDownloadTokens: 'legacy-token' }
    }),
    lookupTeamObjectBinding: async (reference) => ({
      teamId: 'team-2',
      signerField: 'certificateDefaults.signers.0.signatureImageUrl',
      objectKey: reference.objectKey
    })
  }), []);
});

test('authenticates primary cleanup targets only with an immutable object generation', async () => {
  const path = 'certificate-signatures/teams/team-1/current.png';
  const references = await authenticatePrimaryCertificateSignatureReferences({
    defaults: { signers: [{ signatureImagePath: path }] },
    storageBucketName: primaryBucket,
    getObjectMetadata: async () => ({ generation: '1700000000000002' })
  });
  assert.deepEqual(references, [{
    objectGeneration: '1700000000000002',
    objectKey: `${primaryBucket}\n${path}\n1700000000000002`,
    storageBucket: 'primary',
    storageBucketName: primaryBucket,
    storagePath: path
  }]);
  assert.deepEqual(await authenticatePrimaryCertificateSignatureReferences({
    defaults: { signers: [{ signatureImagePath: path }] },
    storageBucketName: primaryBucket,
    getObjectMetadata: async () => ({})
  }), []);
});

test('queues an authenticated removed URL-only signature in the legacy bucket and blocks unverified removal', () => {
  const reference = {
    legacyBucketName: legacyBucket,
    legacyOwnerId: 'owner_admin',
    legacyProvenance: 'server-inventory-team-binding',
    legacySignerField: 'certificateDefaults.signers.0.signatureImageUrl',
    legacyTeamId: 'team-1',
    objectGeneration: '1700000000000001',
    objectKey: `${legacyBucket}\n${legacyPath}\n1700000000000001`,
    sourceUrlHash: '68127cf2c504fde8b2455e1dbfd251a0f319c56e650137a3237c58786174e576',
    storageBucket: 'legacy-image',
    storageBucketName: legacyBucket,
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
  const movedSignerRemovalPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults: { signers: [{ name: 'Other' }, { signatureImageUrl: legacyUrl }] },
    nextDefaults: { signers: [] },
    legacyBucketName: legacyBucket,
    authenticatedLegacyReferences: [reference]
  });

  assert.deepEqual(retainedPlan.cleanupTargets, []);
  assert.deepEqual(reorderedRetainedPlan.cleanupTargets, []);
  assert.deepEqual(removalPlan.cleanupTargets, [{ ...reference, sourceUrls: [legacyUrl] }]);
  assert.deepEqual(removalPlan.retiredObjectKeys, [reference.objectKey]);
  assert.deepEqual(movedSignerRemovalPlan.cleanupTargets, []);
  assert.equal(isAuthorizedCertificateSignatureCleanupTarget('team-1', {
    ...reference,
    requestedBy: 'different-current-admin'
  }), true);
  assert.equal(isCertificateSignatureTargetReferenced(previousDefaults, reference), true);
  assert.equal(isCertificateSignatureTargetReferenced({
    shared: { signers: [{ signatureImageUrl: legacyUrl }] }
  }, reference), true);
  assert.equal(isCertificateSignatureTargetReferenced({
    signers: [{ signatureImageUrl: legacyUrl.replace('token=legacy-token', 'token=other-token') }]
  }, reference), true);
  assert.equal(isCertificateSignatureTargetReferenced({
    signers: [{ signatureImageUrl: legacyUrl.replace('?alt=media&token=legacy-token', '?token=legacy-token&alt=media') }]
  }, reference), true);
  assert.equal(isCertificateSignatureTargetReferenced({ signers: [] }, reference), false);
  const unverifiedRemovalPlan = planCertificateSignatureCleanup({
    teamId: 'team-1',
    previousDefaults,
    nextDefaults: { signers: [] },
    legacyBucketName: legacyBucket
  });
  assert.deepEqual(unverifiedRemovalPlan.cleanupTargets, []);
  assert.deepEqual(unverifiedRemovalPlan.retiredObjectKeys, []);
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
  assert.match(functionsSource, /retiredSignatureImageObjectKeys[\s\S]*cleanupPlan\.retiredObjectKeys/);
  assert.match(functionsSource, /retiredSignatureImagePaths[\s\S]*cleanupPlan\.retiredPaths/);
  assert.match(functionsSource, /certificateSignatureCleanup\/\$\{cleanupId\}/);
  assert.match(functionsSource, /status: 'pending'/);
  assert.match(functionsSource, /exports\.cleanupCertificateSignature[\s\S]*\.onWrite/);
  assert.match(functionsSource, /authenticateLegacyImageSignatureReferences[\s\S]*getObjectMetadata[\s\S]*getMetadata/);
  assert.match(functionsSource, /isAuthorizedCertificateSignatureCleanupTarget\(teamId, cleanup\)/);
  assert.match(functionsSource, /collection\(`teams\/\$\{teamId\}\/certificates`\)[\s\S]*collection\(`teams\/\$\{teamId\}\/certificateBatches`\)/);
  assert.match(functionsSource, /transaction\.get\(defaultsRef\)[\s\S]*transaction\.get\(certificatesQuery\)[\s\S]*transaction\.get\(certificateBatchesQuery\)[\s\S]*referenceRecords\.some[\s\S]*isCertificateSignatureTargetReferenced[\s\S]*status: 'blocked-referenced'/);
  assert.match(functionsSource, /cleanup\.storageBucket === 'legacy-image'[\s\S]*IMAGE_STORAGE_BUCKET[\s\S]*file\(storagePath, \{[\s\S]*preconditionOpts[\s\S]*ifGenerationMatch[\s\S]*blocked-generation-changed[\s\S]*status: 'completed'/);
  assert.match(dbSource, /export async function setCertificateDefaults[\s\S]*return commitCertificateDefaults\(teamId, defaults\)/);
  assert.doesNotMatch(dbSource, /setDoc\(doc\(db, 'teams', teamId, 'settings', 'certificateDefaults'\)/);
  assert.match(rulesSource, /match \/settings\/\{settingId\}[\s\S]*allow read:[\s\S]*certificateDefaults[\s\S]*allow create, update, delete: if false;/);
  assert.match(rulesSource, /retiredSignatureImagePaths[\s\S]*hasNoRetiredCertificateSignaturePaths/);
  assert.match(rulesSource, /certificateSignersHaveCanonicalImagePaths/);
  assert.match(rulesSource, /match \/certificateBatches\/\{batchId\}[\s\S]*isCertificateBatchCreateSafe[\s\S]*isCertificateBatchUpdateSafe/);
  assert.match(rulesSource, /match \/certificates\/\{certificateId\}[\s\S]*isCertificateOutputCreateSafe[\s\S]*isCertificateOutputUpdateSafe/);
});
