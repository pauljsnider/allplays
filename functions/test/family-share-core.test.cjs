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
