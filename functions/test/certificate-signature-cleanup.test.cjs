const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  authenticateLegacyImageSignatureReferences,
  authenticatePrimaryCertificateSignatureReferences,
  discoverLegacyImageSignatureReferences,
  doesLegacyImageMetadataMatchSourceHash,
  getCertificateLegacyManagerEmails,
  getCertificateLegacySignatureInventoryId,
  getCertificateLegacyManagerEmails,
  getCertificateSignatureObjectKey,
  getLegacySignatureOwnerId,
  getLegacyImageSignatureOwnerCandidates,
  isAuthorizedCertificateSignatureCleanupPath,
  isAuthorizedCertificateSignatureCleanupTarget,
  isCertificateSignaturePathReferenced,
  isCertificateSignatureTargetReferenced,
  isMatchingCertificateLegacySignatureBinding,
  parseLegacyImageSignatureUrl,
  planCertificateSignatureCleanup,
  upgradeCertificateSignatureCleanupTarget
} = require('../certificate-signature-cleanup-core.cjs');

const legacyBucket = 'game-flow-img.firebasestorage.app';
const primaryBucket = 'all-plays-ai.firebasestorage.app';
const legacyPath = 'user-photos/1700000000000_certificate-signature_owner_admin_My_Signature.png';
const legacyUrl = `https://firebasestorage.googleapis.com/v0/b/${legacyBucket}/o/${encodeURIComponent(legacyPath)}?alt=media&token=legacy-token`;

test('canonical owner IDs exclude stale owner aliases from legacy signature provenance', () => {
  assert.deepEqual(getCertificateLegacyManagerEmails({
    ownerId: 'current-owner',
    ownerEmail: 'current@example.com',
    ownerEmailLower: 'former@example.com',
    adminEmails: [' Admin@Example.com ', 'admin@example.com']
  }), ['admin@example.com']);
  assert.deepEqual(getCertificateLegacyManagerEmails({
    ownerEmail: ' Legacy@Example.com ',
    ownerEmailLower: 'legacy@example.com',
    adminEmails: ['admin@example.com']
  }), ['legacy@example.com', 'admin@example.com']);
  assert.deepEqual(getCertificateLegacyManagerEmails({
    ownerEmail: 'former-owner@example.com',
    ownerEmailLower: 'current-owner@example.com',
    adminEmails: ['admin@example.com']
  }), ['admin@example.com']);
});

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
      legacyOwnerId: reference.legacyOwnerId,
      sourceUrlHash: reference.sourceUrlHash,
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

