'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCoParentInviteHandler } = require('../co-parent-invite-core.cjs');
const { buildParentInviteEmailMessage, shouldQueueInviteEmailOnCreate } = require('../invite-email-core.cjs');
const { buildInviteMailDocId } = require('../invite-email-queue-core.cjs');
const { createInviteEmailOnCreateHandler } = require('../invite-email-trigger-core.cjs');

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const NOW_MILLIS = 1_777_777_777_000;
const NOW = Object.freeze({ seconds: NOW_MILLIS / 1000, nanoseconds: 0 });

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createFirestore(initialDocs = {}) {
  const docs = new Map(Object.entries(initialDocs).map(([path, value]) => [path, clone(value)]));
  const accessCodeCreateEvents = [];

  function makeSnapshot(path) {
    const exists = docs.has(path);
    const ref = makeRef(path);
    return {
      id: ref.id,
      ref,
      exists,
      data: () => exists ? clone(docs.get(path)) : undefined
    };
  }

  function makeRef(path) {
    return {
      id: path.split('/').pop(),
      path,
      async get() {
        return makeSnapshot(path);
      },
      async create(value) {
        if (docs.has(path)) {
          throw Object.assign(new Error(`Document already exists: ${path}`), { code: 6 });
        }
        docs.set(path, clone(value));
      }
    };
  }

  const firestore = {
    doc: makeRef,
    collection(path) {
      const filters = [];
      const collection = {
        doc: (id) => makeRef(`${path}/${id}`),
        where(field, operator, expected) {
          assert.equal(operator, '==');
          filters.push({ field, expected });
          return collection;
        }
      };
      return Object.assign(collection, { kind: 'query', path, filters });
    },
    async runTransaction(handler) {
      const stagedCreates = [];
      const stagedSets = [];
      let writeStarted = false;
      const transaction = {
        async get(target) {
          assert.equal(writeStarted, false, 'transaction reads must precede writes');
          if (target.kind === 'query') {
            const matches = [...docs.entries()]
              .filter(([path, value]) => path.startsWith(`${target.path}/`)
                && path.split('/').length === target.path.split('/').length + 1
                && target.filters.every(({ field, expected }) => value[field] === expected))
              .map(([path]) => makeSnapshot(path));
            return { docs: matches, empty: matches.length === 0 };
          }
          return makeSnapshot(target.path);
        },
        create(ref, value) {
          writeStarted = true;
          stagedCreates.push([ref.path, clone(value)]);
        },
        set(ref, value) {
          writeStarted = true;
          stagedSets.push([ref.path, clone(value)]);
        }
      };

      const result = await handler(transaction);
      for (const [path] of stagedCreates) {
        if (docs.has(path)) {
          throw Object.assign(new Error(`Document already exists: ${path}`), { code: 6 });
        }
      }
      for (const [path, value] of stagedCreates) {
        docs.set(path, value);
        if (/^accessCodes\/[^/]+$/.test(path)) accessCodeCreateEvents.push(path);
      }
      for (const [path, value] of stagedSets) docs.set(path, value);
      return result;
    }
  };

  return { firestore, docs, accessCodeCreateEvents };
}

function docsWithPrefix(docs, prefix) {
  return [...docs.entries()]
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, value]) => [path, clone(value)]);
}

