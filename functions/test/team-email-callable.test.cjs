const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;
const originalSenderSendLimit = process.env.TEAM_EMAIL_SENDER_SEND_LIMIT;
const originalTeamSendLimit = process.env.TEAM_EMAIL_TEAM_SEND_LIMIT;

let adminStub;
let functionsStub;
let StripeStub;

function patchedModuleLoad(request, parent, isMain) {
  if (request === 'firebase-admin' && adminStub) return adminStub;
  if (request === 'firebase-functions' && functionsStub) return functionsStub;
  if (request === 'stripe' && StripeStub) return StripeStub;
  if (request === 'resend') return { Resend: class ResendStub {} };
  return originalModuleLoad(request, parent, isMain);
}

function makeFunctionsStub() {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const triggerChain = {
    onCall: (handler) => handler,
    onRequest: (handler) => handler,
    onCreate: (handler) => handler,
    onUpdate: (handler) => handler,
    onWrite: (handler) => handler,
    onDelete: (handler) => handler,
    onRun: (handler) => handler,
    document() { return this; },
    schedule() { return this; },
    timeZone() { return this; },
    user() { return this; }
  };
  triggerChain.https = triggerChain;
  triggerChain.auth = triggerChain;
  triggerChain.firestore = triggerChain;
  triggerChain.pubsub = triggerChain;

  return {
    config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
    auth: { user: () => triggerChain },
    https: { HttpsError, onCall: (handler) => handler, onRequest: (handler) => handler },
    firestore: { document: () => triggerChain },
    pubsub: { schedule: () => triggerChain },
    runWith: () => triggerChain,
    logger: { error() {}, warn() {}, info() {} }
  };
}

function makeFirestore(seed) {
  const state = new Map(Object.entries(seed));
  const committedWrites = [];
  const collectionCounters = new Map();
  let mailJobRefsCreated = 0;
  let batchCommitCounter = 0;
  let transactionQueue = Promise.resolve();

  function snapshot(path) {
    const value = state.get(path);
    return {
      id: path.split('/').pop(),
      exists: value !== undefined,
      data: () => value
    };
  }

  function doc(path) {
    return {
      id: path.split('/').pop(),
      path,
      get: async () => snapshot(path),
      set: async (value, options) => {
        committedWrites.push({ path, value, options });
        state.set(path, value);
      }
    };
  }

  function collection(path) {
    return {
      doc(requestedId) {
        if (path === 'mail') mailJobRefsCreated += 1;
        if (requestedId) return doc(`${path}/${requestedId}`);
        const nextId = (collectionCounters.get(path) || 0) + 1;
        collectionCounters.set(path, nextId);
        return doc(`${path}/auto-${nextId}`);
      },
      async get() {
        const depth = path.split('/').length + 1;
        const docs = [...state.keys()]
          .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
          .map(snapshot);
        return { docs };
      },
      async add(value) {
        const nextId = (collectionCounters.get(path) || 0) + 1;
        collectionCounters.set(path, nextId);
        const write = { path: `${path}/auto-${nextId}`, value };
        committedWrites.push(write);
        state.set(write.path, value);
        return doc(write.path);
      },
      orderBy() {
        return {
          limit() {
            return {
              async get() {
                const depth = path.split('/').length + 1;
                const docs = [...state.keys()]
                  .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
                  .map(snapshot);
                return { docs };
              }
            };
          }
        };
      }
    };
  }

  return {
    doc,
    collection,
    findUserIdByEmail(email) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const userEntry = [...state.entries()].find(([path, value]) => (
        /^users\/[^/]+$/.test(path)
        && String(value?.email || '').trim().toLowerCase() === normalizedEmail
      ));
      return userEntry ? userEntry[0].split('/').pop() : null;
    },
    batch() {
      const writes = [];
      return {
        set(ref, value, options) {
          writes.push({ path: ref.path, value, options });
        },
        async commit() {
          batchCommitCounter += 1;
          writes.forEach((write) => {
            committedWrites.push({ ...write, batchCommitId: batchCommitCounter });
            state.set(write.path, write.value);
          });
        }
      };
    },
    runTransaction(handler) {
      const execute = async () => {
        const writes = [];
        const result = await handler({
          get: async (ref) => snapshot(ref.path),
          set(ref, value, options) {
            writes.push({ path: ref.path, value, options });
          }
        });
        writes.forEach((write) => {
          committedWrites.push(write);
          state.set(write.path, write.value);
        });
        return result;
      };
      const result = transactionQueue.then(execute, execute);
      transactionQueue = result.then(() => undefined, () => undefined);
      return result;
    },
    get mailJobRefsCreated() {
      return mailJobRefsCreated;
    },
    get committedWrites() {
      return committedWrites;
    },
    documentsWithPrefix(prefix) {
      return [...state.entries()].filter(([path]) => path.startsWith(prefix));
    }
  };
}

