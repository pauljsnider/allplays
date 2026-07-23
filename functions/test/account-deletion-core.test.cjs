'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDeletionAuditId,
  classifyAccountStoragePaths,
  createAccountDeletionRequestHandler,
  extractAccountProfileStoragePath,
  shouldProcessAccountDeletionRequest,
  normalizeConfirmation
} = require('../account-deletion-core.cjs');

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

test('normalizes explicit account deletion confirmation', () => {
  assert.equal(normalizeConfirmation(' delete '), 'DELETE');
  assert.equal(buildDeletionAuditId('user-1').length, 64);
});

test('processes new and retried queued deletion requests only once', () => {
  const snapshot = (status, exists = true) => ({
    exists,
    data: () => ({ status })
  });

  assert.equal(shouldProcessAccountDeletionRequest(snapshot('', false), snapshot('queued')), true);
  assert.equal(shouldProcessAccountDeletionRequest(snapshot('failed'), snapshot('queued')), true);
  assert.equal(shouldProcessAccountDeletionRequest(snapshot('queued'), snapshot('processing')), false);
  assert.equal(shouldProcessAccountDeletionRequest(snapshot('queued'), snapshot('queued')), false);
  assert.equal(shouldProcessAccountDeletionRequest(snapshot('failed'), snapshot('', false)), false);
});

test('extracts only account profile photo paths from Firebase Storage URLs', () => {
  assert.equal(
    extractAccountProfileStoragePath(
      'https://firebasestorage.googleapis.com/v0/b/allplays.appspot.com/o/user-photos%2F171234_photo.jpg?alt=media',
      'user-1'
    ),
    'user-photos/171234_photo.jpg'
  );
  assert.equal(
    extractAccountProfileStoragePath(
      'https://storage.googleapis.com/allplays.appspot.com/user-photos/user-1/photo.jpg',
      'user-1'
    ),
    'user-photos/user-1/photo.jpg'
  );
  assert.equal(
    extractAccountProfileStoragePath(
      'https://firebasestorage.googleapis.com/v0/b/allplays.appspot.com/o/user-photos%2Fother-user%2Fphoto.jpg',
      'user-1'
    ),
    ''
  );
  assert.equal(extractAccountProfileStoragePath('https://example.com/photo.jpg', 'user-1'), '');
});

test('routes account media cleanup to the primary and legacy image buckets', () => {
  const paths = classifyAccountStoragePaths('user-1', [
    'primary://athlete-profile-media/user-1/player-1/photo.jpg',
    'athlete-profile-media/user-1/player-1/legacy.jpg',
    'primary://athlete-profile-media/other-user/player-2/not-ours.jpg',
    'team-media/team-1/folder-1/user-1/file.jpg'
  ], [
    'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/user-photos%2F171234_photo.jpg?alt=media'
  ]);

  assert.deepEqual(paths.primaryPaths, ['athlete-profile-media/user-1/player-1/photo.jpg']);
  assert.deepEqual(paths.imagePaths, [
    'user-photos/171234_photo.jpg',
    'athlete-profile-media/user-1/player-1/legacy.jpg'
  ]);
});

test('queues deletion for a signed-in non-owner', async () => {
  const writes = [];
  const handler = createAccountDeletionRequestHandler({
    firestore: {
      collection: () => ({
        where: () => ({ get: async () => ({ docs: [] }) })
      }),
      doc: (path) => ({ set: async (value) => writes.push({ path, value }) })
    },
    auth: { getUser: async () => ({ email: 'Parent@example.com' }) },
    Timestamp: { now: () => 'now' },
    HttpsError
  });

  const result = await handler({ confirmation: 'DELETE', source: 'ios' }, { auth: { uid: 'user-1', token: {} } });
  assert.equal(result.status, 'queued');
  assert.equal(writes[0].path, 'accountDeletionRequests/user-1');
  assert.equal(writes[0].value.email, 'parent@example.com');
});

test('blocks deletion while the user owns a team', async () => {
  const handler = createAccountDeletionRequestHandler({
    firestore: {
      collection: () => ({
        where: () => ({
          get: async () => ({ docs: [{ id: 'team-1', data: () => ({ name: 'Bears' }) }] })
        })
      })
    },
    auth: { getUser: async () => ({}) },
    Timestamp: { now: () => 'now' },
    HttpsError
  });

  await assert.rejects(
    () => handler({ confirmation: 'DELETE' }, { auth: { uid: 'owner-1' } }),
    (error) => error.code === 'failed-precondition' && error.details.ownedTeams[0].name === 'Bears'
  );
});

test('blocks deletion for a legacy email-based team owner', async () => {
  const handler = createAccountDeletionRequestHandler({
    firestore: {
      collection: () => ({
        where: (field, _operator, value) => ({
          get: async () => ({
            docs: field === 'ownerEmailLower' && value === 'legacy@example.com'
              ? [{ id: 'legacy-team', data: () => ({ name: 'Legacy Bears' }) }]
              : []
          })
        })
      })
    },
    auth: { getUser: async () => ({ email: 'Legacy@Example.com' }) },
    Timestamp: { now: () => 'now' },
    HttpsError
  });

  await assert.rejects(
    () => handler({ confirmation: 'DELETE' }, { auth: { uid: 'legacy-owner', token: {} } }),
    (error) => error.code === 'failed-precondition' &&
      error.details.ownedTeams[0].name === 'Legacy Bears'
  );
});

test('allows deletion after every owned team is deactivated', async () => {
  const writes = [];
  const handler = createAccountDeletionRequestHandler({
    firestore: {
      collection: () => ({
        where: () => ({
          get: async () => ({ docs: [{ id: 'team-1', data: () => ({ name: 'Falcons', active: false }) }] })
        })
      }),
      doc: (path) => ({ set: async (value) => writes.push({ path, value }) })
    },
    auth: { getUser: async () => ({ email: 'owner@example.com' }) },
    Timestamp: { now: () => 'now' },
    HttpsError
  });

  const result = await handler(
    { confirmation: 'DELETE', source: 'ios' },
    { auth: { uid: 'user-1', token: { email: 'owner@example.com' } } }
  );

  assert.equal(result.status, 'queued');
  assert.equal(writes.length, 1);
});
