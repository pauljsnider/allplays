const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMergedParentAccount,
  buildMergedPlayerParents,
  isVerifiedAccountMergeRequest
} = require('../account-merge-core.cjs');

test('buildMergedParentAccount unions parent links, roles, and notification fields without duplicates', () => {
  const merged = buildMergedParentAccount(
    {
      parentOf: [{ teamId: 'team-1', playerId: 'p1', playerName: 'A' }],
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::p1'],
      roles: ['parent'],
      notificationPreferences: { channels: ['email'], schedule: { email: true } }
    },
    {
      parentOf: [
        { teamId: 'team-1', playerId: 'p1', relation: 'guardian' },
        { teamId: 'team-2', playerId: 'p2', playerName: 'B' }
      ],
      parentTeamIds: ['team-1', 'team-2'],
      parentPlayerKeys: ['team-1::p1', 'team-2::p2'],
      roles: ['parent', 'fan'],
      notificationPreferences: { channels: ['email', 'sms'], schedule: { push: true } }
    }
  );

  assert.deepEqual(merged.parentTeamIds, ['team-1', 'team-2']);
  assert.deepEqual(merged.parentPlayerKeys, ['team-1::p1', 'team-2::p2']);
  assert.deepEqual(merged.roles, ['parent', 'fan']);
  assert.equal(merged.parentOf.length, 2);
  assert.deepEqual(merged.notificationPreferences.channels, ['email', 'sms']);
  assert.deepEqual(merged.notificationPreferences.schedule, { email: true, push: true });
});

test('buildMergedPlayerParents rewrites source uid and deduplicates idempotent retries', () => {
  const first = buildMergedPlayerParents([
    { userId: 'source', email: 'old@example.com', relation: 'parent' },
    { userId: 'dest', email: 'new@example.com', status: 'active' }
  ], 'source', 'dest');

  assert.equal(first.changed, true);
  assert.equal(first.parents.length, 1);
  assert.equal(first.parents[0].userId, 'dest');

  const second = buildMergedPlayerParents(first.parents, 'source', 'dest');
  assert.equal(second.changed, false);
  assert.deepEqual(second.parents, first.parents);
});

test('isVerifiedAccountMergeRequest rejects unverified or mismatched requests', () => {
  assert.equal(isVerifiedAccountMergeRequest({ sourceUid: 's', destinationUid: 'd', status: 'draft' }, { sourceUid: 's', destinationUid: 'd' }), false);
  assert.equal(isVerifiedAccountMergeRequest({ sourceUid: 's', destinationUid: 'other', verified: true }, { sourceUid: 's', destinationUid: 'd' }), false);
  assert.equal(isVerifiedAccountMergeRequest({ sourceUid: 's', destinationUid: 'd', verified: true }, { sourceUid: 's', destinationUid: 'd' }), true);
  assert.equal(isVerifiedAccountMergeRequest({ sourceUid: 's', destinationUid: 'd', previewTokenHash: 'hash' }, { sourceUid: 's', destinationUid: 'd', previewTokenHash: 'hash' }), true);
});
