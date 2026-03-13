import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('profile notification wiring', () => {
  it('renders notification settings controls in profile page', () => {
    const source = readFileSync(new URL('../../profile.html', import.meta.url), 'utf8');
    expect(source).toContain('id="notification-team-select"');
    expect(source).toContain('id="notification-live-chat"');
    expect(source).toContain('id="notification-live-score"');
    expect(source).toContain('id="notification-schedule"');
    expect(source).toContain('id="enable-push-btn"');
    expect(source).toContain('id="save-notification-prefs-btn"');
  });

  it('wires db and push modules for notification settings', () => {
    const source = readFileSync(new URL('../../profile.html', import.meta.url), 'utf8');
    expect(source).toContain('getNotificationPreferencesForTeam');
    expect(source).toContain('saveNotificationPreferencesForTeam');
    expect(source).toContain('registerPushNotifications');
  });
});