test('discovers authoritative legacy defaults for durable inventory before requiring that binding', async () => {
  const references = await discoverLegacyImageSignatureReferences({
    defaults: { signers: [{ signatureImageUrl: legacyUrl }] },
    teamId: 'team-1',
    legacyBucketName: legacyBucket,
    allowedUploaderIds: ['owner_admin'],
    lookupExistingUserIds: async () => ['owner_admin'],
    getObjectMetadata: async () => ({
      generation: '1700000000000001',
      metadata: { firebaseStorageDownloadTokens: 'legacy-token' }
    })
  });

  assert.equal(references.length, 1);
  const [reference] = references;
  assert.equal(reference.legacySignerField, 'certificateDefaults.signers.0.signatureImageUrl');
  assert.equal(reference.legacyTeamId, 'team-1');
  assert.equal(reference.legacyProvenance, undefined);
  assert.match(getCertificateLegacySignatureInventoryId(reference), /^[a-f0-9]{64}$/);
  assert.equal(doesLegacyImageMetadataMatchSourceHash(reference, {
    metadata: { firebaseStorageDownloadTokens: 'other-token,legacy-token' }
  }), true);
  assert.equal(doesLegacyImageMetadataMatchSourceHash(reference, {
    metadata: { firebaseStorageDownloadTokens: 'other-token' }
  }), false);

  const binding = {
    teamId: reference.legacyTeamId,
    signerField: reference.legacySignerField,
    legacyOwnerId: reference.legacyOwnerId,
    sourceUrlHash: reference.sourceUrlHash,
    objectKey: reference.objectKey
  };
  assert.equal(isMatchingCertificateLegacySignatureBinding(binding, reference), true);
  assert.equal(isMatchingCertificateLegacySignatureBinding({ ...binding, conflicted: true }, reference), false);
  assert.equal(isMatchingCertificateLegacySignatureBinding({ ...binding, signerField: 'certificateDefaults.signers.1.signatureImageUrl' }, reference), false);
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
        legacyOwnerId: reference.legacyOwnerId,
        sourceUrlHash: reference.sourceUrlHash,
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
      legacyOwnerId: reference.legacyOwnerId,
      sourceUrlHash: reference.sourceUrlHash,
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

test('retains old primary tombstones when no historical generation was recorded', async () => {
  const storagePath = 'certificate-signatures/teams/team-1/old-writer.png';
  const result = await upgradeCertificateSignatureCleanupTarget({
    teamId: 'team-1',
    target: {
      teamId: 'team-1',
      storageBucket: 'primary',
      storagePath,
      requestedBy: 'admin-1',
      status: 'pending'
    },
    primaryBucketName: primaryBucket,
    legacyBucketName: legacyBucket,
    getObjectMetadata: async (storageBucket, requestedPath) => {
      assert.equal(storageBucket, 'primary');
      assert.equal(requestedPath, storagePath);
      return { generation: '1700000000000002' };
    }
  });

  assert.deepEqual(result, {
    blockedReason: 'unverified-historical-generation',
    missing: false,
    target: {
      teamId: 'team-1',
      storageBucket: 'primary',
      storagePath,
      requestedBy: 'admin-1',
      status: 'pending'
    }
  });
});

test('upgrades a partially canonical primary tombstone only from its recorded generation', async () => {
  const storagePath = 'certificate-signatures/teams/team-1/recorded-generation.png';
  const result = await upgradeCertificateSignatureCleanupTarget({
    teamId: 'team-1',
    target: {
      teamId: 'team-1',
      storageBucket: 'primary',
      storagePath,
      requestedBy: 'admin-1',
      status: 'pending',
      objectGeneration: '1700000000000002'
    },
    primaryBucketName: primaryBucket,
    legacyBucketName: legacyBucket,
    getObjectMetadata: async () => {
      throw new Error('Current metadata must not establish historical identity.');
    }
  });

  assert.deepEqual(result, {
    missing: false,
    target: {
      teamId: 'team-1',
      storageBucket: 'primary',
      storageBucketName: primaryBucket,
      storagePath,
      requestedBy: 'admin-1',
      status: 'pending',
      objectGeneration: '1700000000000002',
      objectKey: `${primaryBucket}\n${storagePath}\n1700000000000002`
    }
  });
});

test('upgrades old legacy tombstones only through matching inventory and token metadata', async () => {
  const oldTarget = {
    teamId: 'team-1',
    storageBucket: 'legacy-image',
    legacyBucketName: legacyBucket,
    legacyOwnerId: 'owner_admin',
    legacyProvenance: 'auth-user-and-download-token',
    sourceUrlHash: '68127cf2c504fde8b2455e1dbfd251a0f319c56e650137a3237c58786174e576',
    storagePath: legacyPath,
    requestedBy: 'owner_admin',
    status: 'pending'
  };
  const upgrade = (bindingOverrides = {}, token = 'legacy-token') => (
    upgradeCertificateSignatureCleanupTarget({
      teamId: 'team-1',
      target: oldTarget,
      primaryBucketName: primaryBucket,
      legacyBucketName: legacyBucket,
      getObjectMetadata: async () => ({
        generation: '1700000000000001',
        metadata: { firebaseStorageDownloadTokens: token }
      }),
      lookupTeamObjectBinding: async (reference) => ({
        teamId: 'team-1',
        signerField: 'certificateDefaults.signers.0.signatureImageUrl',
        legacyOwnerId: 'owner_admin',
        sourceUrlHash: reference.sourceUrlHash,
        objectKey: reference.objectKey,
        ...bindingOverrides
      })
    })
  );

  const result = await upgrade();
  assert.equal(result.target.legacyProvenance, 'server-inventory-team-binding');
  assert.equal(result.target.legacySignerField, 'certificateDefaults.signers.0.signatureImageUrl');
  assert.equal(result.target.objectGeneration, '1700000000000001');
  assert.equal(isAuthorizedCertificateSignatureCleanupTarget('team-1', result.target), true);
  assert.equal(await upgrade({ conflicted: true }), null);
  assert.equal(await upgrade({}, 'wrong-token'), null);
});

test('old tombstones retain missing objects and reject unauthorized paths without deleting', async () => {
  const missing = Object.assign(new Error('missing'), { code: 404 });
  assert.deepEqual(await upgradeCertificateSignatureCleanupTarget({
    teamId: 'team-1',
    target: {
      teamId: 'team-1',
      storagePath: 'certificate-signatures/teams/team-1/gone.png',
      requestedBy: 'admin-1'
    },
    primaryBucketName: primaryBucket,
    legacyBucketName: legacyBucket,
    getObjectMetadata: async () => { throw missing; }
  }), {
    target: {
      teamId: 'team-1',
      storagePath: 'certificate-signatures/teams/team-1/gone.png',
      requestedBy: 'admin-1'
    },
    missing: true
  });
  assert.equal(await upgradeCertificateSignatureCleanupTarget({
    teamId: 'team-1',
    target: {
      teamId: 'team-1',
      storagePath: 'profile-photos/users/victim/photo.png',
      requestedBy: 'admin-1'
    },
    primaryBucketName: primaryBucket,
    legacyBucketName: legacyBucket,
    getObjectMetadata: async () => ({ generation: '1' })
  }), null);
});

test('revalidates canonical legacy tombstones against their current server binding', async () => {
  const target = {
    teamId: 'team-1',
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
    storagePath: legacyPath
  };
  const matchingBinding = {
    teamId: target.legacyTeamId,
    signerField: target.legacySignerField,
    legacyOwnerId: target.legacyOwnerId,
    sourceUrlHash: target.sourceUrlHash,
    objectKey: target.objectKey
  };
  const getObjectMetadata = async () => {
    throw new Error('Canonical legacy tombstones must use their immutable recorded generation.');
  };

  assert.deepEqual(await upgradeCertificateSignatureCleanupTarget({
    teamId: 'team-1',
    target,
    primaryBucketName: primaryBucket,
    legacyBucketName: legacyBucket,
    getObjectMetadata,
    lookupTeamObjectBinding: async () => matchingBinding
  }), { target, missing: false });
  assert.equal(await upgradeCertificateSignatureCleanupTarget({
    teamId: 'team-1',
    target,
    primaryBucketName: primaryBucket,
    legacyBucketName: legacyBucket,
    getObjectMetadata,
    lookupTeamObjectBinding: async () => ({ ...matchingBinding, conflicted: true })
  }), null);
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
  const migrationSource = readFileSync(join(
    __dirname,
    '..',
    '..',
    '_migration',
    'backfill-certificate-legacy-signature-inventory.js'
  ), 'utf8');
  const rulesSource = readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8');

  assert.match(functionsSource, /exports\.commitCertificateDefaults\s*=\s*functions\.https\.onCall/);
  assert.match(functionsSource, /firestore\.runTransaction[\s\S]*planCertificateSignatureCleanup/);
  assert.match(functionsSource, /transaction\.get\(cleanupRef\)[\s\S]*removed signature image cannot be restored/i);
  assert.match(functionsSource, /retiredSignatureImageObjectKeys[\s\S]*cleanupPlan\.retiredObjectKeys/);
  assert.match(functionsSource, /retiredSignatureImagePaths[\s\S]*cleanupPlan\.retiredPaths/);
  assert.match(functionsSource, /certificateSignatureCleanup\/\$\{cleanupId\}/);
  assert.match(functionsSource, /status: 'pending'/);
  assert.match(functionsSource, /exports\.indexCertificateLegacySignaturesOnDefaultsWrite[\s\S]*discoverCertificateLegacySignatureReferences[\s\S]*registerCertificateLegacySignatureInventoryReferences/);
  assert.match(functionsSource, /discoveredLegacyReferences[\s\S]*registerCertificateLegacySignatureInventoryReferences[\s\S]*planCertificateSignatureCleanup/);
  assert.match(functionsSource, /exports\.cleanupCertificateSignature[\s\S]*\.onWrite/);
  assert.match(functionsSource, /hydrateCertificateSignatureCleanupTarget[\s\S]*upgradeCertificateSignatureCleanupTarget/);
  assert.match(functionsSource, /blockedReason === 'unverified-historical-generation'[\s\S]*status: 'blocked-unverified-generation'/);
  assert.match(functionsSource, /isAuthorizedCertificateSignatureCleanupTarget\(teamId, target\)/);
  assert.match(functionsSource, /async function lookupCertificateLegacySignatureBinding[\s\S]*getCertificateLegacyUploaderIds[\s\S]*conflicted: true/);
  assert.match(functionsSource, /managerEmails\.slice\(offset, offset \+ 100\)/);
  assert.match(migrationSource, /managerEmails\.slice\(offset, offset \+ 100\)/);
  assert.match(functionsSource, /collection\(`teams\/\$\{teamId\}\/certificates`\)[\s\S]*collection\(`teams\/\$\{teamId\}\/certificateBatches`\)/);
  assert.match(functionsSource, /transaction\.get\(defaultsRef\)[\s\S]*transaction\.get\(certificatesQuery\)[\s\S]*transaction\.get\(certificateBatchesQuery\)[\s\S]*referenceRecords\.some[\s\S]*isCertificateSignatureTargetReferenced[\s\S]*status: 'blocked-referenced'/);
  assert.match(functionsSource, /target\.storageBucket === 'legacy-image'[\s\S]*IMAGE_STORAGE_BUCKET[\s\S]*file\(storagePath, \{[\s\S]*preconditionOpts[\s\S]*ifGenerationMatch[\s\S]*blocked-generation-changed[\s\S]*status: 'completed'/);
  assert.match(migrationSource, /certificateLegacySignatureInventory[\s\S]*collectionGroup\('settings'\)[\s\S]*discoverLegacyImageSignatureReferences/);
  assert.match(migrationSource, /systemMigrations\/certificateLegacySignatureInventoryV2[\s\S]*status: 'completed'/);
  assert.match(migrationSource, /collection\('certificateLegacySignatureInventory'\)[\s\S]*invalidationReason: 'owner-authorization-changed'/);
  assert.match(dbSource, /export async function setCertificateDefaults[\s\S]*return commitCertificateDefaults\(teamId, defaults\)/);
  assert.doesNotMatch(dbSource, /setDoc\(doc\(db, 'teams', teamId, 'settings', 'certificateDefaults'\)/);
  assert.match(rulesSource, /match \/settings\/\{settingId\}[\s\S]*allow read:[\s\S]*certificateDefaults[\s\S]*allow create, update, delete: if false;/);
  assert.match(rulesSource, /retiredSignatureImagePaths[\s\S]*hasNoRetiredCertificateSignaturePaths/);
  assert.match(rulesSource, /certificateSignersHaveCanonicalImagePaths/);
  assert.match(rulesSource, /match \/certificateBatches\/\{batchId\}[\s\S]*isCertificateBatchCreateSafe[\s\S]*isCertificateBatchUpdateSafe/);
  assert.match(rulesSource, /match \/certificates\/\{certificateId\}[\s\S]*isCertificateOutputCreateSafe[\s\S]*isCertificateOutputUpdateSafe/);
});
