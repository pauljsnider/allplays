'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  buildDeletionAuditId,
  classifyAccountStoragePaths,
  collectAccountMediaStoragePaths,
  createAccountDeletionRequestHandler,
  extractAccountProfileStoragePath,
  extractLegacyAccountProfileStoragePath,
  getDeletableLegacyProfilePhotoPaths,
  getAccountDeletionCollectionQueries,
  getAccountDeletionCollectionGroupQueries,
  shouldProcessAccountDeletionRequest,
  normalizeConfirmation
} = require('../account-deletion-core.cjs');

const recentAuthTime = Math.floor(Date.now() / 1000);

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
    ''
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

test('extracts legacy unscoped profile paths separately for ownership verification', () => {
  assert.equal(
    extractLegacyAccountProfileStoragePath(
      'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/user-photos%2F171234_photo.jpg?alt=media'
    ),
    'user-photos/171234_photo.jpg'
  );
  assert.equal(
    extractLegacyAccountProfileStoragePath(
      'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/user-photos%2Fuser-1%2Fphoto.jpg?alt=media'
    ),
    ''
  );
});

test('deletes a legacy profile photo only when no other user references its object path', () => {
  const candidateUrl = 'https://firebasestorage.googleapis.com/v0/b/images/o/user-photos%2F171234_photo.jpg?alt=media&token=owner';
  const sameObjectWithAnotherToken = 'https://firebasestorage.googleapis.com/v0/b/images/o/user-photos%2F171234_photo.jpg?alt=media&token=other';
  const userDocument = (id, photoUrl) => ({ id, data: () => ({ photoUrl }) });

  assert.deepEqual(
    getDeletableLegacyProfilePhotoPaths('user-1', [candidateUrl], [
      userDocument('user-1', candidateUrl)
    ]),
    ['user-photos/171234_photo.jpg']
  );
  assert.deepEqual(
    getDeletableLegacyProfilePhotoPaths('user-1', [candidateUrl], [
      userDocument('user-1', candidateUrl),
      userDocument('user-2', sameObjectWithAnotherToken)
    ]),
    []
  );
});

test('routes account media cleanup to the primary and legacy image buckets', () => {
  const paths = classifyAccountStoragePaths('user-1', [
    'primary://athlete-profile-media/user-1/player-1/photo.jpg',
    'athlete-profile-media/user-1/player-1/legacy.jpg',
    'primary://athlete-profile-media/other-user/player-2/not-ours.jpg',
    'team-media/team-1/folder-1/user-1/file.jpg',
    'primary://team-media/team-2/folder-2/user-1/photo.jpg',
    'team-media/team-1/folder-1/other-user/not-ours.jpg',
    'stat-sheets/team-chat/team-1/team/user-1/chat.jpg',
    'stat-sheets/team-chat/team-1/team/other-user/not-ours.jpg'
  ], [
    'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/user-photos%2F171234_photo.jpg?alt=media'
  ]);

  assert.deepEqual(paths.primaryPaths, [
    'athlete-profile-media/user-1/player-1/photo.jpg',
    'team-media/team-1/folder-1/user-1/file.jpg',
    'team-media/team-2/folder-2/user-1/photo.jpg',
    'stat-sheets/team-chat/team-1/team/user-1/chat.jpg'
  ]);
  assert.deepEqual(paths.imagePaths, ['athlete-profile-media/user-1/player-1/legacy.jpg']);
});

test('collects current and legacy storage fields from account-owned media records', () => {
  assert.deepEqual(collectAccountMediaStoragePaths([
    {
      storagePath: 'team-media/team-1/folder-1/user-1/file.jpg',
      attachments: [
        { path: 'stat-sheets/team-chat/team-1/team/user-1/chat.jpg' },
        { storagePath: 'stat-sheets/team-chat/team-1/team/user-1/clip.mp4' }
      ]
    },
    { imagePath: 'athlete-profile-media/user-1/player-1/photo.jpg' }
  ]), [
    'team-media/team-1/folder-1/user-1/file.jpg',
    'stat-sheets/team-chat/team-1/team/user-1/chat.jpg',
    'stat-sheets/team-chat/team-1/team/user-1/clip.mp4',
    'athlete-profile-media/user-1/player-1/photo.jpg'
  ]);
});

test('deletes account-owned share links and invite records', () => {
  const queries = getAccountDeletionCollectionQueries();
  assert.ok(queries.some(([collection, field]) => collection === 'socialReports' && field === 'reporterId'));
  assert.ok(!queries.some(([collection]) => collection === 'socialPostReports'));
  assert.ok(queries.some(([collection, field]) => collection === 'familyShareTokens' && field === 'ownerUserId'));
  assert.ok(queries.some(([collection, field]) => collection === 'accessCodes' && field === 'generatedBy'));
  assert.ok(queries.some(([collection, field]) => collection === 'accessCodes' && field === 'usedBy'));
});

test('deletes current team media and denormalized notification indexes', () => {
  assert.deepEqual(getAccountDeletionCollectionGroupQueries(), [
    ['messages', 'authorId'],
    ['chatMessages', 'senderId'],
    ['comments', 'authorId'],
    ['reactions', 'userId'],
    ['rsvps', 'userId'],
    ['rideOffers', 'driverUserId'],
    ['rideRequests', 'parentUserId'],
    ['media', 'uploadedBy'],
    ['mediaItems', 'uploadedBy'],
    ['notificationTargets', 'uid'],
    ['notificationRecipients', 'uid']
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

  const result = await handler(
    { confirmation: 'DELETE', source: 'ios' },
    { auth: { uid: 'user-1', token: { auth_time: recentAuthTime } } }
  );
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
    () => handler(
      { confirmation: 'DELETE' },
      { auth: { uid: 'owner-1', token: { auth_time: recentAuthTime } } }
    ),
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
    () => handler(
      { confirmation: 'DELETE' },
      { auth: { uid: 'legacy-owner', token: { auth_time: recentAuthTime } } }
    ),
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
    { auth: { uid: 'user-1', token: { email: 'owner@example.com', auth_time: recentAuthTime } } }
  );

  assert.equal(result.status, 'queued');
  assert.equal(writes.length, 1);
});

test('requires a recent sign-in before queuing permanent account deletion', async () => {
  const handler = createAccountDeletionRequestHandler({
    firestore: {},
    auth: {},
    Timestamp: { now: () => 'now' },
    HttpsError
  });

  await assert.rejects(
    () => handler(
      { confirmation: 'DELETE' },
      { auth: { uid: 'user-1', token: { auth_time: recentAuthTime - 301 } } }
    ),
    (error) => error.code === 'failed-precondition' && /sign in again/i.test(error.message)
  );
});

test('gives the deletion worker extended runtime and automatic event retries', () => {
  const functionsSource = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(
    functionsSource,
    /exports\.processAccountDeletionRequest = functions\s+\.runWith\(\{ timeoutSeconds: 540, memory: '1GB', failurePolicy: true \}\)\s+\.firestore/
  );
});
