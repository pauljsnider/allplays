const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addCanonicalParentAccessLink,
  mergeCanonicalParentAccess,
  removeCanonicalParentAccessLinks,
  resolveCanonicalParentAccess
} = require('../parent-access-core.cjs');

test('canonical player keys are exact and stale parent metadata cannot restore access', () => {
  assert.deepEqual(resolveCanonicalParentAccess({
    parentOf: [
      { teamId: 'team-1', playerId: 'player-1' },
      { teamId: 'team-1', playerId: 'player-revoked' },
      { teamId: 'team-revoked', playerId: 'player-old' }
    ],
    parentTeamIds: ['team-1'],
    parentPlayerKeys: ['team-1::player-1']
  }), {
    parentLinks: [{ teamId: 'team-1', playerId: 'player-1' }],
    parentTeamIds: ['team-1'],
    parentPlayerKeys: ['team-1::player-1'],
    hasCanonicalParentTeamIds: true,
    hasCanonicalParentPlayerKeys: true
  });
});

test('present malformed and team-only canonical fields fail closed for child links', () => {
  const result = resolveCanonicalParentAccess({
    parentOf: [{ teamId: 'team-1', playerId: 'player-stale' }],
    parentTeamIds: ['team-1', 123],
    parentPlayerKeys: ['team-1::player-stale::extra', 123]
  });

  assert.deepEqual(result.parentLinks, []);
  assert.deepEqual(result.parentTeamIds, ['team-1']);
  assert.deepEqual(result.parentPlayerKeys, []);

  assert.deepEqual(resolveCanonicalParentAccess({
    parentOf: [{ teamId: 'team-1', playerId: 'player-stale' }],
    parentTeamIds: ['team-1']
  }).parentLinks, []);
});

test('adding one approved link preserves canonical grants but drops stale metadata', () => {
  const result = addCanonicalParentAccessLink({
    parentOf: [
      { teamId: 'team-1', playerId: 'player-1', playerName: 'Current' },
      { teamId: 'team-1', playerId: 'player-revoked', playerName: 'Revoked' },
      { teamId: 'old-team', playerId: 'old-player' }
    ],
    parentTeamIds: ['team-1'],
    parentPlayerKeys: ['team-1::player-1']
  }, { teamId: 'team-2', playerId: 'player-2', playerName: 'New' });

  assert.deepEqual(result.parentOf, [
    { teamId: 'team-1', playerId: 'player-1', playerName: 'Current' },
    { teamId: 'team-2', playerId: 'player-2', playerName: 'New' }
  ]);
  assert.deepEqual(result.parentTeamIds, ['team-1', 'team-2']);
  assert.deepEqual(result.parentPlayerKeys, ['team-1::player-1', 'team-2::player-2']);
});

test('removing one link cannot promote stale siblings or teams', () => {
  const result = removeCanonicalParentAccessLinks({
    roles: ['parent', 'member'],
    parentOf: [
      { teamId: 'team-1', playerId: 'player-1' },
      { teamId: 'team-1', playerId: 'player-stale' },
      { teamId: 'team-stale', playerId: 'player-old' }
    ],
    parentTeamIds: ['team-1'],
    parentPlayerKeys: ['team-1::player-1']
  }, ['team-1::player-1']);

  assert.deepEqual(result, {
    parentOf: [],
    parentTeamIds: [],
    parentPlayerKeys: [],
    roles: ['member']
  });
});

test('account merging combines only each account canonical access', () => {
  const result = mergeCanonicalParentAccess({
    parentOf: [
      { teamId: 'team-a', playerId: 'player-a' },
      { teamId: 'team-a', playerId: 'player-revoked' }
    ],
    parentTeamIds: ['team-a'],
    parentPlayerKeys: ['team-a::player-a']
  }, {
    parentOf: [
      { teamId: 'team-b', playerId: 'player-b' },
      { teamId: 'team-old', playerId: 'player-old' }
    ],
    parentTeamIds: ['team-b'],
    parentPlayerKeys: ['team-b::player-b']
  });

  assert.deepEqual(result, {
    parentOf: [
      { teamId: 'team-a', playerId: 'player-a' },
      { teamId: 'team-b', playerId: 'player-b' }
    ],
    parentTeamIds: ['team-a', 'team-b'],
    parentPlayerKeys: ['team-a::player-a', 'team-b::player-b']
  });
});
