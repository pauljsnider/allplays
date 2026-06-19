import { describe, expect, it } from 'vitest';

import {
    buildTeamNavigation,
    getTeamSchedulePath,
    getTeamWebsiteHashHref,
    getTeamWebsiteQueryHref,
    isTeamManagementRole
} from '../../apps/app/src/lib/teamNavigation.ts';

function team(overrides = {}) {
    return {
        teamId: 'team-1',
        teamName: 'Bears',
        role: 'Parent',
        sport: 'Basketball',
        players: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }],
        nextEvent: null,
        eventCount: 3,
        unreadCount: 2,
        openActions: 1,
        ...overrides
    };
}

describe('React app team navigation helpers', () => {
    it('builds parent team navigation with native team workflows and current website resources', () => {
        const sections = buildTeamNavigation(team());
        const items = sections.flatMap((section) => section.items);

        expect(sections.map((section) => section.id)).toEqual(['core', 'resources']);
        expect(items.find((item) => item.id === 'team-page')).toMatchObject({
            href: '/teams/team-1',
            kind: 'native'
        });
        expect(items.find((item) => item.id === 'schedule')).toMatchObject({
            href: '/schedule?teamId=team-1',
            kind: 'native',
            badge: '1 action'
        });
        expect(items.find((item) => item.id === 'messages')).toMatchObject({
            href: '/messages/team-1',
            badge: '2 unread'
        });
        expect(items.find((item) => item.id === 'practice-packets')?.href).toBe('/schedule?teamId=team-1&view=packets');
        expect(items.find((item) => item.id === 'website-team-page')?.href).toBe('https://allplays.ai/team.html#teamId=team-1');
        expect(items.find((item) => item.id === 'media')).toMatchObject({
            href: '/teams/team-1/media',
            kind: 'native'
        });
        expect(items.find((item) => item.id === 'parent-fees')?.href).toBe('/parent-tools/fees');
        expect(items.find((item) => item.id === 'registrations')?.href).toBe('/parent-tools/registrations');
        expect(items.find((item) => item.id === 'awards')?.href).toBe('/parent-tools/certificates');
        expect(items.find((item) => item.id === 'player-profile')?.href).toBe('/players/team-1/player-1');
        expect(items.find((item) => item.id === 'manage-roster')).toBeUndefined();
    });

    it('adds coach/admin operations from the existing website for staff teams', () => {
        const sections = buildTeamNavigation(team({ role: 'Coach', players: [], eventCount: 0, unreadCount: 0, openActions: 0 }));
        const management = sections.find((section) => section.id === 'management');
        const managementIds = management?.items.map((item) => item.id);

        expect(isTeamManagementRole('Coach')).toBe(true);
        expect(isTeamManagementRole('Parent')).toBe(false);
        expect(sections.find((section) => section.id === 'core')?.items.map((item) => item.id)).toEqual(['team-page', 'messages']);
        expect(managementIds).toEqual([
            'team-settings',
            'manage-roster',
            'manage-schedule',
            'fees',
            'practice-command',
            'game-plan',
            'game-day',
            'tracking',
            'stats-config',
            'certificates'
        ]);
        expect(management?.items.find((item) => item.id === 'manage-roster')?.href).toBe('https://allplays.ai/edit-roster.html#teamId=team-1');
        expect(management?.items.find((item) => item.id === 'stats-config')).toMatchObject({
            href: '/teams/team-1?tab=more',
            kind: 'native'
        });
        expect(management?.items.find((item) => item.id === 'fees')).toMatchObject({
            href: '/teams/team-1/fees',
            kind: 'native'
        });
        expect(management?.items.find((item) => item.id === 'game-day')?.href).toBe('https://allplays.ai/game-day.html?teamId=team-1');
    });

    it('keeps chat-only staff teams focused on messages and website management tools', () => {
        const sections = buildTeamNavigation(team({ role: 'Staff', players: [], eventCount: 0, unreadCount: 4, openActions: 0 }));
        const core = sections.find((section) => section.id === 'core');
        const resources = sections.find((section) => section.id === 'resources');

        expect(core?.detail).toBe('Team communication is available in the app.');
        expect(core?.items.map((item) => item.id)).toEqual(['team-page', 'messages']);
        expect(core?.items.find((item) => item.id === 'messages')).toMatchObject({
            href: '/messages/team-1',
            badge: '4 unread'
        });
        expect(core?.items.find((item) => item.id === 'schedule')).toBeUndefined();
        expect(core?.items.find((item) => item.id === 'practice-packets')).toBeUndefined();
        expect(resources?.items.map((item) => item.id)).toEqual(['website-team-page', 'media', 'parent-fees', 'registrations', 'awards']);
        expect(sections.find((section) => section.id === 'management')?.items).toHaveLength(10);
    });

    it('routes teams with multiple linked players to the current website roster instead of one native player', () => {
        const sections = buildTeamNavigation(team({
            players: [
                { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' },
                { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam Wing' }
            ]
        }));
        const resourceItems = sections.find((section) => section.id === 'resources')?.items || [];

        expect(resourceItems.find((item) => item.id === 'player-profile')).toBeUndefined();
        expect(resourceItems.find((item) => item.id === 'players')).toMatchObject({
            label: 'Players',
            detail: '2 linked player profiles and reports',
            href: 'https://allplays.ai/team.html#teamId=team-1',
            kind: 'website'
        });
    });

    it('encodes team route and website URLs', () => {
        expect(getTeamSchedulePath('team/with slash', { view: 'packets', filter: 'availability' })).toBe('/schedule?teamId=team%2Fwith+slash&view=packets&filter=availability');
        expect(getTeamWebsiteHashHref('team.html', 'team/with slash', { section: 'roster' })).toBe('https://allplays.ai/team.html#teamId=team%2Fwith+slash&section=roster');
        expect(getTeamWebsiteQueryHref('game-day.html', { teamId: 'team/with slash' })).toBe('https://allplays.ai/game-day.html?teamId=team%2Fwith+slash');
    });
});
