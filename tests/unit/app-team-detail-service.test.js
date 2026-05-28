// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../js/db.js', () => ({
    getAggregatedStatsForGames: vi.fn(),
    getAdSpaceSponsors: vi.fn(),
    getConfigs: vi.fn(),
    getGames: vi.fn(),
    getLocalAttractionSponsors: vi.fn(),
    getPlayers: vi.fn(),
    getPlayerTrackingStatuses: vi.fn(),
    getPublicTrackingItems: vi.fn(),
    getTeam: vi.fn()
}));

vi.mock('../../js/firebase.js', () => ({
    collection: vi.fn((db, name) => ({ db, name })),
    db: {},
    getDocs: vi.fn(),
    query: vi.fn((...parts) => parts),
    where: vi.fn((field, op, value) => ({ field, op, value }))
}));

vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    firebaseAuth: { app: { options: { projectId: 'demo-allplays' } } },
    getNativeAuthIdToken: vi.fn()
}));

import { buildTeamDetailModel, loadParentTeamDetail } from '../../apps/app/src/lib/teamDetailService.ts';
import { getDocs } from '../../js/firebase.js';
import { getAggregatedStatsForGames, getAdSpaceSponsors, getConfigs, getGames, getLocalAttractionSponsors, getPlayers, getTeam } from '../../js/db.js';