function loadCallables(seed, storageMetadata = {}, sharedFirestore = null) {
  delete require.cache[repoIndexPath];
  const firestore = sharedFirestore || makeFirestore(seed);
  const fieldValue = {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    delete: () => ({ __op: 'delete' }),
    increment: (amount) => ({ __op: 'increment', amount }),
    arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
  };
  adminStub = {
    apps: [true],
    initializeApp() {},
    firestore: Object.assign(() => firestore, {
      FieldValue: fieldValue,
      FieldPath: { documentId: () => '__name__' }
    }),
    auth: () => ({
      verifyIdToken: async () => null,
      getUserByEmail: async (email) => {
        const uid = firestore.findUserIdByEmail(email);
        if (!uid) throw new Error('User not found');
        return { uid };
      }
    }),
    messaging: () => ({}),
    storage: () => ({
      bucket: () => ({
        file: (path) => ({
          getMetadata: async () => [{ name: path, ...storageMetadata[path] }]
        })
      })
    })
  };
  functionsStub = makeFunctionsStub();
  StripeStub = class StripeMock {
    constructor() {
      return {
        checkout: { sessions: { create: async () => ({}) } },
        webhooks: { constructEvent: () => { throw new Error('Not implemented in test.'); } }
      };
    }
  };
  return { callables: require('../index.js'), firestore };
}

test.beforeEach(() => {
  Module._load = patchedModuleLoad;
  process.env.TEAM_EMAIL_SENDER_SEND_LIMIT = '2';
  process.env.TEAM_EMAIL_TEAM_SEND_LIMIT = '3';
});

test.afterEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = originalModuleLoad;
  adminStub = null;
  functionsStub = null;
  StripeStub = null;
  if (originalSenderSendLimit === undefined) delete process.env.TEAM_EMAIL_SENDER_SEND_LIMIT;
  else process.env.TEAM_EMAIL_SENDER_SEND_LIMIT = originalSenderSendLimit;
  if (originalTeamSendLimit === undefined) delete process.env.TEAM_EMAIL_TEAM_SEND_LIMIT;
  else process.env.TEAM_EMAIL_TEAM_SEND_LIMIT = originalTeamSendLimit;
});

function makeRateLimitSeed() {
  return {
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'teams/team-2': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { fullName: 'Owner' },
    'users/admin-2': { fullName: 'Admin Two', isAdmin: true },
    'users/admin-3': { fullName: 'Admin Three', isAdmin: true },
    'users/admin-4': { fullName: 'Admin Four', isAdmin: true },
    'teams/team-1/players/player-1': {
      active: true,
      parents: [{ userId: 'parent-1', email: 'parent@example.com' }]
    },
    'teams/team-2/players/player-2': {
      active: true,
      parents: [{ userId: 'parent-2', email: 'other-parent@example.com' }]
    },
    'teams/team-1/emailDrafts/draft-1': {
      subject: 'Saved update',
      body: 'Saved message.',
      targetType: 'full_team'
    }
  };
}

function sendRateLimitedEmail(callables, { teamId = 'team-1', uid = 'owner-1', draftId = '' } = {}) {
  return callables.sendTeamEmail({
    teamId,
    draftId,
    subject: 'Update',
    body: 'Practice moved.'
  }, { auth: { uid, token: { email: `${uid}@example.com` } } });
}

