import { describe, expect, it } from 'vitest';
import {
  buildStaffRsvpReminderMessage,
  buildStaffRsvpReminderMetadata,
  buildStaffRsvpReminderPreview
} from '../../apps/app/src/lib/scheduleLogic.ts';

describe('staff RSVP reminder helpers', () => {
  it('counts only active no-response players and de-duplicates eligible emails', () => {
    const players = [
      { id: 'p1', name: 'One', active: true, parents: [{ userId: 'u1', email: 'one@example.com' }] },
      { id: 'p2', name: 'Two', active: true, parents: [{ userId: 'u2', email: 'shared@example.com' }, { email: 'shared@example.com' }] },
      { id: 'p3', name: 'Three', active: false, parents: [{ email: 'inactive@example.com' }] },
      { id: 'p4', name: 'Four', active: true, parents: [{ email: 'shared@example.com' }] }
    ];
    const rsvps = [
      { playerId: 'p1', response: 'going' },
      { userId: 'u2', response: 'maybe' }
    ];

    const preview = buildStaffRsvpReminderPreview(players, rsvps);

    expect(preview.missingPlayerCount).toBe(1);
    expect(preview.players.map((player) => player.playerId)).toEqual(['p4']);
    expect(preview.eligibleEmails).toEqual(['shared@example.com']);
    expect(preview.eligibleEmailCount).toBe(1);
  });

  it('builds the team chat reminder text with event details and missing count', () => {
    expect(buildStaffRsvpReminderMessage({
      eventType: 'practice',
      title: 'Shooting practice',
      dateLabel: 'Mon, May 25 at 6:00 PM',
      missingCount: 3
    })).toBe([
      'RSVP reminder: Practice',
      'Practice: Shooting practice',
      'When: Mon, May 25 at 6:00 PM',
      '3 player(s) still have not responded.'
    ].join('\n'));
  });

  it('builds scheduleNotifications metadata for a successful reminder send', () => {
    expect(buildStaffRsvpReminderMetadata('coach-1', 2, 4, '2026-05-25T03:50:00.000Z')).toEqual({
      sent: true,
      sentAt: '2026-05-25T03:50:00.000Z',
      lastAction: 'rsvp_reminder',
      lastSentAt: '2026-05-25T03:50:00.000Z',
      lastSentBy: 'coach-1',
      lastRsvpReminderCount: 2,
      lastRsvpEmailCount: 4
    });
  });
});
