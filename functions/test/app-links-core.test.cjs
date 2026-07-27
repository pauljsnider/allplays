'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAcceptInviteAppUrl,
  buildAppUrl,
  buildAuthAppUrl,
  buildParentFeesAppUrl,
  buildRegistrationAppUrl
} = require('../app-links-core.cjs');

test('buildAppUrl produces canonical hash routes with encoded parameters', () => {
  assert.equal(
    buildAppUrl('/messages/team one', { conversationId: 'staff & coaches' }),
    'https://allplays.ai/app/#/messages/team%20one?conversationId=staff+%26+coaches'
  );
});

test('canonical flow builders preserve routing context', () => {
  assert.equal(
    buildAuthAppUrl({ mode: 'signup', code: 'ABCD1234', type: 'parent', next: '/schedule?teamId=one' }),
    'https://allplays.ai/app/#/auth?mode=signup&code=ABCD1234&type=parent&next=%2Fschedule%3FteamId%3Done'
  );
  assert.equal(
    buildAcceptInviteAppUrl('abcd1234', 'household'),
    'https://allplays.ai/app/#/accept-invite?code=ABCD1234&type=household'
  );
  assert.equal(
    buildRegistrationAppUrl({ teamId: 'team/one', formId: 'spring & summer' }, 'https://preview.example/'),
    'https://preview.example/app/#/registration?teamId=team%2Fone&formId=spring+%26+summer'
  );
  assert.equal(
    buildParentFeesAppUrl({ teamId: 'team-1', checkout: 'success' }),
    'https://allplays.ai/app/#/parent-tools/fees?teamId=team-1&checkout=success'
  );
});

test('app builders reject origin-relative route escapes', () => {
  assert.throws(() => buildAppUrl('//evil.example/steal'), /origin-relative/);
  assert.throws(() => buildAppUrl('/auth\\evil'), /origin-relative/);
});
