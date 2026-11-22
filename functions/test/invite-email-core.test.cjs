'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInviteSignupUrl,
  buildLinkedParentHomeUrl,
  buildLinkedParentUrl,
  buildLinkedPlayerUrl,
  buildParentInviteEmailMessage,
  isValidInviteRecipientEmail,
  normalizeInviteEmailType,
  shouldQueueInviteEmailOnCreate
} = require('../invite-email-core.cjs');

test('normalizes supported parent invite types', () => {
  assert.equal(normalizeInviteEmailType('parent_invite'), 'parent');
  assert.equal(normalizeInviteEmailType('household_invite'), 'household');
  assert.equal(normalizeInviteEmailType('coparent_invite'), 'coparent');
  assert.equal(normalizeInviteEmailType('admin_invite'), '');
});

test('accepts normalized recipient emails and rejects malformed addresses', () => {
  assert.equal(isValidInviteRecipientEmail(' Parent@Example.com '), true);
  assert.equal(isValidInviteRecipientEmail('not-an-email'), false);
  assert.equal(isValidInviteRecipientEmail('missing-domain@'), false);
  assert.equal(isValidInviteRecipientEmail(''), false);
});

test('builds a parent signup link with the code and normalized invite type', () => {
  assert.equal(
    buildInviteSignupUrl(' abcd1234 ', 'parent_invite'),
    'https://allplays.ai/app/#/accept-invite?code=ABCD1234&type=parent'
  );
});

test('builds coach parent invite email text and html with code and signup link', () => {
  const message = buildParentInviteEmailMessage({
    code: 'PARENT12',
    type: 'parent_invite',
    teamName: 'Bears',
    playerName: 'Pat Star',
    relation: 'Guardian'
  });

  assert.match(message.subject, /Pat Star/);
  assert.match(message.text, /A coach invited you/);
  assert.match(message.text, /Invite code: PARENT12/);
  assert.match(message.text, /app\/#\/accept-invite\?code=PARENT12&type=parent/);
  assert.match(message.html, /Sign up or accept invite/);
  assert.match(message.html, /PARENT12/);
});

test('builds household invite copy without trusting html fields', () => {
  const message = buildParentInviteEmailMessage({
    code: 'HOME1234',
    type: 'household_invite',
    playerName: '<Pat>',
    relation: '<Guardian>'
  });

  assert.match(message.text, /A parent invited you/);
  assert.match(message.signupUrl, /type=household/);
  assert.doesNotMatch(message.html, /<Pat>/);
  assert.match(message.html, /&lt;Pat&gt;/);
});

test('builds co-parent invite copy through the canonical accept flow', () => {
  const message = buildParentInviteEmailMessage({
    code: 'COPA1234',
    type: 'coparent_invite',
    playerName: 'Sam',
    teamName: 'Tigers'
  });

  assert.match(message.subject, /co-parent Sam/);
  assert.match(message.text, /as a co-parent/);
  assert.match(message.signupUrl, /app\/#\/accept-invite\?code=COPA1234&type=coparent/);
});

test('builds a linked player profile link and falls back to the parent home dashboard', () => {
  assert.equal(
    buildLinkedPlayerUrl('team 1', 'player 2'),
    'https://allplays.ai/app/#/players/team%201/player%202'
  );
  assert.equal(buildLinkedPlayerUrl('team 1', ''), '');
  assert.equal(buildLinkedPlayerUrl('', 'player 2'), '');
  assert.equal(buildLinkedParentHomeUrl(), 'https://allplays.ai/app/#/home');
  assert.equal(
    buildLinkedParentUrl({ teamId: 'team 1', playerId: 'player 2' }),
    'https://allplays.ai/app/#/players/team%201/player%202'
  );
  assert.equal(
    buildLinkedParentUrl({ teamId: 'team 1' }),
    'https://allplays.ai/app/#/home'
  );
});

test('builds an auto-linked parent notification without a consumed acceptance link', () => {
  const invite = {
    code: 'LINK1234',
    type: 'parent_invite',
    teamId: 'team 1',
    playerId: 'player 2',
    teamName: 'Bears',
    playerName: 'Pat Star',
    relation: 'Guardian',
    used: true,
    usedBy: 'parent-1',
    status: 'accepted',
    autoAccepted: true
  };

  const initialMessage = buildParentInviteEmailMessage(invite);
  const retryMessage = buildParentInviteEmailMessage({ ...invite });

  assert.equal(initialMessage.messageKind, 'linked');
  assert.equal(retryMessage.messageKind, 'linked');
  assert.equal(initialMessage.signupUrl, 'https://allplays.ai/app/#/players/team%201/player%202');
  assert.match(initialMessage.subject, /connected to Pat Star/);
  assert.match(initialMessage.text, /Open Pat Star's profile: https:\/\/allplays\.ai\/app\/#\/players\/team%201\/player%202/);
  assert.match(initialMessage.text, /see upcoming games and RSVP for the next one/);
  assert.match(initialMessage.text, /No acceptance step or invite code is needed/);
  assert.match(initialMessage.html, /View Pat Star's profile/);
  assert.match(initialMessage.html, /see upcoming games and RSVP for the next one/);
  assert.doesNotMatch(initialMessage.text, /LINK1234|accept-invite|#\/teams\//);
  assert.doesNotMatch(initialMessage.html, /LINK1234|accept-invite|#\/teams\//);
  assert.doesNotMatch(retryMessage.html, /LINK1234|accept-invite|#\/teams\//);
});

test('links an auto-linked parent without a playerId to the parent home dashboard, never the team page', () => {
  const message = buildParentInviteEmailMessage({
    code: 'LINK1234',
    type: 'parent_invite',
    teamId: 'team 1',
    teamName: 'Bears',
    playerName: 'Pat Star',
    relation: 'Guardian',
    used: true,
    usedBy: 'parent-1',
    status: 'accepted',
    autoAccepted: true
  });

  assert.equal(message.messageKind, 'linked');
  assert.equal(message.signupUrl, 'https://allplays.ai/app/#/home');
  assert.match(message.text, /app\/#\/home/);
  assert.doesNotMatch(message.text, /#\/teams\//);
  assert.doesNotMatch(message.html, /#\/teams\//);
});

test('keeps the brand-new parent invite on the accept-invite signup flow', () => {
  const message = buildParentInviteEmailMessage({
    code: 'NEWPAREN',
    type: 'parent_invite',
    teamId: 'team 1',
    playerId: 'player 2',
    teamName: 'Bears',
    playerName: 'Pat Star',
    relation: 'Guardian'
  });

  assert.equal(message.messageKind, 'invite');
  assert.match(message.signupUrl, /app\/#\/accept-invite\?code=NEWPAREN&type=parent/);
  assert.match(message.text, /Invite code: NEWPAREN/);
  assert.doesNotMatch(message.text, /#\/players\//);
  assert.doesNotMatch(message.text, /#\/teams\//);
});

test('queues every supported invite type from the durable on-create trigger', () => {
  assert.equal(shouldQueueInviteEmailOnCreate({
    type: 'parent_invite',
    email: 'parent@example.com'
  }), true);
  assert.equal(shouldQueueInviteEmailOnCreate({
    type: 'household_invite',
    email: 'family@example.com'
  }), true);
  assert.equal(shouldQueueInviteEmailOnCreate({
    type: 'coparent_invite',
    email: 'friend@example.com'
  }), true);
});