function createHarness() {
  const store = createFirestore({
    'users/parent-1': { parentPlayerKeys: ['team-1::player-1'] },
    'teams/team-1': { name: 'Tigers' },
    'teams/team-1/players/player-1': { name: 'Sam' }
  });
  const callable = createCoParentInviteHandler({
    firestore: store.firestore,
    Timestamp: {
      now: () => NOW,
      fromMillis: (millis) => ({ millis })
    },
    HttpsError: TestHttpsError,
    createInviteCode: () => 'COPE1234',
    senderMaxInvites: 1,
    recipientMaxInvites: 10
  });
  const trigger = createInviteEmailOnCreateHandler({
    shouldQueueInviteEmail: shouldQueueInviteEmailOnCreate,
    autoLinkParentInvite: async () => {},
    loadLatestInvite: async (snapshot) => snapshot.data(),
    queueInviteEmail: async (codeId, invite) => {
      const message = buildParentInviteEmailMessage(invite);
      await store.firestore.collection('mail').doc(buildInviteMailDocId(codeId)).create({
        to: [invite.email],
        message: {
          subject: message.subject,
          text: message.text,
          html: message.html
        },
        metadata: {
          type: 'invite',
          inviteType: invite.type,
          accessCodeId: codeId,
          teamId: invite.teamId,
          playerId: invite.playerId,
          generatedBy: invite.generatedBy,
          messageKind: message.messageKind
        }
      });
    }
  });
  let processedCreateEvents = 0;

  return {
    ...store,
    callable,
    context: { auth: { uid: 'parent-1' } },
    async pumpAccessCodeCreateEvents() {
      while (processedCreateEvents < store.accessCodeCreateEvents.length) {
        const path = store.accessCodeCreateEvents[processedCreateEvents];
        processedCreateEvents += 1;
        const snapshot = await store.firestore.doc(path).get();
        await trigger(snapshot, { params: { codeId: snapshot.id } });
      }
    }
  };
}

test('creates one co-parent invite and mail while duplicates reuse and excess requests throttle', async () => {
  const harness = createHarness();
  const input = { teamId: 'team-1', playerId: 'player-1', email: ' CoParent@Example.COM ' };

  const created = await harness.callable(input, harness.context);
  await harness.pumpAccessCodeCreateEvents();

  assert.deepEqual(created, {
    id: 'COPE1234',
    code: 'COPE1234',
    teamName: 'Tigers',
    playerName: 'Sam',
    email: 'coparent@example.com',
    created: true,
    reused: false
  });
  assert.equal(docsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(docsWithPrefix(harness.docs, 'mail/').length, 1);
  assert.deepEqual(harness.docs.get('mail/invite_COPE1234').to, ['coparent@example.com']);
  assert.deepEqual(harness.docs.get('mail/invite_COPE1234').metadata, {
    type: 'invite',
    inviteType: 'coparent_invite',
    accessCodeId: 'COPE1234',
    teamId: 'team-1',
    playerId: 'player-1',
    generatedBy: 'parent-1',
    messageKind: 'invite'
  });

  const rateLimitsAfterCreate = docsWithPrefix(harness.docs, 'coParentInviteRateLimits/');
  const reused = await harness.callable(
    { teamId: 'team-1', playerId: 'player-1', email: 'coparent@example.com' },
    harness.context
  );
  await harness.pumpAccessCodeCreateEvents();

  assert.deepEqual(reused, { ...created, created: false, reused: true });
  assert.equal(docsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(docsWithPrefix(harness.docs, 'mail/').length, 1);
  assert.deepEqual(docsWithPrefix(harness.docs, 'coParentInviteRateLimits/'), rateLimitsAfterCreate);

  await assert.rejects(
    harness.callable(
      { teamId: 'team-1', playerId: 'player-1', email: 'second@example.com' },
      harness.context
    ),
    (error) => {
      assert.equal(error.code, 'resource-exhausted');
      assert.equal(error.details.retryAfterSeconds, 24 * 60 * 60);
      return true;
    }
  );
  await harness.pumpAccessCodeCreateEvents();

  assert.equal(docsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(docsWithPrefix(harness.docs, 'mail/').length, 1);
  assert.deepEqual(docsWithPrefix(harness.docs, 'coParentInviteRateLimits/'), rateLimitsAfterCreate);
  assert.equal(
    docsWithPrefix(harness.docs, 'teams/team-1/inviteIdempotency/').length,
    1
  );
  assert.equal(
    docsWithPrefix(harness.docs, 'mail/').some(([, mail]) => mail.to.includes('second@example.com')),
    false
  );
});
