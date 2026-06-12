import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('profile notification wiring', () => {
  it('renders notification settings controls in profile page', () => {
    const source = readFileSync(new URL('../../profile.html', import.meta.url), 'utf8');
    expect(source).toContain('id="notification-team-select"');
    expect(source).toContain('id="notification-preference-groups"');
    expect(source).toContain('NOTIFICATION_PREFERENCE_GROUPS');
    expect(source).toContain('data-notification-category');
    expect(source).toContain('id="enable-push-btn"');
    expect(source).toContain('id="save-notification-prefs-btn"');
  });

  it('wires db and push modules for notification settings', () => {
    const source = readFileSync(new URL('../../profile.html', import.meta.url), 'utf8');
    const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
    expect(source).toContain('getNotificationPreferencesForTeam');
    expect(source).toContain('saveNotificationPreferencesForTeam');
    expect(source).toContain('registerPushNotifications');
    expect(source).toContain("./js/notification-preferences.js?v=2");
    expect(functionsSource).toContain("exports.syncTeamNotificationTargetsOnPreferenceWrite");
    expect(functionsSource).toContain("exports.syncTeamNotificationTargetsOnDeviceWrite");
    expect(functionsSource).toContain("teams/${teamId}/notificationTargets");
  });

  it('renders and validates the account merge request entry point', () => {
    const source = readFileSync(new URL('../../profile.html', import.meta.url), 'utf8');
    expect(source).toContain('id="account-merge-section"');
    expect(source).toContain('id="show-account-merge-form-btn"');
    expect(source).toContain('id="account-merge-email"');
    expect(source).toContain('id="submit-account-merge-btn"');
    expect(source).toContain('Enter a valid email address.');
    expect(source).toContain('Enter a different email than the account you are signed in with.');
    expect(source).toContain('Merge request pending verification.');
  });

  it('wires account merge requests to a scoped Firestore helper and rules', () => {
    const profileSource = readFileSync(new URL('../../profile.html', import.meta.url), 'utf8');
    const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
    const rulesSource = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

    expect(profileSource).toContain('createAccountMergeRequest');
    expect(dbSource).toContain("collection(db, 'users', userId, 'accountMergeRequests')");
    expect(dbSource).toContain("status: 'pending_verification'");
    expect(rulesSource).toContain('match /accountMergeRequests/{requestId}');
    expect(rulesSource).toContain('isAccountMergeRequestPayloadValid');
    expect(rulesSource).toContain('isParentAccountOwner(userId)');
    expect(rulesSource).toContain("data.status == 'pending_verification'");
  });
});
