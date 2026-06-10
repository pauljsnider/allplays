// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => false
    }
}), { virtual: true });

vi.mock('@capacitor-firebase/authentication', () => ({
    FirebaseAuthentication: {}
}), { virtual: true });

vi.mock('../../js/db.js', () => ({
    getAggregatedStatsForGames: vi.fn(),
    getAdSpaceSponsors: vi.fn(),
    getConfigs: vi.fn(),
    getGames: vi.fn(),
    getLocalAttractionSponsors: vi.fn(),
    getPlayers: vi.fn(),
    getPlayerTrackingStatuses: vi.fn(),
    getPublicTrackingItems: vi.fn(),
    getTeam: vi.fn(),
    getAllUsers: vi.fn(),
    updateTeam: vi.fn(),
    getEvents: vi.fn(),
    updateEvent: vi.fn(),
    updateGame: vi.fn(),
    grantScorekeeperAccess: vi.fn(),
    grantVideographerAccess: vi.fn(),
    inviteAdmin: vi.fn(),
    addTeamAdminEmail: vi.fn(),
    revokeScorekeeperAccess: vi.fn(),
    revokeVideographerAccess: vi.fn()
}));

vi.mock('../../js/firebase.js', () => ({
    collection: vi.fn((db, name) => ({ db, name })),
    db: {},
    getDocs: vi.fn(),
    query: vi.fn((...parts) => parts),
    where: vi.fn((field, op, value) => ({ field, op, value }))
}));

vi.mock('../../js/auth.js', () => ({
    sendInviteEmail: vi.fn()
}));

vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    firebaseAuth: { app: { options: { projectId: 'demo-allplays' } } },
    getNativeAuthIdToken: vi.fn()
}));

import { __resetTeamDetailBaseSnapshotCacheForTests, buildAdminAcceptInviteUrl, buildPublicTeamGamesIcsUrl, buildTeamDetailModel, canExposePublicFanFeed, grantScorekeeperAccessForApp, grantVideographerAccessForApp, inviteTeamAdminForApp, loadParentTeamDetail, loadTeamDetailInsights, loadTeamDetailSponsors, loadTeamStaffPermissions, revokeScorekeeperAccessForApp, revokeVideographerAccessForApp, saveTeamScheduleNotificationsForApp } from '../../apps/app/src/lib/teamDetailService.ts';
import { collection, getDocs, query, where } from '../../js/firebase.js';
import { getAggregatedStatsForGames, getAdSpaceSponsors, getAllUsers, getConfigs, getEvents, getGames, getLocalAttractionSponsors, getPlayerTrackingStatuses, getPlayers, getPublicTrackingItems, getTeam, grantScorekeeperAccess, grantVideographerAccess, inviteAdmin, addTeamAdminEmail, revokeScorekeeperAccess, revokeVideographerAccess, updateEvent, updateGame, updateTeam } from '../../js/db.js';
import { sendInviteEmail } from '../../js/auth.js';

beforeEach(() => {
    __resetTeamDetailBaseSnapshotCacheForTests();
    vi.clearAllMocks();
});

