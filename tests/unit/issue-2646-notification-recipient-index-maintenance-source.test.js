import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../../functions/notification-target-index-core.cjs', import.meta.url), 'utf8');
const recipientIndexTestSource = readFileSync(new URL('../../functions/test/notification-recipient-index.test.js', import.meta.url), 'utf8');

describe('issue 2646 notification recipient index maintenance source contract', () => {
    it('keeps recipient index writes driven by preference, device, user, and team triggers', () => {
        expect(functionsSource).toContain('exports.syncTeamNotificationRecipientsOnPreferenceWrite = functions.firestore');
        expect(functionsSource).toContain(".document('users/{uid}/notificationPreferences/{teamId}')");
        expect(functionsSource).toContain('exports.syncTeamNotificationRecipientsOnDeviceWrite = functions.firestore');
        expect(functionsSource).toContain(".document('users/{uid}/notificationDevices/{deviceId}')");
        expect(functionsSource).toContain('exports.syncTeamNotificationRecipientsOnUserWrite = functions.firestore');
        expect(functionsSource).toContain(".document('users/{uid}')");
        expect(functionsSource).toContain('exports.syncTeamNotificationRecipientsOnTeamWrite = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}')");
    });

    it('keeps aggregate recipient payloads category-aware and device-aware', () => {
        expect(coreSource).toContain('function buildNotificationTargetPayload({ uid, teamId, deviceId, token, platform = \'web\', userAgent = \'\', preferences = {} })');
        expect(coreSource).toContain('const categories = normalizeNotificationTargetCategories(preferences);');
        expect(coreSource).toContain('function buildNotificationTargetDocId({ uid, deviceId })');
        expect(functionsSource).toContain('firestore.collection(`users/${normalizedUid}/notificationDevices`).get()');
        expect(functionsSource).toContain('firestore.doc(`teams/${teamId}/notificationRecipients/${normalizedUid}`)');
        expect(functionsSource).toContain('await cleanupLegacyNotificationRecipientDocs(teamId, normalizedUid);');
    });

    it('keeps existing coverage for each recipient-index mutation source', () => {
        [
            'preference writes update the aggregated notificationRecipients doc',
            'device writes refresh token lists for every team the user belongs to',
            'user parentTeamIds changes add and remove aggregated recipient docs',
            'team adminEmails changes swap the indexed staff recipients',
            'firestore rules explicitly deny client access to notificationRecipients'
        ].forEach((testName) => {
            expect(recipientIndexTestSource).toContain(testName);
        });
    });
});
