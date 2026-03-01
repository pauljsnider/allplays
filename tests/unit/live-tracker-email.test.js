import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveSummaryRecipient } from '../../js/live-tracker-email.js';

describe('live tracker summary email recipient', () => {
  it('prefers team notification email over signed-in user email', () => {
    expect(resolveSummaryRecipient({
      teamNotificationEmail: 'team-notify@example.com',
      userEmail: 'coach-login@example.com'
    })).toBe('team-notify@example.com');
  });

  it('falls back to signed-in user email when team notification email is missing', () => {
    expect(resolveSummaryRecipient({
      teamNotificationEmail: '   ',
      userEmail: 'coach-login@example.com'
    })).toBe('coach-login@example.com');
  });

  it('returns empty string when neither email is available', () => {
    expect(resolveSummaryRecipient({
      teamNotificationEmail: undefined,
      userEmail: null
    })).toBe('');
  });

  it('wires recipient resolution into live tracker finish flow', () => {
    const source = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
    expect(source).toContain('resolveSummaryRecipient');
    expect(source).toContain('teamNotificationEmail: currentTeam?.notificationEmail');
  });
});