test('sendTeamEmail rejects an unauthorized caller before creating mail jobs', async () => {
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: ['coach@example.com'] },
    'users/outsider-1': { isAdmin: false }
  });

  await assert.rejects(
    callables.sendTeamEmail(
      { teamId: 'team-1', subject: 'Update', body: 'Practice moved.', postToTeamChat: true },
      { auth: { uid: 'outsider-1', token: { email: 'outsider@example.com' } } }
    ),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(firestore.mailJobRefsCreated, 0);
  assert.equal(firestore.documentsWithPrefix('teamEmailRateLimits/').length, 0);
  assert.equal(firestore.documentsWithPrefix('teams/team-1/teamEmails/').length, 0);
  assert.equal(firestore.documentsWithPrefix('teams/team-1/chatMessages/').length, 0);
});

test('sendTeamEmail validates payloads before reserving rate-limit capacity', async () => {
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { fullName: 'Owner' }
  });

  await assert.rejects(
    callables.sendTeamEmail(
      { teamId: 'team-1', subject: '', body: 'Practice moved.' },
      { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }
    ),
    (error) => error.code === 'invalid-argument'
  );
  assert.equal(firestore.documentsWithPrefix('teamEmailRateLimits/').length, 0);
  assert.equal(firestore.mailJobRefsCreated, 0);
});

test('sendTeamEmail keeps sender and team limits durable across handler reloads with no rejected side effects', async () => {
  const firstLoad = loadCallables(makeRateLimitSeed());
  await sendRateLimitedEmail(firstLoad.callables);

  const secondLoad = loadCallables({}, {}, firstLoad.firestore);
  await sendRateLimitedEmail(secondLoad.callables);
  await assert.rejects(
    sendRateLimitedEmail(secondLoad.callables, { draftId: 'draft-1' }),
    (error) => error.code === 'resource-exhausted' && /try again in about/.test(error.message)
  );

  assert.equal(firstLoad.firestore.committedWrites.filter((write) => write.path.startsWith('mail/')).length, 2);
  assert.equal(firstLoad.firestore.committedWrites.filter((write) => write.path.startsWith('teams/team-1/teamEmails/')).length, 2);
  assert.equal(firstLoad.firestore.committedWrites.filter((write) => write.path === 'teams/team-1/emailDrafts/draft-1').length, 0);
  assert.equal(firstLoad.firestore.committedWrites.filter((write) => write.path.startsWith('users/parent-1/notificationInbox/')).length, 2);

  const otherTeamResult = await sendRateLimitedEmail(secondLoad.callables, { teamId: 'team-2' });
  assert.equal(otherTeamResult.recipientCount, 1);
});

test('sendTeamEmail enforces the team-wide limit sequentially across isolated senders', async () => {
  const { callables, firestore } = loadCallables(makeRateLimitSeed());
  await sendRateLimitedEmail(callables, { uid: 'owner-1' });
  await sendRateLimitedEmail(callables, { uid: 'owner-1' });
  await sendRateLimitedEmail(callables, { uid: 'admin-2' });

  await assert.rejects(
    sendRateLimitedEmail(callables, { uid: 'admin-2', draftId: 'draft-1' }),
    (error) => error.code === 'resource-exhausted'
  );
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('mail/')).length, 3);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('teams/team-1/teamEmails/')).length, 3);
  assert.equal(firestore.committedWrites.filter((write) => write.path === 'teams/team-1/emailDrafts/draft-1').length, 0);
});

test('sendTeamEmail atomically caps concurrent requests at the sender limit', async () => {
  const { callables, firestore } = loadCallables(makeRateLimitSeed());
  const results = await Promise.allSettled([
    sendRateLimitedEmail(callables),
    sendRateLimitedEmail(callables),
    sendRateLimitedEmail(callables)
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'resource-exhausted').length, 1);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('mail/')).length, 2);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('teams/team-1/teamEmails/')).length, 2);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('users/parent-1/notificationInbox/')).length, 2);
});

