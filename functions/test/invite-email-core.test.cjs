'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInviteSignupUrl,
  buildLinkedTeamUrl,
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
    'https://allplays.ai/accept-invite.html?code=ABCD1234&type=parent'
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
  assert.match(message.text, /accept-invite\.html\?code=PARENT12&type=parent/);
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
  assert.match(message.signupUrl, /accept-invite\.html\?code=COPA1234&type=coparent/);
});

test('builds an auto-linked parent notification without a consumed acceptance link', () => {
  const invite = {
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
  };

  const initialMessage = buildParentInviteEmailMessage(invite);
  const retryMessage = buildParentInviteEmailMessage({ ...invite });

  assert.equal(buildLinkedTeamUrl('team 1'), 'https://allplays.ai/app/#/teams/team%201');
  assert.equal(initialMessage.messageKind, 'linked');
  assert.equal(retryMessage.messageKind, 'linked');
  assert.match(initialMessage.subject, /connected to Pat Star/);
  assert.match(initialMessage.text, /No acceptance step or invite code is needed/);
  assert.match(initialMessage.html, /Open ALL PLAYS/);
  assert.doesNotMatch(initialMessage.text, /LINK1234|accept-invite/);
  assert.doesNotMatch(retryMessage.html, /LINK1234|accept-invite/);
});

test('defers parent on-create email until auto-linking completes', () => {
  assert.equal(shouldQueueInviteEmailOnCreate({
    type: 'parent_invite',
    email: 'parent@example.com'
  }), false);
  assert.equal(shouldQueueInviteEmailOnCreate({
    type: 'household_invite',
    email: 'family@example.com'
  }), true);
  assert.equal(shouldQueueInviteEmailOnCreate({
    type: 'coparent_invite',
    email: 'friend@example.com'
  }), true);
});
