import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildStaffRsvpReminderMessage,
  buildStaffRsvpReminderMetadata,
  buildStaffRsvpReminderPreview,
  getStaffRsvpReminderMetadataTarget,
  resolveStaffRsvpReminderEmailSentCount
} from '../../apps/app/src/lib/scheduleLogic.ts';

describe('staff RSVP reminder helpers', () => {
  it('counts only active no-response players and de-duplicates eligible emails', () => {
    const players = [
      { id: 'p1', name: 'One', active: true, parents: [{ userId: 'u1', email: 'one@example.com' }] },
      { id: 'p2', name: 'Two', active: true, privateProfileParents: [{ userId: 'u2', email: 'shared@example.com' }, { email: 'shared@example.com' }] },
      { id: 'p3', name: 'Three', active: false, parents: [{ email: 'inactive@example.com' }] },
      { id: 'p4', name: 'Four', active: true, privateProfileParents: [{ email: 'shared@example.com' }] }
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

  it('suppresses reminders for every active player covered by a family RSVP', () => {
    const players = [
      { id: 'p1', name: 'Avery', active: true, parents: [{ userId: 'family-1', email: 'family@example.com' }] },
      { id: 'p2', name: 'Blake', active: true, parents: [{ userId: 'family-1', email: 'family@example.com' }] },
      { id: 'p3', name: 'Casey', active: true, parents: [{ userId: 'family-2', email: 'casey@example.com' }] }
    ];
    const rsvps = [
      { userId: 'family-1', response: 'going' },
      { playerIds: ['p3'], response: 'not_responded' }
    ];

    const preview = buildStaffRsvpReminderPreview(players, rsvps);

    expect(preview.players.map((player) => player.playerId)).toEqual(['p3']);
    expect(preview.eligibleEmails).toEqual(['casey@example.com']);
    expect(preview.missingPlayerCount).toBe(1);
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

  it('preserves an explicit zero email sent count', () => {
    expect(resolveStaffRsvpReminderEmailSentCount(0, 8)).toBe(0);
    expect(resolveStaffRsvpReminderEmailSentCount(undefined, 8)).toBe(8);
  });

  it('routes recurring virtual event metadata writes to the persisted master event', () => {
    expect(getStaffRsvpReminderMetadataTarget('practice-master__2026-05-25')).toEqual({
      persistedEventId: 'practice-master',
      occurrenceKey: '2026-05-25'
    });
    expect(getStaffRsvpReminderMetadataTarget('game-1')).toEqual({
      persistedEventId: 'game-1',
      occurrenceKey: ''
    });
  });

  it('builds scheduleNotifications metadata for a successful reminder send', () => {
    expect(buildStaffRsvpReminderMetadata('coach-1', 2, 4, '2026-05-25T03:50:00.000Z')).toEqual({
      sent: true,
      sentAt: '2026-05-25T03:50:00.000Z',
      lastAction: 'rsvp_reminder',
      lastSentAt: '2026-05-25T03:50:00.000Z',
      lastSentBy: 'coach-1',
      lastRsvpReminderCount: 2,
      lastRsvpEmailCount: 4,
      lastRsvpPushSuccessCount: 0,
      lastRsvpPushFailureCount: 0,
      lastRsvpPushTargetCount: 0,
      lastRsvpPushError: null
    });
  });

  it('persists RSVP push metrics in reminder metadata', () => {
    expect(buildStaffRsvpReminderMetadata('coach-1', 2, 4, '2026-05-25T03:50:00.000Z', {
      rsvpPushSuccessCount: 3,
      rsvpPushFailureCount: 1,
      rsvpPushTargetCount: 4,
      rsvpPushError: 'FCM partial failure'
    })).toEqual({
      sent: true,
      sentAt: '2026-05-25T03:50:00.000Z',
      lastAction: 'rsvp_reminder',
      lastSentAt: '2026-05-25T03:50:00.000Z',
      lastSentBy: 'coach-1',
      lastRsvpReminderCount: 2,
      lastRsvpEmailCount: 4,
      lastRsvpPushSuccessCount: 3,
      lastRsvpPushFailureCount: 1,
      lastRsvpPushTargetCount: 4,
      lastRsvpPushError: 'FCM partial failure'
    });
  });
});


describe('staff RSVP reminder service wiring', () => {
  it('gates reminders on backend-compatible managers instead of all team staff', () => {
    const serviceSource = readFileSync('apps/app/src/lib/scheduleService.ts', 'utf8');
    const detailSource = readFileSync('apps/app/src/pages/ScheduleEventDetail.tsx', 'utf8');
    const reminderPanelSource = readFileSync('apps/app/src/components/schedule/StaffRsvpReminderPanel.tsx', 'utf8');

    expect(serviceSource).toContain('function isPublicRsvpReminderManager');
    expect(serviceSource).toContain('if (!event.isTeamRsvpReminderManager)');
    expect(serviceSource).toContain('const { players, rsvps } = await getRsvpBreakdownByPlayer(event.teamId, event.id);');
    expect(detailSource).toContain('<StaffRsvpReminderPanel refreshToken={staffRsvp.refreshToken} />');
    expect(reminderPanelSource).toContain('event.isTeamRsvpReminderManager');
    expect(reminderPanelSource).not.toContain('event.isTeamStaff && event.isDbGame');
  });

  it('persists Cloud Function RSVP push metrics from app reminder sends', () => {
    const serviceSource = readFileSync('apps/app/src/lib/scheduleService.ts', 'utf8');

    expect(serviceSource).toContain('const rsvpPushMetrics = normalizeStaffRsvpReminderPushMetrics(emailResult);');
    expect(serviceSource).toContain('await updateRsvpReminderMetadata(event, user, preview.missingPlayerCount, emailSentCount, rsvpPushMetrics);');
    expect(serviceSource).toContain("'scheduleNotifications.lastRsvpPushSuccessCount': metadata.lastRsvpPushSuccessCount");
    expect(serviceSource).toContain("'scheduleNotifications.lastRsvpPushFailureCount': metadata.lastRsvpPushFailureCount");
    expect(serviceSource).toContain("'scheduleNotifications.lastRsvpPushTargetCount': metadata.lastRsvpPushTargetCount");
    expect(serviceSource).toContain("'scheduleNotifications.lastRsvpPushError': metadata.lastRsvpPushError");
  });
});
