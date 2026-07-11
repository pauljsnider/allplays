'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInviteSignupUrl,
  buildParentInviteEmailMessage,
  normalizeInviteEmailType
} = require('../invite-email-core.cjs');

test('normalizes supported parent invite types', () => {
  assert.equal(normalizeInviteEmailType('parent_invite'), 'parent');
  assert.equal(normalizeInviteEmailType('household_invite'), 'household');
  assert.equal(normalizeInviteEmailType('admin_invite'), '');
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