test('sendTeamEmail atomically caps concurrent requests at the team-wide limit', async () => {
  const { callables, firestore } = loadCallables(makeRateLimitSeed());
  const results = await Promise.allSettled([
    sendRateLimitedEmail(callables, { uid: 'owner-1' }),
    sendRateLimitedEmail(callables, { uid: 'admin-2' }),
    sendRateLimitedEmail(callables, { uid: 'admin-3' }),
    sendRateLimitedEmail(callables, { uid: 'admin-4' })
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 3);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'resource-exhausted').length, 1);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('mail/')).length, 3);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('teams/team-1/teamEmails/')).length, 3);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('users/parent-1/notificationInbox/')).length, 3);
});

test('sendTeamEmail rejects a cross-team recipient before creating mail jobs', async () => {
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { fullName: 'Owner' },
    'teams/team-1/players/player-1': {
      active: true,
      parents: [{ userId: 'parent-1', email: 'parent@example.com' }]
    }
  });

  await assert.rejects(
    callables.sendTeamEmail({
      teamId: 'team-1',
      subject: 'Update',
      body: 'Practice moved.',
      targetType: 'individuals',
      recipientIds: ['player:other-team-player']
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }),
    (error) => error.code === 'invalid-argument' && /no longer eligible/.test(error.message)
  );
  assert.equal(firestore.mailJobRefsCreated, 0);
});

test('sendTeamEmail queues an authorized selected-member send with verified attachment metadata', async () => {
  const attachmentPath = 'team-email-attachments/team-1/draft-1/owner-1/plan.pdf';
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { fullName: 'Team Owner', email: 'owner@example.com' },
    'teams/team-1/players/player-1': {
      active: true,
      parents: [{ userId: 'parent-1', email: 'selected@example.com' }]
    },
    'teams/team-1/players/player-2': {
      active: true,
      parents: [{ userId: 'parent-2', email: 'excluded@example.com' }]
    }
  }, {
    [attachmentPath]: { size: '2048', contentType: 'application/pdf' }
  });

  const result = await callables.sendTeamEmail({
    teamId: 'team-1',
    subject: 'Practice update',
    body: 'Practice moved.',
    targetType: 'individuals',
    recipientIds: ['player:player-1'],
    postToTeamChat: true,
    attachments: [{
      name: 'plan.pdf',
      storagePath: attachmentPath,
      size: 1,
      contentType: 'text/plain'
    }]
  }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });

  assert.equal(result.status, 'sent');
  assert.equal(result.recipientCount, 1);
  assert.equal(result.inboxWriteCount, 1);
  assert.equal(result.inboxFailureCount, 0);
  assert.equal(result.chatPostCreated, false);
  assert.equal(result.chatMessageId, null);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('teams/team-1/chatMessages/')).length, 0);
  const historyWrite = firestore.committedWrites.find((write) => write.path.startsWith('teams/team-1/teamEmails/'));
  assert.ok(historyWrite);
  assert.equal(historyWrite.value.targetType, 'individuals');
  assert.equal(historyWrite.value.recipientCount, 1);
  assert.deepEqual(historyWrite.value.recipientSummary, [{
    playerIds: ['player-1'],
    userIds: ['parent-1'],
    roles: ['guardian']
  }]);
  assert.deepEqual(historyWrite.value.attachments, [{
    name: 'plan.pdf',
    storagePath: attachmentPath,
    contentType: 'application/pdf',
    size: 2048
  }]);
  assert.equal(historyWrite.value.attachmentTotalBytes, 2048);

  const mailWrites = firestore.committedWrites.filter((write) => write.path.startsWith('mail/'));
  assert.equal(mailWrites.length, 1);
  assert.deepEqual(mailWrites[0].value.to, ['selected@example.com']);
  assert.equal(mailWrites[0].value.metadata.teamEmailMessageId, historyWrite.path.split('/').pop());
  assert.deepEqual(mailWrites[0].value.metadata.attachments, historyWrite.value.attachments);
  assert.equal(mailWrites[0].value.metadata.attachmentTotalBytes, 2048);
  const inboxWrites = firestore.committedWrites.filter((write) => write.path.startsWith('users/parent-1/notificationInbox/'));
  assert.equal(inboxWrites.length, 1);
  assert.equal(inboxWrites[0].value.category, 'team_email');
  assert.equal(inboxWrites[0].value.title, 'Team email: Practice update');
  assert.equal(inboxWrites[0].value.body, 'Practice moved.');
  assert.equal(inboxWrites[0].value.appRoute, '/messages/team-1?conversationId=team');
  assert.equal(inboxWrites[0].value.conversationId, 'team');
  assert.equal(firestore.committedWrites.some((write) => write.path.startsWith('users/owner-1/notificationInbox/')), false);
});

