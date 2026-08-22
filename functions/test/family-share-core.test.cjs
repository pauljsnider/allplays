const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectOwnerParentLinks,
  isFamilyShareTokenReadable,
  resolveFamilyShareChildrenFromOwnerProfile
} = require('../family-share-core.cjs');

test('family share token readability preserves active legacy tokens and blocks revoked or expired links', () => {
  const nowMs = Date.parse('2026-06-27T12:00:00Z');

  assert.equal(isFamilyShareTokenReadable({ active: true }, nowMs), true);
  assert.equal(isFamilyShareTokenReadable({ active: false }, nowMs), false);
  assert.equal(isFamilyShareTokenReadable({ revoked: true }, nowMs), false);
  assert.equal(isFamilyShareTokenReadable({ revokedAt: { toDate: () => new Date('2026-06-01T00:00:00Z') } }, nowMs), false);
  assert.equal(
    isFamilyShareTokenReadable({ expiresAt: { toDate: () => new Date('2026-06-28T00:00:00Z') } }, nowMs),
    true
  );
  assert.equal(
    isFamilyShareTokenReadable({ expiresAt: { toDate: () => new Date('2026-06-26T00:00:00Z') } }, nowMs),
    false
  );
});

test('family share child resolver rebuilds public child rows from owner parent scope', async () => {
  const profile = {
    parentOf: [
      {
        teamId: 'team-1',
        teamName: 'Old Bears',
        playerId: 'player-1',
        playerName: 'Old Pat',
        playerNumber: '7',
        playerPhotoUrl: 'old-photo.jpg'
      }
    ],
    parentPlayerKeys: [
      'team-1::player-1',
      'team-2::player-2',
      'team-3::inactive-player',
      'team-archived::player-4'
    ]
  };

  assert.deepEqual(collectOwnerParentLinks(profile).map((link) => `${link.teamId}::${link.playerId}`), [
    'team-1::player-1',
    'team-2::player-2',
    'team-3::inactive-player',
    'team-archived::player-4'
  ]);

  const teams = {
    'team-1': { name: 'Bears' },
    'team-2': { name: 'Hawks' },
    'team-3': { name: 'Wolves' },
    'team-archived': { name: 'Archived', archived: true }
  };
  const players = {
    'team-1::player-1': { name: 'Pat Star', number: '9', photoUrl: 'pat.jpg' },
    'team-2::player-2': { name: 'Avery Stone', number: '11', photoUrl: 'avery.jpg' },
    'team-3::inactive-player': { name: 'Inactive', active: false },
    'team-archived::player-4': { name: 'Archived Player' }
  };

  const children = await resolveFamilyShareChildrenFromOwnerProfile(profile, {
    loadTeam: async (teamId) => teams[teamId] || null,
    loadPlayer: async (teamId, playerId) => players[`${teamId}::${playerId}`] || null
  });

  assert.deepEqual(children, [
    {
      teamId: 'team-1',
      teamName: 'Bears',
      playerId: 'player-1',
      playerName: 'Pat Star',
      playerNumber: '9',
      playerPhotoUrl: 'pat.jpg'
    },
    {
      teamId: 'team-2',
      teamName: 'Hawks',
      playerId: 'player-2',
      playerName: 'Avery Stone',
      playerNumber: '11',
      playerPhotoUrl: 'avery.jpg'
    }
  ]);
});

test('family share child resolver filters requested keys before bounded profile reads', async () => {
  const profile = {
    parentPlayerKeys: Array.from({ length: 100 }, (_, index) => `team-${index}::player-${index}`)
  };
  const teamLoads = [];
  const playerLoads = [];
  const children = await resolveFamilyShareChildrenFromOwnerProfile(profile, {
    allowedKeys: new Set(['team-99::player-99']),
    maxChildren: 50,
    loadTeam: async (teamId) => {
      teamLoads.push(teamId);
      return { name: 'Selected Team' };
    },
    loadPlayer: async (teamId, playerId) => {
      playerLoads.push(`${teamId}::${playerId}`);
      return { name: 'Selected Player' };
    }
  });

  assert.deepEqual(teamLoads, ['team-99']);
  assert.deepEqual(playerLoads, ['team-99::player-99']);
  assert.deepEqual(children.map((child) => `${child.teamId}::${child.playerId}`), [
    'team-99::player-99'
  ]);
});

test('family share child resolution does not restore stale parentOf links after canonical revocation', async () => {
  const staleLink = { teamId: 'team-1', playerId: 'player-1', playerName: 'Stale Player' };

  for (const profile of [
    { parentOf: [staleLink], parentTeamIds: [], parentPlayerKeys: [] },
    { parentOf: [staleLink], parentTeamIds: null, parentPlayerKeys: null },
    { parentOf: [staleLink], parentTeamIds: ['team-1'] },
    { parentOf: [staleLink], parentPlayerKeys: ['team-1::player-1::junk'] }
  ]) {
    assert.deepEqual(collectOwnerParentLinks(profile), []);
    const children = await resolveFamilyShareChildrenFromOwnerProfile(profile, {
      loadTeam: async () => ({ name: 'Private Team' }),
      loadPlayer: async () => ({ name: 'Private Player' })
    });
    assert.deepEqual(children, []);
  }
});

test('family share child resolution ignores coerced non-string canonical and legacy ids', () => {
  assert.deepEqual(collectOwnerParentLinks({
    parentOf: [{ teamId: 123, playerId: 'player-1' }],
    parentTeamIds: [123],
    parentPlayerKeys: [123]
  }), []);
  assert.deepEqual(collectOwnerParentLinks({
    parentOf: [{ teamId: '123', playerId: 'player-1' }],
    parentTeamIds: [123],
    parentPlayerKeys: ['123::player-1']
  }), []);
});

test('family share child resolution keeps only the exact canonical player on an authorized team', async () => {
  const profile = {
    parentOf: [
      { teamId: 'team-1', playerId: 'player-a', playerName: 'Removed Player' },
      { teamId: 'team-1', playerId: 'player-b', playerName: 'Current Player' }
    ],
    parentTeamIds: ['team-1'],
    parentPlayerKeys: ['team-1::player-b']
  };

  assert.deepEqual(
    collectOwnerParentLinks(profile).map((link) => `${link.teamId}::${link.playerId}`),
    ['team-1::player-b']
  );
  const children = await resolveFamilyShareChildrenFromOwnerProfile(profile, {
    loadTeam: async () => ({ name: 'Private Team' }),
    loadPlayer: async (_teamId, playerId) => ({ name: playerId })
  });
  assert.deepEqual(children.map((child) => child.playerId), ['player-b']);
});
