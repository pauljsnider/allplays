'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  buildDeletionAuditId,
  buildRosterParentScrubPlan,
  buildTeamAccountGrantScrubPlan,
  classifyAccountStoragePaths,
  collectAccountRosterScopes,
  collectAccountTeamIds,
  collectAccountMediaStoragePaths,
  createAccountDeletionRequestHandler,
  extractAccountProfileStoragePath,
  getAccountEmailQueryCandidates,
  getAccountTeamPermissionQueryFields,
  getLegacyUnscopedProfilePhotoPaths,
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

test('blocks only legacy unscoped profile photo paths for trusted migration', () => {
  assert.deepEqual(getLegacyUnscopedProfilePhotoPaths([
    'https://firebasestorage.googleapis.com/v0/b/images/o/user-photos%2F171234_photo.jpg?alt=media',
    'https://storage.googleapis.com/images/user-photos/user-1/photo.jpg',
    'https://example.com/photo.jpg'
  ]), ['user-photos/171234_photo.jpg']);
});

test('collects canonical roster scopes without accepting injected document paths', () => {
  assert.deepEqual(collectAccountRosterScopes({
    parentTeamIds: ['team-1', 'bad/team'],
    parentOf: [{ teamId: 'team-2', playerId: 'player-2' }],
    parentPlayerKeys: ['team-3::player-3', 'bad/team::player-4']
  }), {
    playerPaths: [
      'teams/team-2/players/player-2',
      'teams/team-3/players/player-3'
    ],
    teamIds: ['team-1', 'team-2', 'team-3']
  });
});

test('scrubs deleted parent identities and their associated roster contact fields', () => {
  assert.deepEqual(buildRosterParentScrubPlan({
    parents: [
      { userId: 'deleted-parent', email: 'deleted@example.com' },
      { accountUserId: 'remaining-parent', email: 'remaining@example.com' }
    ],
    contacts: [
      { email: 'DELETED@example.com', name: 'Deleted Parent' },
      { email: 'remaining@example.com', name: 'Remaining Parent' }
    ],
    parentUserId: 'deleted-parent',
    parentEmail: 'deleted@example.com',
    parentName: 'Deleted Parent',
    guardianUserId: 'remaining-parent'
  }, { uid: 'deleted-parent', email: 'deleted@example.com' }), {
    changed: true,
    contacts: [{ email: 'remaining@example.com', name: 'Remaining Parent' }],
    contactsChanged: true,
    parents: [{ accountUserId: 'remaining-parent', email: 'remaining@example.com' }],
    parentsChanged: true,
    fieldsToDelete: [
      'parentUserId',
      'parentEmail',
      'parentName',
      'parentPhone',
      'parentRelation'
    ]
  });
});

test('scrubs reusable email and uid grants from team authorization fields', () => {
  assert.deepEqual(collectAccountTeamIds({
    coachOf: ['team-1', 'bad/team'],
    parentTeamIds: ['team-2'],
    teamMediaUploadTeamIds: ['team-3']
  }), ['team-1', 'team-2', 'team-3']);
  assert.ok(getAccountEmailQueryCandidates('Coach@Example.com').includes(' coach@example.com '));
  assert.deepEqual(getAccountTeamPermissionQueryFields(), [
    'teamPermissions.scorekeeping.memberIds',
    'teamPermissions.streaming.memberIds',
    'teamPermissions.videography.memberIds',
    'teamPermissions.teamMediaManagement.memberIds'
  ]);
  assert.deepEqual(buildTeamAccountGrantScrubPlan({
    active: false,
    ownerId: 'deleted-user',
    ownerEmail: 'Coach@Example.com',
    adminEmails: ['coach@example.com', 'remaining@example.com'],
    streamVolunteerEmails: [' COACH@example.com ', 'streamer@example.com'],
    staffIds: ['deleted-user', 'remaining-user'],
    coaches: [
      { userId: 'deleted-user', email: 'coach@example.com' },
      { userId: 'remaining-user', email: 'remaining@example.com' }
    ],
    teamPermissions: {
      scorekeeping: { mode: 'selected', memberIds: ['deleted-user', 'remaining-user'] },
      streaming: { mode: 'all_confirmed', memberIds: [] }
    }
  }, { uid: 'deleted-user', email: 'coach@example.com' }), {
    changed: true,
    update: {
      adminEmails: ['remaining@example.com'],
      streamVolunteerEmails: ['streamer@example.com'],
      staffIds: ['remaining-user'],
      coaches: [{ userId: 'remaining-user', email: 'remaining@example.com' }],
      teamPermissions: {
        scorekeeping: { mode: 'selected', memberIds: ['remaining-user'] },
        streaming: { mode: 'all_confirmed', memberIds: [] }
      }
    },
    fieldsToDelete: ['ownerId', 'ownerEmail', 'ownerEmailLower']
  });
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
    'https://firebasestorage.googleapis.com/v0/b/images/o/stat-sheets%2Fteam-chat%2Fteam-1%2Fteam%2Fuser-1%2Fsocial.jpg?alt=media',
    'stat-sheets/team-chat/team-1/team/other-user/not-ours.jpg'
  ], [
    'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/user-photos%2F171234_photo.jpg?alt=media'
  ]);

  assert.deepEqual(paths.primaryPaths, [
    'athlete-profile-media/user-1/player-1/photo.jpg',
    'team-media/team-1/folder-1/user-1/file.jpg',
    'team-media/team-2/folder-2/user-1/photo.jpg',
    'stat-sheets/team-chat/team-1/team/user-1/chat.jpg',
    'stat-sheets/team-chat/team-1/team/user-1/social.jpg'
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
      ],
      media: [{
        url: 'https://firebasestorage.googleapis.com/v0/b/images/o/stat-sheets%2Fteam-chat%2Fteam-1%2Fteam%2Fuser-1%2Fsocial.jpg?alt=media'
      }]
    },
    { imagePath: 'athlete-profile-media/user-1/player-1/photo.jpg' }
  ]), [
    'team-media/team-1/folder-1/user-1/file.jpg',
    'stat-sheets/team-chat/team-1/team/user-1/chat.jpg',
    'stat-sheets/team-chat/team-1/team/user-1/clip.mp4',
    'https://firebasestorage.googleapis.com/v0/b/images/o/stat-sheets%2Fteam-chat%2Fteam-1%2Fteam%2Fuser-1%2Fsocial.jpg?alt=media',
    'athlete-profile-media/user-1/player-1/photo.jpg'
  ]);
});