test('sendTeamEmail creates one atomically linked full-team chat post when enabled', async () => {
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { fullName: 'Team Owner', email: 'owner@example.com' },
    'teams/team-1/players/player-1': {
      active: true,
      parents: [{ userId: 'parent-1', email: 'one@example.com' }]
    },
    'teams/team-1/players/player-2': {
      active: true,
      parents: [{ userId: 'parent-2', email: 'two@example.com' }]
    }
  });

  const result = await callables.sendTeamEmail({
    teamId: 'team-1',
    subject: 'Schedule change',
    body: 'Practice starts at six.',
    targetType: 'full_team',
    postToTeamChat: true
  }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com', name: 'Owner Token' } } });

  const emailWrites = firestore.committedWrites.filter((write) => write.path.startsWith('teams/team-1/teamEmails/'));
  const chatWrites = firestore.committedWrites.filter((write) => write.path.startsWith('teams/team-1/chatMessages/'));
  const mailWrites = firestore.committedWrites.filter((write) => write.path.startsWith('mail/'));
  assert.equal(emailWrites.length, 1);
  assert.equal(chatWrites.length, 1);
  assert.equal(mailWrites.length, 2);

  const emailWrite = emailWrites[0];
  const chatWrite = chatWrites[0];
  const emailId = emailWrite.path.split('/').pop();
  const chatId = chatWrite.path.split('/').pop();
  assert.equal(emailWrite.value.chatMessageId, chatId);
  assert.equal(chatWrite.value.teamEmailMessageId, emailId);
  assert.equal(chatWrite.value.text, 'Schedule change\n\nPractice starts at six.');
  assert.equal(chatWrite.value.senderId, 'owner-1');
  assert.equal(chatWrite.value.senderName, 'Team Owner');
  assert.equal(chatWrite.value.senderEmail, 'owner@example.com');
  assert.equal(chatWrite.value.targetType, 'full_team');
  assert.deepEqual(chatWrite.value.recipientIds, []);
  assert.deepEqual(chatWrite.value.attachments, []);
  assert.equal(chatWrite.value.conversationId, null);
  assert.equal(chatWrite.value.deleted, false);
  assert.equal(emailWrite.batchCommitId, chatWrite.batchCommitId);
  assert.equal(mailWrites.every((write) => write.batchCommitId === emailWrite.batchCommitId), true);
  assert.equal(result.recipientCount, 2);
  assert.equal(result.chatPostCreated, true);
  assert.equal(result.chatMessageId, chatId);
  assert.equal(result.inboxWriteCount, 0);
  assert.equal(result.inboxFailureCount, 0);
  assert.equal(firestore.committedWrites.some((write) => write.path.startsWith('users/parent-1/notificationInbox/')), false);
  assert.equal(firestore.committedWrites.some((write) => write.path.startsWith('users/parent-2/notificationInbox/')), false);
});

test('sendTeamEmail preserves full-team email-only behavior when chat posting is disabled', async () => {
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { fullName: 'Team Owner', email: 'owner@example.com' },
    'teams/team-1/players/player-1': {
      active: true,
      parents: [{ userId: 'parent-1', email: 'parent@example.com' }]
    }
  });

  const result = await callables.sendTeamEmail({
    teamId: 'team-1',
    subject: 'Email only',
    body: 'No chat copy.',
    targetType: 'full_team',
    postToTeamChat: false
  }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });

  assert.equal(result.recipientCount, 1);
  assert.equal(result.chatPostCreated, false);
  assert.equal(result.chatMessageId, null);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('teams/team-1/chatMessages/')).length, 0);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('mail/')).length, 1);
  assert.equal(firestore.committedWrites.filter((write) => write.path.startsWith('users/parent-1/notificationInbox/')).length, 1);
});
