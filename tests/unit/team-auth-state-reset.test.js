import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    expect(start, `${startMarker} should exist`).toBeGreaterThanOrEqual(0);
    expect(end, `${endMarker} should follow ${startMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('team auth-scoped state reset', () => {
    it('revokes the old identity synchronously before assigning the next user or loading', () => {
        const callback = sourceBetween('checkAuth((user) => {', '\n        async function loadTeam');

        expect(callback.indexOf('const generation = ++teamLoadGeneration;')).toBeLessThan(callback.indexOf('resetTeamAuthBoundState();'));
        expect(callback.indexOf('resetTeamAuthBoundState();')).toBeLessThan(callback.indexOf('currentUser = user;'));
        expect(callback.indexOf('currentUser = user;')).toBeLessThan(callback.indexOf('loadTeam({ generation'));
    });

    it('zeros private globals, closes both modals, clears private containers, and disables controls', () => {
        const reset = sourceBetween('function resetTeamAuthBoundState() {', '\n        window.setScheduleFilter');

        for (const contract of [
            'currentUser = null;',
            "currentTeamAccessInfo = { hasAccess: false, accessLevel: null };",
            'currentTeam = null;',
            'currentTeamId = null;',
            'currentPlayers = [];',
            'currentTeamMemberUsers = [];',
            'teamGames = [];',
            'gamesById = {};',
            'allScheduleEvents = [];',
            'closeSyncCalendarModal();',
            'closeScheduleDayModal({ clearContent: true });',
            'setTeamPageControlsEnabled(false);',
            "'team-nav-banner'",
            "'team-pass-container'",
            "'availability-settings-section'",
            "'team-staff-permissions-section'",
            "'player-tracking-section'",
            "'roster-list'"
        ]) expect(reset).toContain(contract);
    });

    it('binds private feed preparation and actions to immutable UID, generation, team, and access', () => {
        expect(source).toContain('let preparedPrivateCalendarContext = null;');
        expect(source).toContain('const context = captureTeamAuthContext();');
        expect(source).toContain('isTeamAuthContextCurrent(context, { requireAccess: true })');
        expect(source).toContain("const result = await getPrivateTeamCalendarFeedToken({ teamId: context.teamId });");
        expect(source).toContain('getPrivateCalendarFeedUrl(token, context.teamId)');
        expect(source).toContain('preparedPrivateCalendarContext = feedUrl ? context : null;');
        expect(source).toContain('copyPrivateCalendarFeedUrl(preparedPrivateCalendarFeedUrl, preparedPrivateCalendarContext)');
    });

    it('guards private reads and rendered mutation controls with the captured generation', () => {
        const events = sourceBetween('async function getAllEvents(team, dbGames) {', '\n\n        async function renderSchedule(team, dbGames) {');

        expect(events).toContain('const context = arguments[2] || Object.freeze({');
        expect(events).toContain('if (!isContextCurrent()) return null;');
        expect(events).toContain('await getRsvps(teamId, id)');
        expect(events).toContain('await getMyRsvps(teamId, id, user.uid, linkedPlayerIds)');
        expect(source).toContain('data-team-generation="${teamLoadGeneration}"');
        expect(source).toContain('isButtonFromTeamContext(button, context)');
        expect(source).toContain('isTeamAuthContextCurrent(context, { requireManager: true })');
    });
});