describe('React app team detail model', () => {

    it('creates one normalized admin invite for the app and builds fallback links', async () => {
        inviteAdmin.mockResolvedValue({ code: ' CODE 1 ', teamName: 'Bears', existingUser: false });
        addTeamAdminEmail.mockResolvedValue(undefined);
        sendInviteEmail.mockResolvedValue({ success: true });

        const result = await inviteTeamAdminForApp(' team-1 ', ' Coach@Example.com ');

        expect(inviteAdmin).toHaveBeenCalledWith('team-1', 'coach@example.com');
        expect(addTeamAdminEmail).not.toHaveBeenCalled();
        expect(sendInviteEmail).toHaveBeenCalledWith('coach@example.com', 'CODE 1', 'admin', { teamName: 'Bears' });
        expect(result).toMatchObject({
            email: 'coach@example.com',
            status: 'sent',
            code: 'CODE 1',
            teamName: 'Bears',
            acceptInviteUrl: 'http://localhost:3000/app#/accept-invite?code=CODE+1&type=admin'
        });
        expect(buildAdminAcceptInviteUrl('A&B', 'https://allplays.ai')).toBe('https://allplays.ai/app#/accept-invite?code=A%26B&type=admin');
    });

    it('returns fallback invite code details when app email delivery fails', async () => {
        inviteAdmin.mockResolvedValue({ code: 'FALLBACK1', teamName: 'Bears', existingUser: false });
        addTeamAdminEmail.mockResolvedValue(undefined);
        sendInviteEmail.mockRejectedValue(new Error('SMTP offline'));

        const result = await inviteTeamAdminForApp('team-1', 'coach@example.com');

        expect(result.status).toBe('fallback_code');
        expect(result.code).toBe('FALLBACK1');
        expect(result.acceptInviteUrl).toBe('http://localhost:3000/app#/accept-invite?code=FALLBACK1&type=admin');
    });

    it('rejects missing team id or email before creating app admin invites', async () => {
        inviteAdmin.mockClear();
        await expect(inviteTeamAdminForApp('', 'coach@example.com')).rejects.toThrow('Team ID is required.');
        await expect(inviteTeamAdminForApp('team-1', '   ')).rejects.toThrow('Admin email is required.');
        expect(inviteAdmin).not.toHaveBeenCalled();
    });

    it('wraps scorekeeper grant mutations with app validation', async () => {
        grantScorekeeperAccess.mockResolvedValue(undefined);
        revokeScorekeeperAccess.mockResolvedValue(undefined);
        grantVideographerAccess.mockResolvedValue(undefined);
        revokeVideographerAccess.mockResolvedValue(undefined);

        await grantScorekeeperAccessForApp(' team-1 ', ' member-1 ');
        await revokeScorekeeperAccessForApp('team-1', 'member-1');
        await grantVideographerAccessForApp(' team-1 ', ' member-2 ');
        await revokeVideographerAccessForApp('team-1', 'member-2');

        expect(grantScorekeeperAccess).toHaveBeenCalledWith('team-1', 'member-1');
        expect(revokeScorekeeperAccess).toHaveBeenCalledWith('team-1', 'member-1');
        expect(grantVideographerAccess).toHaveBeenCalledWith('team-1', 'member-2');
        expect(revokeVideographerAccess).toHaveBeenCalledWith('team-1', 'member-2');

        grantScorekeeperAccess.mockClear();
        grantVideographerAccess.mockClear();
        await expect(grantScorekeeperAccessForApp('', 'member-1')).rejects.toThrow('Team ID is required.');
        await expect(grantScorekeeperAccessForApp('team-1', '')).rejects.toThrow('Team member user ID is required.');
        await expect(grantVideographerAccessForApp('', 'member-1')).rejects.toThrow('Team ID is required.');
        await expect(grantVideographerAccessForApp('team-1', '')).rejects.toThrow('Team member user ID is required.');
        expect(grantScorekeeperAccess).not.toHaveBeenCalled();
        expect(grantVideographerAccess).not.toHaveBeenCalled();
    });

    it('invalidates cached team detail snapshots after scorekeeper mutations so refreshed permissions reflect the write', async () => {
        getTeam
            .mockResolvedValueOnce({
                id: 'team-1',
                name: 'Bears',
                ownerId: 'owner-1',
                adminEmails: ['coach@example.com'],
                teamPermissions: { scorekeeping: { mode: 'selected', memberIds: [] } }
            })
            .mockResolvedValueOnce({
                id: 'team-1',
                name: 'Bears',
                ownerId: 'owner-1',
                adminEmails: ['coach@example.com'],
                teamPermissions: { scorekeeping: { mode: 'selected', memberIds: ['parent-1'] } }
            });
        getPlayers.mockResolvedValue([
            {
                id: 'player-1',
                name: 'Pat Star',
                parents: [{ userId: 'parent-1', name: 'Parent One', email: 'parent@example.com' }]
            }
        ]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        getAllUsers.mockResolvedValue([]);
        getDocs.mockResolvedValue({ docs: [] });
        grantScorekeeperAccess.mockResolvedValue(undefined);

        const managerUser = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] };

        const beforeGrant = await loadTeamStaffPermissions('team-1', managerUser);
        expect(beforeGrant.scorekeeperGrantTargets).toEqual([
            { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Pat Star'], isGranted: false }
        ]);

        await grantScorekeeperAccessForApp('team-1', 'parent-1');

        const afterGrant = await loadTeamStaffPermissions('team-1', managerUser);
        expect(afterGrant.scorekeeperGrantTargets).toEqual([
            { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Pat Star'], isGranted: true }
        ]);
        expect(getTeam).toHaveBeenCalledTimes(2);
    });

    it('normalizes and saves team schedule reminder defaults without rewriting existing events', async () => {
        updateTeam.mockResolvedValue(undefined);
        getEvents.mockResolvedValue([
            { id: 'game-1', type: 'game', date: new Date('2000-06-01T18:00:00Z'), status: 'completed' },
            { id: 'practice-1', type: 'practice', date: new Date('2100-06-02T18:00:00Z'), status: 'cancelled' }
        ]);
        updateGame.mockResolvedValue(undefined);
        updateEvent.mockResolvedValue(undefined);

        const saved = await saveTeamScheduleNotificationsForApp(' team-1 ', { enabled: false, reminderHours: 99, delivery: 'email' });

        expect(updateTeam).toHaveBeenCalledWith('team-1', {
            scheduleNotifications: {
                enabled: false,
                reminderHours: 24,
                delivery: 'team_chat'
            }
        });
        expect(getEvents).not.toHaveBeenCalled();
        expect(updateGame).not.toHaveBeenCalled();
        expect(updateEvent).not.toHaveBeenCalled();
        expect(saved).toMatchObject({
            enabled: false,
            reminderHours: 24,
            delivery: 'team_chat',
            hasExplicitReminderHours: false,
            summary: 'Fallback reminder window: 24 hours before event start. No team default is set yet.'
        });
    });

    it('builds public fan feed URLs and gates them to public or shareable games', () => {
        window.__ALLPLAYS_CONFIG__ = {
            publicTeamGamesIcsFunctionUrl: 'https://calendar.example.test/publicTeamGamesIcs',
            calendarFetchFunctionUrl: 'https://calendar.example.test/fetchCalendarIcs'
        };

        expect(buildPublicTeamGamesIcsUrl('team 1/blue')).toBe('https://calendar.example.test/publicTeamGamesIcs?teamId=team%201%2Fblue');
        expect(buildPublicTeamGamesIcsUrl('')).toBe('');
        expect(canExposePublicFanFeed(
            { isPublic: false, active: true },
            [
                { id: 'shareable-game', type: 'game', shareable: true, isPrivate: false, visibility: '', status: 'scheduled', liveStatus: '' },
                { id: 'practice-1', type: 'practice', isPublic: true, status: 'scheduled', liveStatus: '' }
            ]
        )).toBe(true);
        expect(canExposePublicFanFeed(
            { active: true },
            [
                { id: 'legacy-private-game', type: 'game', visibility: '', isPrivate: false, shareable: false, publicCalendar: false, status: 'scheduled', liveStatus: '' }
            ]
        )).toBe(false);
        expect(canExposePublicFanFeed(
            { isPublic: false, active: true },
            [
                { id: 'private-game', type: 'game', visibility: 'private', isPrivate: true, shareable: false, status: 'scheduled', liveStatus: '' },
                { id: 'deleted-game', type: 'game', isPublic: true, status: 'deleted', liveStatus: '' },
                { id: 'practice-2', type: 'practice', isPublic: true, status: 'scheduled', liveStatus: '' }
            ]
        )).toBe(false);
        expect(canExposePublicFanFeed(
            { isPublic: true, active: true },
            [
                { id: 'public-team-game', type: 'game', visibility: '', isPrivate: false, status: 'scheduled', liveStatus: '' }
            ]
        )).toBe(true);

        delete window.__ALLPLAYS_CONFIG__;
    });

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
                { id: 'game-1', opponent: 'Falcons', date: new Date('2100-06-01T18:00:00Z'), status: 'scheduled', homeScore: null, awayScore: null, shareable: true },
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
        expect(model.team.isPublic).toBe(false);
        expect(model.team.active).toBe(true);
        expect(model.team.scheduleNotifications).toMatchObject({
            enabled: true,
            reminderHours: 24,
            delivery: 'team_chat',
            hasExplicitReminderHours: false,
            summary: 'Fallback reminder window: 24 hours before event start. No team default is set yet.'
        });
        expect(model.team.registrationProvider.map((row) => row.value)).toContain('Sports Connect');
        expect(model.players.find((player) => player.id === 'player-1').photoUrl).toBe('https://img.example.test/player.png');
        expect(model.linkedPlayers.map((player) => player.id)).toEqual(['player-1']);
        expect(model.record).toMatchObject({ wins: 1, losses: 0, ties: 0, gamesPlayed: 1 });
        expect(model.upcomingEvents.map((event) => event.id)).toEqual(['game-1', 'practice-1']);
        expect(model.upcomingEvents[0]).toMatchObject({ shareable: true, isPrivate: false, publicCalendar: false, liveStatus: '' });
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
                scheduleNotifications: { enabled: false, reminderHours: '48', delivery: 'email' },
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
        expect(model.team.scheduleNotifications).toMatchObject({
            enabled: false,
            reminderHours: 48,
            delivery: 'team_chat',
            hasExplicitReminderHours: true,
            summary: 'Team default reminder window: 48 hours before event start.'
        });
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
                videography: { mode: 'selected', memberIds: ['video-1', 'video-1'] },
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
        expect(adminModel.staffPermissions.scorekeepingMode).toBe('selected');
        expect(adminModel.staffPermissions.helperPermissions).toEqual([
            expect.objectContaining({ key: 'scorekeeper', grants: ['scorekeeper-1'] }),
            expect.objectContaining({ key: 'stream-score', grants: ['scorekeeper-1'] }),
            expect.objectContaining({ key: 'videographer', grants: ['video-1', 'video@example.com'] }),
            expect.objectContaining({ key: 'volunteer', grants: ['snacks-1'] })
        ]);

        const targetedModel = buildTeamDetailModel({
            teamId: 'team-1',
            team,
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
            players: [
                { id: 'player-1', name: 'Pat Star', userId: 'scorekeeper-1' },
                { id: 'player-2', name: 'Sam Wing', parents: [{ userId: 'parent-1', name: 'Parent One', email: 'parent@example.com' }] },
                { id: 'inactive', name: 'Inactive', userId: 'inactive-1', active: false }
            ]
        });
        expect(targetedModel.staffPermissions.scorekeeperGrantTargets).toEqual([
            { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Sam Wing'], isGranted: false },
            { userId: 'scorekeeper-1', name: 'Pat Star', email: '', playerNames: ['Pat Star'], isGranted: true }
        ]);
        expect(targetedModel.staffPermissions.videographerGrantTargets).toEqual([
            { userId: 'parent-1', name: 'Parent One', email: 'parent@example.com', playerNames: ['Sam Wing'], isGranted: false },
            { userId: 'scorekeeper-1', name: 'Pat Star', email: '', playerNames: ['Pat Star'], isGranted: false }
        ]);

        const legacyLinkedModel = buildTeamDetailModel({
            teamId: 'team-1',
            team,
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
            players: [
                { id: 'player-2', name: 'Sam Wing' }
            ],
            confirmedTeamMembers: [
                {
                    id: 'video-1',
                    fullName: 'Video Parent',
                    email: 'video@example.com',
                    parentOf: [{ teamId: 'team-1', playerId: 'player-2' }]
                }
            ]
        });
        expect(legacyLinkedModel.staffPermissions.videographerGrantTargets).toEqual([
            { userId: 'video-1', name: 'Video Parent', email: 'video@example.com', playerNames: ['Sam Wing'], isGranted: true }
        ]);

        const parentModel = buildTeamDetailModel({
            teamId: 'team-1',
            team,
            user: { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'] }
        });
        expect(parentModel.canManageTeam).toBe(false);
        expect(parentModel.staffPermissions).toBeNull();
    });

    it('does not load staff permissions during the initial team detail fetch', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
        getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star' }]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        getAggregatedStatsForGames.mockResolvedValue({});
        getAdSpaceSponsors.mockResolvedValue([]);
        getAllUsers.mockResolvedValue([{ id: 'video-1', fullName: 'Video Parent', email: 'video@example.com', parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] }]);
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

        const adminModel = await loadParentTeamDetail('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }, { includeDeferredData: false });
        expect(adminModel.canManageTeam).toBe(true);
        expect(adminModel.staffPermissions).toBeNull();
        expect(adminModel.leaderboards).toEqual([]);
        expect(adminModel.trackingSummaries).toEqual([]);
        expect(adminModel.sponsors).toEqual([]);
        expect(getAllUsers).not.toHaveBeenCalled();
        expect(getDocs).not.toHaveBeenCalled();
        expect(getAggregatedStatsForGames).not.toHaveBeenCalled();
        expect(getPublicTrackingItems).not.toHaveBeenCalled();
        expect(getPlayerTrackingStatuses).not.toHaveBeenCalled();
        expect(getLocalAttractionSponsors).not.toHaveBeenCalled();
        expect(getAdSpaceSponsors).not.toHaveBeenCalled();

        getDocs.mockClear();
        getAllUsers.mockClear();
        const parentModel = await loadParentTeamDetail('team-1', { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'] }, { includeDeferredData: false });
        expect(parentModel.staffPermissions).toBeNull();
        expect(getDocs).not.toHaveBeenCalled();
        expect(getAllUsers).not.toHaveBeenCalled();
    });

    it('reuses the initial base snapshot for deferred insights and staff permissions', async () => {
        getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            sport: 'Basketball',
            ownerId: 'owner-1',
            adminEmails: ['coach@example.com'],
            teamPermissions: { videography: { mode: 'selected', memberIds: ['video-1'] } }
        });
        getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star', photoUrl: 'https://img.example.test/player.png' }]);
        getGames.mockResolvedValue([
            { id: 'game-1', opponent: 'Falcons', date: new Date('2026-05-01T18:00:00Z'), status: 'completed', homeScore: 42, awayScore: 35, isHome: true }
        ]);
        getConfigs.mockResolvedValue([{
            id: 'basketball',
            name: 'Basketball',
            columns: ['pts'],
            statDefinitions: [{ id: 'pts', label: 'Points', acronym: 'PTS', topStat: true, visibility: 'public', scope: 'player' }]
        }]);
        getAggregatedStatsForGames.mockResolvedValue({ 'player-1': { pts: 88 } });
        getPublicTrackingItems.mockResolvedValue([{ id: 'item-1', title: 'Bring ball', public: true }]);
        getPlayerTrackingStatuses.mockResolvedValue([{ itemId: 'item-1', playerId: 'player-1', status: 'complete', public: true }]);
        getAllUsers.mockResolvedValue([{ id: 'video-1', fullName: 'Video Parent', email: 'video@example.com', parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] }]);
        const future = Date.now() + 60_000;
        getDocs.mockResolvedValue({
            docs: [
                { id: 'invite-1', data: () => ({ email: 'pending@example.com', teamId: 'team-1', type: 'admin_invite', used: false, expiresAt: { toMillis: () => future } }) }
            ]
        });

        const user = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'], parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] };
        await loadParentTeamDetail('team-1', user, { includeDeferredData: false });
        const insights = await loadTeamDetailInsights('team-1', user);
        const staffPermissions = await loadTeamStaffPermissions('team-1', user);
        const sponsors = await loadTeamDetailSponsors('team-1');

        expect(getTeam).toHaveBeenCalledTimes(1);
        expect(getPlayers).toHaveBeenCalledTimes(1);
        expect(getGames).toHaveBeenCalledTimes(1);
        expect(getConfigs).toHaveBeenCalledTimes(1);
        expect(getAggregatedStatsForGames).toHaveBeenCalledWith('team-1', ['game-1']);
        expect(getPublicTrackingItems).toHaveBeenCalledWith('team-1');
        expect(getPlayerTrackingStatuses).toHaveBeenCalledWith('team-1', ['player-1']);
        expect(insights.leaderboards[0].leaders[0]).toMatchObject({ playerId: 'player-1', formattedValue: '88' });
        expect(staffPermissions.pendingInvites).toEqual(['pending@example.com']);
        expect(staffPermissions.videographerGrantTargets).toEqual([
            { userId: 'video-1', name: 'Video Parent', email: 'video@example.com', playerNames: ['Pat Star'], isGranted: true }
        ]);
        expect(getLocalAttractionSponsors).toHaveBeenCalledWith('team-1');
        expect(getAdSpaceSponsors).toHaveBeenCalledWith('team-1');
        expect(sponsors.sponsors).toEqual([]);
    });

    it('loads deferred insights and sponsors only when requested', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', sport: 'Basketball' });
        getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star', photoUrl: 'https://img.example.test/player.png' }]);
        getGames.mockResolvedValue([
            { id: 'game-1', opponent: 'Falcons', date: new Date('2026-05-01T18:00:00Z'), status: 'completed', homeScore: 42, awayScore: 35, isHome: true }
        ]);
        getConfigs.mockResolvedValue([{
            id: 'basketball',
            name: 'Basketball',
            columns: ['pts'],
            statDefinitions: [{ id: 'pts', label: 'Points', acronym: 'PTS', topStat: true, visibility: 'public', scope: 'player' }]
        }]);
        getAggregatedStatsForGames.mockResolvedValue({ 'player-1': { pts: 88 } });
        getPublicTrackingItems.mockResolvedValue([{ id: 'item-1', title: 'Bring ball', public: true }]);
        getPlayerTrackingStatuses.mockResolvedValue([{ itemId: 'item-1', playerId: 'player-1', status: 'complete', public: true }]);
        getLocalAttractionSponsors.mockResolvedValue([{ id: 'local-1', name: 'Museum', description: 'Visit downtown', imageUrl: null, websiteUrl: 'https://museum.example.test' }]);
        getAdSpaceSponsors.mockResolvedValue([{ id: 'ad-1', name: 'Pizza Place', description: 'After game', imageUrl: null, websiteUrl: 'https://pizza.example.test' }]);

        const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'], parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] });
        const sponsors = await loadTeamDetailSponsors('team-1');

        expect(getAggregatedStatsForGames).toHaveBeenCalledWith('team-1', ['game-1']);
        expect(getPublicTrackingItems).toHaveBeenCalledWith('team-1');
        expect(getPlayerTrackingStatuses).toHaveBeenCalledWith('team-1', ['player-1']);
        expect(insights.leaderboards[0].leaders[0]).toMatchObject({ playerId: 'player-1', formattedValue: '88' });
        expect(insights.trackingSummaries[0].items[0]).toMatchObject({ title: 'Bring ball', isComplete: true });
        expect(getLocalAttractionSponsors).toHaveBeenCalledWith('team-1');
        expect(getAdSpaceSponsors).toHaveBeenCalledWith('team-1');
        expect(sponsors.sponsors.map((sponsor) => sponsor.id)).toEqual(['ad-1', 'local-1']);
    });

    it('loads deferred staff permissions only when requested for a team manager', async () => {
        getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            ownerId: 'owner-1',
            adminEmails: ['coach@example.com'],
            teamPermissions: { videography: { mode: 'selected', memberIds: ['video-1'] } }
        });
        getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star' }]);
        getAllUsers.mockResolvedValue([{ id: 'video-1', fullName: 'Video Parent', email: 'video@example.com', parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] }]);
        const future = Date.now() + 60_000;
        getDocs.mockResolvedValue({
            docs: [
                { id: 'invite-1', data: () => ({ email: 'pending@example.com', teamId: 'team-1', type: 'admin_invite', used: false, expiresAt: { toMillis: () => future } }) }
            ]
        });

        const staffPermissions = await loadTeamStaffPermissions('team-1', { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] });

        expect(staffPermissions.pendingInvites).toEqual(['pending@example.com']);
        expect(staffPermissions.videographerGrantTargets).toEqual([
            { userId: 'video-1', name: 'Video Parent', email: 'video@example.com', playerNames: ['Pat Star'], isGranted: true }
        ]);
        expect(getAllUsers).toHaveBeenCalledTimes(1);
        expect(getDocs).toHaveBeenCalledTimes(1);
        expect(collection).toHaveBeenCalledWith({}, 'accessCodes');
        expect(where).toHaveBeenCalledWith('teamId', '==', 'team-1');
        expect(query).toHaveBeenCalledWith({ db: {}, name: 'accessCodes' }, { field: 'teamId', op: '==', value: 'team-1' });

        getDocs.mockClear();
        getAllUsers.mockClear();
        const parentStaffPermissions = await loadTeamStaffPermissions('team-1', { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'] });
        expect(parentStaffPermissions).toBeNull();
        expect(getDocs).not.toHaveBeenCalled();
        expect(getAllUsers).not.toHaveBeenCalled();
    });
});
