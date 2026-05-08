import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function loadCanManageTeamAvailability() {
    const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
    const start = source.indexOf('function canManageTeamAvailability() {');
    const end = source.indexOf('\n\n        function renderAvailabilitySettings(team)', start);

    if (start === -1 || end === -1) {
        throw new Error('Could not locate canManageTeamAvailability() in team.html');
    }

    const functionSource = source.slice(start, end);
    return new Function('context', `
        let currentUser = context.currentUser;
        let currentTeamAccessInfo = context.currentTeamAccessInfo;
        ${functionSource}
        return canManageTeamAvailability();
    `);
}

describe('team availability admin access', () => {
    it('treats full team access as availability admin access', () => {
        const canManageTeamAvailability = loadCanManageTeamAvailability();

        expect(canManageTeamAvailability({
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            currentTeamAccessInfo: { hasAccess: true, accessLevel: 'full' }
        })).toBe(true);
    });

    it('does not treat parent-only access as availability admin access', () => {
        const canManageTeamAvailability = loadCanManageTeamAvailability();

        expect(canManageTeamAvailability({
            currentUser: { uid: 'parent-1', email: 'parent@example.com' },
            currentTeamAccessInfo: { hasAccess: true, accessLevel: 'parent' }
        })).toBe(false);
    });

    it('uses the shared availability admin check for settings, reminders, and RSVP notes', () => {
        const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');

        expect(source).toContain('const canManage = canManageTeamAvailability();');
        expect(source).toContain('return canManageTeamAvailability();');
        expect(source).toContain('const isTeamAdmin = canManageTeamAvailability();');
    });
});
