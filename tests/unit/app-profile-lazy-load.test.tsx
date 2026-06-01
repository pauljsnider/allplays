import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const profileSource = readFileSync(new URL('../../apps/app/src/pages/Profile.tsx', import.meta.url), 'utf8');

describe('Profile lazy-load guards', () => {
    it('loads notification teams only from the Alerts section and only once', () => {
        expect(profileSource).toContain("if (!user || activeProfileSection !== 'alerts' || notificationTeamsLoaded) {");
    });

    it('loads invite history only from the Invites section and only once', () => {
        expect(profileSource).toContain("if (!user || activeProfileSection !== 'invites' || accessCodesLoaded) {");
    });

    it('loads parent-linked merge options only when the panel is expanded and only once', () => {
        expect(profileSource).toContain("if (!user || !accountMergeExpanded || parentLinkedTeamsLoaded) {");
    });

    it('resets lazy-loaded section state when the signed-in user changes', () => {
        expect(profileSource).toContain('setNotificationTeamsLoaded(false);');
        expect(profileSource).toContain('setAccessCodesLoaded(false);');
        expect(profileSource).toContain('setParentLinkedTeamsLoaded(false);');
    });
});
