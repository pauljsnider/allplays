'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const {
  RESTRICTED_ROSTER_KEYS,
  buildPlayerShareHtml,
  buildPlayerShareMetadata,
  buildPublicPlayerShareProjection,
  hasRestrictedRosterFieldValues,
  normalizePlayerId
} = require('../player-share-preview-core.cjs');

const publicTeam = {
  isPublic: true,
  active: true,
  name: 'Vipers FC U8B',
  sport: 'Soccer',
  ownerEmail: 'private@example.test'
};

const publicPlayer = {
  id: 'player-1',
  name: 'Avery Lee',
  number: '9',
  position: 'Forward',
  photoUrl: 'https://images.example.test/avery.jpg'
};

test('builds a bounded public projection without private team fields', () => {
  assert.deepEqual(buildPublicPlayerShareProjection({
    teamId: 'team-1',
    team: publicTeam,
    player: publicPlayer
  }), {
    team: {
      id: 'team-1',
      name: 'Vipers FC U8B',
      sport: 'Soccer',
      city: null,
      state: null,
      zip: null
    },
    player: {
      id: 'player-1',
      name: 'Avery Lee',
      number: '9',
      position: 'Forward'
    }
  });
});

test('fails closed for private, inactive, deleted, missing, and restricted players', () => {
  assert.equal(buildPublicPlayerShareProjection({
    teamId: 'team-1',
    team: { ...publicTeam, isPublic: false },
    player: publicPlayer
  }), null);
  assert.equal(buildPublicPlayerShareProjection({
    teamId: 'team-1',
    team: { ...publicTeam, active: false },
    player: publicPlayer
  }), null);
  assert.equal(buildPublicPlayerShareProjection({
    teamId: 'team-1',
    team: publicTeam,
    player: { ...publicPlayer, deleted: true }
  }), null);
  assert.equal(buildPublicPlayerShareProjection({
    teamId: 'team-1',
    team: publicTeam,
    player: null
  }), null);
  assert.equal(buildPublicPlayerShareProjection({
    teamId: 'team-1',
    team: publicTeam,
    player: { ...publicPlayer, guardianEmail: 'guardian@example.test' }
  }), null);
});

test('matches restricted roster keys across every public-document container', () => {
  const restrictedCases = [
    { medicalInfo: 'private' },
    { profile: { birthDate: '2015-01-01' } },
    { rosterFieldValues: { school: 'Private School' } },
    { customFields: { address: 'Private address' } },
    { profileFields: { guardianPhone: '555-0100' } },
    { extraFields: { householdContacts: [] } },
    { profile: { rosterFields: { memberId: 'private-id' } } },
    { profile: { customFields: { jerseySize: 'Youth M' } } },
    { profile: { profileFields: { gender: 'private' } } },
    { profile: { extraFields: { dominantHandFoot: 'right' } } }
  ];

  restrictedCases.forEach((restricted) => {
    assert.equal(hasRestrictedRosterFieldValues({ ...publicPlayer, ...restricted }), true);
  });
  assert.equal(hasRestrictedRosterFieldValues(publicPlayer), false);
});

test('keeps the preview restricted-key denylist synchronized with Firestore rules', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  const functionBody = rules.match(/function hasRestrictedRosterFieldValues\(data\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
  const restrictedList = functionBody.match(/let restrictedKeys = \[([\s\S]*?)\];/)?.[1] || '';
  const ruleKeys = [...restrictedList.matchAll(/'([^']+)'/g)].map((match) => match[1]);

  assert.ok(ruleKeys.length > 0, 'Firestore restricted roster keys should be discoverable');
  assert.deepEqual([...RESTRICTED_ROSTER_KEYS].sort(), [...new Set(ruleKeys)].sort());
  assert.match(functionBody, /hasRestrictedRosterNestedMap\(data, 'profile', 'rosterFields', restrictedKeys\)/);
});

test('builds player-specific metadata with the ALL PLAYS logo, not the player photo', () => {
  assert.deepEqual(buildPlayerShareMetadata({
    team: { name: 'Vipers FC U8B', sport: 'Soccer' },
    player: { name: 'Avery Lee', number: '9', position: 'Forward', photoUrl: 'https://images.example.test/avery.jpg' }
  }), {
    title: 'Avery Lee #9 — Vipers FC U8B',
    description: 'Forward · Soccer player profile on ALL PLAYS.',
    imageUrl: 'https://allplays.ai/img/logo_large.png',
    imageAlt: 'ALL PLAYS logo',
    siteName: 'ALL PLAYS'
  });
});

test('escapes player metadata and destinations in the crawler response', () => {
  const html = buildPlayerShareHtml({
    metadata: buildPlayerShareMetadata({
      team: { name: 'Vipers <script>alert(1)</script>', sport: 'Soccer' },
      player: { name: 'Avery & Lee', number: '9', position: 'Forward' }
    }),
    redirectUrl: 'https://allplays.ai/player.html#teamId=team-1&playerId=player-1',
    shareUrl: 'https://allplays.ai/player-card?teamId=team-1&playerId=player-1'
  });

  assert.match(html, /property="og:title" content="Avery &amp; Lee #9 — Vipers &lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(html, /property="og:image" content="https:\/\/allplays\.ai\/img\/logo_large\.png"/);
  assert.match(html, />Open the player profile on ALL PLAYS<\/a>/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('accepts bounded slash-free player IDs only', () => {
  assert.equal(normalizePlayerId(' player.1:summer '), 'player.1:summer');
  assert.equal(normalizePlayerId('player/1'), '');
  assert.equal(normalizePlayerId(''), '');
  assert.equal(normalizePlayerId('x'.repeat(129)), '');
});
