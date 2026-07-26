'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInviteEmailOnCreateHandler } = require('../invite-email-trigger-core.cjs');

function createSnapshot(data) {
  return {
    id: 'invite-1',
    data: () => data
  };
}

test('server trigger auto-links a parent before queueing the latest durable invite', async () => {
  const calls = [];
  const latestInvite = {
    type: 'parent_invite',
    email: 'parent@example.com',
    generatedBy: 'coach-1',
    used: true,
    status: 'accepted',
    autoAccepted: true
  };
  const handler = createInviteEmailOnCreateHandler({
    shouldQueueInviteEmail: () => true,
    autoLinkParentInvite: async (codeId, generatedBy) => {
      calls.push(['auto-link', codeId, generatedBy]);
    },
    loadLatestInvite: async () => {
      calls.push(['reload']);
      return latestInvite;
    },
    queueInviteEmail: async (codeId, invite) => {
      calls.push(['queue', codeId, invite]);
    }
  });

  await handler(createSnapshot({
    type: 'parent_invite',
    email: 'parent@example.com',
    generatedBy: 'coach-1'
  }), { params: { codeId: 'invite-1' } });

  assert.deepEqual(calls, [
    ['auto-link', 'invite-1', 'coach-1'],
    ['reload'],
    ['queue', 'invite-1', latestInvite]
  ]);
});

test('server trigger still queues a parent invite when auto-linking fails', async () => {
  const warnings = [];
  const queueCalls = [];
  const originalInvite = {
    type: 'parent_invite',
    email: 'parent@example.com',
    generatedBy: 'coach-1'
  };
  const handler = createInviteEmailOnCreateHandler({
    shouldQueueInviteEmail: () => true,
    autoLinkParentInvite: async () => {
      throw new Error('Account lookup unavailable');
    },
    loadLatestInvite: async () => originalInvite,
    queueInviteEmail: async (...args) => queueCalls.push(args),
    logger: { warn: (...args) => warnings.push(args) }
  });

  await handler(createSnapshot(originalInvite), { params: { codeId: 'invite-1' } });

  assert.equal(warnings.length, 1);
  assert.deepEqual(queueCalls, [['invite-1', originalInvite]]);
});

test('server trigger propagates queue failures so the platform retries delivery', async () => {
  const handler = createInviteEmailOnCreateHandler({
    shouldQueueInviteEmail: () => true,
    autoLinkParentInvite: async () => {},
    loadLatestInvite: async (snapshot) => snapshot.data(),
    queueInviteEmail: async () => {
      throw new Error('Mail queue unavailable');
    }
  });

  await assert.rejects(
    handler(createSnapshot({
      type: 'parent_invite',
      email: 'parent@example.com',
      generatedBy: 'coach-1'
    }), { params: { codeId: 'invite-1' } }),
    /Mail queue unavailable/
  );
});

test('server trigger ignores invite records without a deliverable email', async () => {
  let queued = false;
  const handler = createInviteEmailOnCreateHandler({
    shouldQueueInviteEmail: () => false,
    autoLinkParentInvite: async () => {},
    loadLatestInvite: async () => ({}),
    queueInviteEmail: async () => {
      queued = true;
    }
  });

  await handler(createSnapshot({ type: 'parent_invite', email: null }), {
    params: { codeId: 'invite-1' }
  });

  assert.equal(queued, false);
});