test('deletes account-owned share links and invite records', () => {
  const queries = getAccountDeletionCollectionQueries();
  assert.ok(queries.some(([collection, field]) => collection === 'socialReports' && field === 'reporterId'));
  assert.ok(!queries.some(([collection]) => collection === 'socialPostReports'));
  assert.ok(queries.some(([collection, field, operator]) =>
    collection === 'publicOpportunities' && field === 'authorId' && operator === '=='));
  assert.ok(queries.some(([collection, field, operator]) =>
    collection === 'opportunityInquiries' && field === 'participantIds' && operator === 'array-contains'));
  assert.ok(queries.some(([collection, field, operator]) =>
    collection === 'opportunityInquiries' && field === 'recipientUserIds' && operator === 'array-contains'));
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
    ['membershipRequests', 'requesterUserId'],
    ['registrations', 'submittedByUserId'],
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
      doc: (path) => ({
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async (value) => writes.push({ path, value })
      })
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
      doc: (path) => ({
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async (value) => writes.push({ path, value })
      })
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

test('blocks queuing until a legacy unscoped profile photo is migrated', async () => {
  const handler = createAccountDeletionRequestHandler({
    firestore: {
      collection: () => ({
        where: () => ({ get: async () => ({ docs: [] }) })
      }),
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({
            photoUrl: 'https://firebasestorage.googleapis.com/v0/b/images/o/user-photos%2F171234_photo.jpg?alt=media'
          })
        })
      })
    },
    auth: { getUser: async () => ({ email: 'parent@example.com' }) },
    Timestamp: { now: () => 'now' },
    HttpsError
  });

  await assert.rejects(
    () => handler(
      { confirmation: 'DELETE' },
      { auth: { uid: 'user-1', token: { auth_time: recentAuthTime } } }
    ),
    (error) => error.code === 'failed-precondition' &&
      error.details.reason === 'legacy-profile-photo-migration-required'
  );
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
  const teamLoaderSource = functionsSource.slice(
    functionsSource.indexOf('async function loadAccountTeamDocuments'),
    functionsSource.indexOf('async function scrubAccountTeamGrants')
  );
  assert.match(teamLoaderSource, /where\('ownerEmail', '==', candidate\)/);
  assert.match(teamLoaderSource, /where\('ownerEmailLower', '==', candidate\)/);
  const workerSource = functionsSource.slice(functionsSource.indexOf('exports.processAccountDeletionRequest'));
  assert.match(functionsSource, /deleteAccountQuery[\s\S]*firestore\.recursiveDelete\(docSnapshot\.ref\)/);
  assert.ok(workerSource.indexOf('await scrubAccountTeamGrants(') < workerSource.indexOf('admin.auth().deleteUser(uid)'));
  assert.ok(workerSource.indexOf('await scrubAccountRosterParentLinks(') < workerSource.indexOf('admin.auth().deleteUser(uid)'));
});