describe('React app team detail model', () => {
    it('projects team.html parent features into the native team model', () => {
        const model = buildTeamDetailModel({
            teamId: 'team-1',
            team: {
                name: 'Bears',
                sport: 'Basketball',
                photoUrl: 'https://img.example.test/team.png',
                leagueUrl: 'https://league.example.test',
                bracketUrl: 'https://bracket.example.test/path',
                standingsConfig: { enabled: true },
                registrationSource: { provider: 'Sports Connect', externalTeamId: 'EXT-1' }
            },
            players: [
                { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png' },
                { id: 'player-2', name: 'Sam Wing', number: '12' }
            ],
            games: [
                { id: 'game-1', opponent: 'Falcons', date: new Date('2100-06-01T18:00:00Z'), status: 'scheduled', homeScore: null, awayScore: null },
                { id: 'game-2', opponent: 'Wolves', date: new Date('2026-05-01T18:00:00Z'), status: 'completed', homeScore: 42, awayScore: 35, isHome: true },
                { id: 'practice-1', type: 'practice', title: 'Practice', date: new Date('2100-06-02T18:00:00Z') }
            ],
            configs: [{
                id: 'basketball',
                name: 'Basketball',
                columns: ['pts'],
                statDefinitions: [{ id: 'pts', label: 'Points', acronym: 'PTS', topStat: true, visibility: 'public', scope: 'player' }]
            }],
            user: { uid: 'user-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'], parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] },
            seasonStatsByPlayerId: {
                'player-1': { pts: 88 },
                'player-2': { pts: 31 }
            },
            trackingItems: [{ id: 'item-1', title: 'Bring ball', public: true }],
            trackingStatuses: [{ itemId: 'item-1', playerId: 'player-1', status: 'complete', public: true }],
            sponsors: [{ id: 'sponsor-1', name: 'Pizza Place', description: 'After game', imageUrl: 'https://img.example.test/pizza.png', websiteUrl: 'https://pizza.example.test' }]
        });

        expect(model.team.photoUrl).toBe('https://img.example.test/team.png');
        expect(model.team.bracketUrl).toBe('https://bracket.example.test/path');
        expect(model.team.registrationProvider.map((row) => row.value)).toContain('Sports Connect');
        expect(model.players.find((player) => player.id === 'player-1').photoUrl).toBe('https://img.example.test/player.png');
        expect(model.linkedPlayers.map((player) => player.id)).toEqual(['player-1']);
        expect(model.record).toMatchObject({ wins: 1, losses: 0, ties: 0, gamesPlayed: 1 });
        expect(model.upcomingEvents.map((event) => event.id)).toEqual(['game-1', 'practice-1']);
        expect(model.standings.currentRow.record).toBe('1-0');
        expect(model.leaderboards[0].leaders[0]).toMatchObject({ playerId: 'player-1', formattedValue: '88' });
        expect(model.trackingSummaries[0].items[0]).toMatchObject({ title: 'Bring ball', isComplete: true });
        expect(model.sponsors[0].imageUrl).toBe('https://img.example.test/pizza.png');
        expect(model.canManageTeam).toBe(false);
    });

    it('normalizes edge cases for linked players, events, streams, registration, and sponsors', () => {
        const model = buildTeamDetailModel({
            teamId: 'team/with slash',
            team: {
                name: 'Edge Bears',
                sport: 'Soccer',
                logoUrl: 'https://img.example.test/logo.png',
                twitchChannel: 'allplayslive',
                registrationProvider: {
                    providerName: 'League Apps',
                    teamId: 'remote-team-1',
                    syncStatus: 'ok'
                }
            },
            players: [
                { id: 'player-10', name: 'Zed Runner', number: '10', userId: 'user-1', photoUrl: 'https://img.example.test/zed.png' },
                { id: 'player-2', name: 'Amy Wing', number: '2', active: true },
                { id: 'player-99', name: 'Inactive Player', number: '1', active: false }
            ],
            games: [
                { id: 'cancelled-game', opponent: 'Cancelled', date: new Date('2100-06-04T18:00:00Z'), status: 'cancelled' },
                { id: 'future-practice', type: 'practice', title: 'Practice', date: new Date('2100-06-03T18:00:00Z') },
                { id: 'future-game', opponent: 'Falcons', date: new Date('2100-06-02T18:00:00Z'), status: 'scheduled' },
                { id: 'scored-past', opponent: 'Wolves', date: new Date('2020-06-01T18:00:00Z'), status: 'scheduled', homeScore: 3, awayScore: 2, isHome: true },
                { id: 'final-game', opponent: 'Lions', date: new Date('2020-05-01T18:00:00Z'), status: 'final', homeScore: 1, awayScore: 1, isHome: false }
            ],
            configs: [],
            user: {
                uid: 'user-1',
                email: 'parent@example.com',
                roles: ['parent'],
                playerKeys: ['team/with slash::player-2']
            },
            sponsors: [
                { id: 's1', name: 'Sponsor 1', description: '', imageUrl: null, websiteUrl: 'https://one.example.test' },
                { id: 's2', name: 'Sponsor 2', description: '', imageUrl: null, websiteUrl: 'https://two.example.test' },
                { id: 's3', name: 'Sponsor 3', description: '', imageUrl: null, websiteUrl: 'https://three.example.test' },
                { id: 's4', name: 'Sponsor 4', description: '', imageUrl: null, websiteUrl: 'https://four.example.test' },
                { id: 's5', name: 'Sponsor 5', description: '', imageUrl: null, websiteUrl: 'https://five.example.test' }
            ]
        });

        expect(model.team.photoUrl).toBe('https://img.example.test/logo.png');
        expect(model.team.streamUrl).toBe('https://twitch.tv/allplayslive');
        expect(model.team.websiteUrl).toBe('https://allplays.ai/team.html#teamId=team%2Fwith+slash');
        expect(model.team.editTeamUrl).toBe('https://allplays.ai/edit-team.html#teamId=team%2Fwith+slash');
        expect(model.team.mediaUrl).toBe('https://allplays.ai/team-media.html#teamId=team%2Fwith+slash');
        expect(model.team.registrationProvider).toEqual([
            { label: 'Provider', value: 'League Apps' },
            { label: 'Team ID', value: 'remote-team-1' },
            { label: 'Last Sync', value: 'ok' }
        ]);
        expect(model.players.map((player) => player.id)).toEqual(['player-2', 'player-10']);
        expect(model.linkedPlayers.map((player) => player.id)).toEqual(['player-2', 'player-10']);
        expect(model.upcomingEvents.map((event) => event.id)).toEqual(['future-game', 'future-practice']);
        expect(model.upcomingEvents.map((event) => event.id)).not.toContain('cancelled-game');
        expect(model.recentResults.map((event) => event.id)).toEqual(['scored-past', 'final-game']);
        expect(model.counts).toMatchObject({ games: 4, practices: 1, completedGames: 1 });
        expect(model.sponsors.map((sponsor) => sponsor.id)).toEqual(['s1', 's2', 's3', 's4']);
    });

    it('adds staff permissions only for users with full team access', () => {
        const team = {
            ownerId: 'owner-1',
            ownerEmail: 'Owner@Example.com',
            adminEmails: [' Coach@Example.com ', 'coach@example.com'],
            teamPermissions: {
                scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1', 'scorekeeper-1'] },
                streaming: { mode: 'selected', memberIds: ['scorekeeper-1', 'video-1'] },
                volunteer: { mode: 'selected', memberIds: ['snacks-1'] }
            },
            streamVolunteerEmails: ['video@example.com']
        };

        const adminModel = buildTeamDetailModel({
            teamId: 'team-1',
            team,
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
            pendingAdminInvites: [
                { email: 'pending@example.com', type: 'admin_invite', used: false },
                { email: 'used@example.com', type: 'admin_invite', used: true }
            ]
        });

        expect(adminModel.canManageTeam).toBe(true);
        expect(adminModel.staffPermissions.staff).toEqual([
            { label: 'owner@example.com', role: 'Owner' },
            { label: 'coach@example.com', role: 'Admin' }
        ]);
        expect(adminModel.staffPermissions.pendingInvites).toEqual(['pending@example.com']);
        expect(adminModel.staffPermissions.helperPermissions).toEqual([
            expect.objectContaining({ key: 'scorekeeper', grants: ['scorekeeper-1'] }),
            expect.objectContaining({ key: 'stream-score', grants: ['scorekeeper-1'] }),
            expect.objectContaining({ key: 'videographer', grants: ['scorekeeper-1', 'video-1', 'video@example.com'] }),
            expect.objectContaining({ key: 'volunteer', grants: ['snacks-1'] })
        ]);

        const parentModel = buildTeamDetailModel({
            teamId: 'team-1',
            team,
            user: { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'] }
        });
        expect(parentModel.canManageTeam).toBe(false);
        expect(parentModel.staffPermissions).toBeNull();
    });

    it('loads pending admin invites for team admins but not parent members', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        getAggregatedStatsForGames.mockResolvedValue({});
        getAdSpaceSponsors.mockResolvedValue([]);
        getLocalAttractionSponsors.mockResolvedValue([]);
        const future = Date.now() + 60_000;
        const past = Date.now() - 60_000;
        getDocs.mockResolvedValue({
            docs: [
                { id: 'invite-1', data: () => ({ email: 'pending@example.com', teamId: 'team-1', type: 'admin_invite', used: false, expiresAt: { toMillis: () => future } }) },
                { id: 'invite-2', data: () => ({ email: 'expired@example.com', teamId: 'team-1', type: 'admin_invite', used: false, expiresAt: { toMillis: () => past } }) },
                { id: 'invite-3', data: () => ({ email: 'revoked@example.com', teamId: 'team-1', type: 'admin_invite', used: false, revoked: true, expiresAt: { toMillis: () => future } }) },
                { id: 'invite-4', data: () => ({ email: 'inactive@example.com', teamId: 'team-1', type: 'admin_invite', used: false, active: false, expiresAt: { toMillis: () => future } }) },
                { id: 'invite-5', data: () => ({ email: 'cancelled@example.com', teamId: 'team-1', type: 'admin_invite', used: false, status: 'cancelled', expiresAt: { toMillis: () => future } }) },
                { id: 'invite-6', data: () => ({ email: 'used@example.com', teamId: 'team-1', type: 'admin_invite', used: true, expiresAt: { toMillis: () => future } }) },
                { id: 'invite-7', data: () => ({ email: 'standard@example.com', teamId: 'team-1', type: 'standard', used: false, expiresAt: { toMillis: () => future } }) }
            ]
        });

        const adminModel = await loadParentTeamDetail('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] });
        expect(adminModel.staffPermissions.pendingInvites).toEqual(['pending@example.com']);
        expect(getDocs).toHaveBeenCalledTimes(1);

        getDocs.mockClear();
        const parentModel = await loadParentTeamDetail('team-1', { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'] });
        expect(parentModel.staffPermissions).toBeNull();
        expect(getDocs).not.toHaveBeenCalled();
    });
});
