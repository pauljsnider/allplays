const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTeamEmailRecipients, buildTeamEmailMailJob } = require('../team-email-core.cjs');

test('resolveTeamEmailRecipients deduplicates enabled roster contacts without leaking disabled contacts', () => {
  const recipients = resolveTeamEmailRecipients({
    targetType: 'full_team',
    players: [
      {
        id: 'p1',
        active: true,
        parents: [
          { email: ' Mom@Example.com ', userId: 'u1' },
          { email: 'skip@example.com', emailEnabled: false }
        ]
      },
      {
        id: 'p2',
        active: true,
        guardians: [{ email: 'mom@example.com', userId: 'u1' }]
      },
      {
        id: 'p3',
        active: false,
        parents: [{ email: 'inactive@example.com' }]
      }
    ]
  });

  assert.equal(recipients.length, 1);
  assert.deepEqual(recipients[0], {
    email: 'mom@example.com',
    playerIds: ['p1', 'p2'],
    userIds: ['u1'],
    roles: ['guardian']
  });
});

test('resolveTeamEmailRecipients limits individual sends to selected recipients', () => {
  const recipients = resolveTeamEmailRecipients({
    targetType: 'individuals',
    recipientIds: ['player:p2', 'email:extra@example.com'],
    players: [
      { id: 'p1', parents: [{ email: 'one@example.com' }] },
      { id: 'p2', parents: [{ email: 'two@example.com' }] },
      { id: 'p3', parents: [{ email: 'extra@example.com' }] }
    ]
  });

  assert.deepEqual(recipients.map((recipient) => recipient.email), ['extra@example.com', 'two@example.com']);
});

test('buildTeamEmailMailJob keeps recipient email only in backend mail job', () => {
  const job = buildTeamEmailMailJob({
    email: 'parent@example.com',
    subject: 'Practice update',
    body: 'Line 1\nLine 2',
    teamId: 'team1',
    messageId: 'message1',
    senderUid: 'coach1'
  });

  assert.deepEqual(job.to, ['parent@example.com']);
  assert.equal(job.message.subject, 'Practice update');
  assert.equal(job.metadata.type, 'team_email');
  assert.equal(job.metadata.teamEmailMessageId, 'message1');
  assert.match(job.message.html, /Line 1<br>Line 2/);
});
