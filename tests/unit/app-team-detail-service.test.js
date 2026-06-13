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
    addPlayer: vi.fn(),
    getAggregatedStatsForGames: vi.fn(),
    getAdSpaceSponsors: vi.fn(),
    getConfigs: vi.fn(),
    getGames: vi.fn(),
    inviteParent: vi.fn(),
    getLocalAttractionSponsors: vi.fn(),
    getPlayers: vi.fn(),
    getPlayerTrackingStatuses: vi.fn(),
    getPublicTrackingItems: vi.fn(),
    getRosterFieldDefinitions: vi.fn(),
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
    revokeVideographerAccess: vi.fn(),
    deactivatePlayer: vi.fn(),
    reactivatePlayer: vi.fn(),
    setPlayerPrivateRosterProfileFields: vi.fn(),
    uploadPlayerPhoto: vi.fn(),
    uploadTeamPhoto: vi.fn()
}));

vi.mock('../../js/firebase.js?v=18', () => ({
    collection: vi.fn((db, name) => ({ db, name })),
    db: {},
    getDocs: vi.fn(),
    query: vi.fn((...parts) => parts),
    where: vi.fn((field, op, value) => ({ field, op, value }))
}));

vi.mock('../../js/auth.js', () => ({
    sendInviteEmail: vi.fn()
}));

vi.mock('../../apps/app/src/lib/authService', () => ({
    firebaseAuth: { app: { options: { projectId: 'demo-allplays' } } },
    getNativeAuthIdToken: vi.fn()
}));

import { __resetTeamDetailBaseSnapshotCacheForTests, addRosterPlayerForApp, buildAdminAcceptInviteUrl, buildPublicTeamGamesIcsUrl, buildRosterParentInviteSummaries, buildTeamDetailModel, canExposePublicFanFeed, createRosterParentInviteForApp, deactivateRosterPlayerForApp, grantScorekeeperAccessForApp, grantVideographerAccessForApp, inviteTeamAdminForApp, loadParentTeamDetail, loadRosterFieldDefinitionsForApp, loadTeamDetailInsights, loadTeamDetailSponsors, loadTeamStaffPermissions, reactivateRosterPlayerForApp, revokeScorekeeperAccessForApp, revokeTeamAdminAccessForApp, revokeVideographerAccessForApp, saveTeamScheduleNotificationsForApp, updateTeamSettingsForApp } from '../../apps/app/src/lib/teamDetailService.ts';
import { collection, getDocs, query, where } from '../../js/firebase.js?v=18';
import { addPlayer, getAggregatedStatsForGames, getAdSpaceSponsors, getAllUsers, getConfigs, getEvents, getGames, getLocalAttractionSponsors, getPlayerTrackingStatuses, getPlayers, getPublicTrackingItems, getRosterFieldDefinitions, getTeam, grantScorekeeperAccess, grantVideographerAccess, inviteAdmin, inviteParent, addTeamAdminEmail, revokeScorekeeperAccess, revokeVideographerAccess, deactivatePlayer, reactivatePlayer, setPlayerPrivateRosterProfileFields, updateEvent, updateGame, updateTeam, uploadPlayerPhoto, uploadTeamPhoto } from '../../js/db.js';
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

        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);

        const result = await inviteTeamAdminForApp(' team-1 ', ' Coach@Example.com ', { uid: 'owner-1', email: 'owner@example.com', roles: ['coach'] });

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

        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);

        const result = await inviteTeamAdminForApp('team-1', 'coach@example.com', { uid: 'owner-1', email: 'owner@example.com', roles: ['coach'] });

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

    it('requires owner or platform admin access before creating or revoking team admin access', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', adminEmails: [' coach@example.com ', 'COACH@example.com '] });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        updateTeam.mockResolvedValue(undefined);

        await expect(inviteTeamAdminForApp('team-1', 'newcoach@example.com', { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] })).rejects.toThrow('You do not have permission to manage admins for this team.');
        await expect(revokeTeamAdminAccessForApp('team-1', 'coach@example.com', { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] })).rejects.toThrow('You do not have permission to manage admins for this team.');

        await revokeTeamAdminAccessForApp('team-1', ' Coach@Example.com ', { uid: 'owner-1', email: 'owner@example.com', roles: ['coach'] });
        expect(updateTeam).toHaveBeenCalledWith('team-1', {
            adminEmails: [],
            updatedAt: expect.any(Date)
        });

        updateTeam.mockClear();
        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', adminEmails: ['coach@example.com'] });
        await revokeTeamAdminAccessForApp('team-1', 'coach@example.com', { uid: 'admin-1', email: 'admin@example.com', isPlatformAdmin: true, roles: [] });
        expect(updateTeam).toHaveBeenCalledWith('team-1', {
            adminEmails: [],
            updatedAt: expect.any(Date)
        });

        updateTeam.mockClear();
        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', adminEmails: ['coach@example.com'] });
        await revokeTeamAdminAccessForApp('team-1', 'coach@example.com', { uid: 'admin-2', email: 'platform@example.com', roles: ['platformAdmin'] });
        expect(updateTeam).toHaveBeenCalledWith('team-1', {
            adminEmails: [],
            updatedAt: expect.any(Date)
        });

        await expect(revokeTeamAdminAccessForApp('team-1', 'owner@example.com', { uid: 'owner-1', email: 'owner@example.com', roles: ['coach'] })).rejects.toThrow('The team owner cannot be removed from staff access.');
    });

    it('requires full team access before creating parent invites in the app helper', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        inviteParent.mockResolvedValue({ code: 'ABCD1234', autoLinked: false, existingUser: false, teamName: 'Bears', playerName: 'Pat Star' });

        await expect(createRosterParentInviteForApp('team-1', { uid: 'parent-1', email: 'parent@example.com', roles: ['parent'] }, { id: 'player-1', number: '9' })).rejects.toThrow('You do not have permission to invite parents for this team.');
        expect(inviteParent).not.toHaveBeenCalled();

        const result = await createRosterParentInviteForApp('team-1', { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] }, { id: 'player-1', number: '9' });
        expect(inviteParent).toHaveBeenCalledWith('team-1', 'player-1', '9', '', 'Parent');
        expect(result).toMatchObject({
            code: 'ABCD1234',
            inviteUrl: 'http://localhost:3000/app#/accept-invite?code=ABCD1234&type=parent',
            status: 'pending'
        });
    });

    it('loads normalized roster field definitions only for full team staff', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        getRosterFieldDefinitions.mockResolvedValue([
            {
                key: 'grad_year',
                label: 'Grad Year',
                type: 'menu',
                options: [{ value: '2028', label: '2028' }],
                required: true,
                active: true,
                sortOrder: 1
            }
        ]);

        await expect(loadRosterFieldDefinitionsForApp('team-1', { uid: 'parent-1', email: 'parent@example.com', roles: ['parent'] })).rejects.toThrow('You do not have permission to manage roster players for this team.');

        const fields = await loadRosterFieldDefinitionsForApp('team-1', { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] });
        expect(getRosterFieldDefinitions).toHaveBeenCalledWith('team-1', expect.objectContaining({ id: 'team-1' }));
        expect(fields).toEqual([
            expect.objectContaining({
                key: 'grad_year',
                label: 'Grad Year',
                type: 'menu',
                options: [{ value: '2028', label: '2028' }],
                required: true
            })
        ]);
    });

    it('splits private roster fields out of the public player doc when creating roster players', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        getRosterFieldDefinitions.mockResolvedValue([
            {
                key: 'grad_year',
                label: 'Grad Year',
                type: 'menu',
                options: [{ value: '2028', label: '2028' }],
                required: true,
                active: true,
                sortOrder: 1
            },
            {
                key: 'captain',
                label: 'Captain',
                type: 'checkbox',
                options: [],
                required: false,
                active: true,
                sortOrder: 2
            },
            {
                key: 'medical_notes',
                label: 'Medical Notes',
                type: 'text',
                visibility: 'admins',
                options: [],
                required: false,
                active: true,
                sortOrder: 3
            }
        ]);
        uploadPlayerPhoto.mockResolvedValue('https://img.example.test/player-1.png');
        addPlayer.mockResolvedValue('player-1');
        setPlayerPrivateRosterProfileFields.mockResolvedValue(undefined);

        const photoFile = new File(['abc'], 'player.png', { type: 'image/png' });
        const result = await addRosterPlayerForApp(' team-1 ', { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] }, {
            name: ' Pat Star ',
            number: ' 9 ',
            photoFile,
            rosterFieldValues: {
                grad_year: '2028',
                captain: true,
                medical_notes: 'Peanut allergy'
            }
        });

        expect(uploadPlayerPhoto).toHaveBeenCalledWith(photoFile);
        expect(addPlayer).toHaveBeenCalledWith('team-1', {
            name: 'Pat Star',
            number: '9',
            photoUrl: 'https://img.example.test/player-1.png',
            profile: {
                customFields: {
                    grad_year: '2028',
                    captain: true
                }
            }
        });
        expect(setPlayerPrivateRosterProfileFields).toHaveBeenCalledWith('team-1', 'player-1', {
            medical_notes: 'Peanut allergy'
        });
        expect(result).toEqual({
            playerId: 'player-1',
            player: {
                name: 'Pat Star',
                number: '9',
                photoUrl: 'https://img.example.test/player-1.png',
                profile: {
                    customFields: {
                        grad_year: '2028',
                        captain: true
                    }
                }
            }
        });
    });

    it('validates required roster fields before creating a roster player', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        getRosterFieldDefinitions.mockResolvedValue([
            {
                key: 'grad_year',
                label: 'Grad Year',
                type: 'menu',
                options: [{ value: '2028', label: '2028' }],
                required: true,
                active: true,
                sortOrder: 1
            }
        ]);

        await expect(addRosterPlayerForApp('team-1', { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] }, {
            name: 'Pat Star',
            rosterFieldValues: {}
        })).rejects.toThrow('Grad Year is required.');

        expect(addPlayer).not.toHaveBeenCalled();
        expect(uploadPlayerPhoto).not.toHaveBeenCalled();
    });

    it('treats accepted roster invites as linked when legacy parent scope is stored in parentPlayerKeys', () => {
        const summaries = buildRosterParentInviteSummaries({
            teamId: 'team-1',
            players: [
                { id: 'player-1', name: 'Pat Star' },
                { id: 'player-2', name: 'Sam Wing' }
            ],
            pendingParentInvites: [
                { playerId: 'player-1', code: 'PENDING1', type: 'parent_invite', used: false }
            ],
            confirmedTeamMembers: [
                {
                    id: 'parent-1',
                    parentPlayerKeys: ['team-1::player-1']
                },
                {
                    id: 'parent-2',
                    parentOf: [{ teamId: 'team-1', playerId: 'player-2' }],
                    parentTeamIds: ['team-1'],
                    parentPlayerKeys: ['team-1::player-2']
                }
            ]
        });

        expect(summaries).toEqual([
            {
                playerId: 'player-1',
                status: 'accepted',
                acceptedParentCount: 1,
                pendingInviteCount: 1,
                latestPendingCode: 'PENDING1'
            },
            {
                playerId: 'player-2',
                status: 'accepted',
                acceptedParentCount: 1,
                pendingInviteCount: 0,
                latestPendingCode: ''
            }
        ]);
    });

    it('wraps scorekeeper and roster active-state mutations with app validation', async () => {
        grantScorekeeperAccess.mockResolvedValue(undefined);
        revokeScorekeeperAccess.mockResolvedValue(undefined);
        grantVideographerAccess.mockResolvedValue(undefined);
        revokeVideographerAccess.mockResolvedValue(undefined);
        deactivatePlayer.mockResolvedValue(undefined);
        reactivatePlayer.mockResolvedValue(undefined);

        await grantScorekeeperAccessForApp(' team-1 ', ' member-1 ');
        await revokeScorekeeperAccessForApp('team-1', 'member-1');
        await grantVideographerAccessForApp(' team-1 ', ' member-2 ');
        await revokeVideographerAccessForApp('team-1', 'member-2');
        await deactivateRosterPlayerForApp(' team-1 ', ' player-1 ');
        await reactivateRosterPlayerForApp('team-1', 'player-1');

        expect(grantScorekeeperAccess).toHaveBeenCalledWith('team-1', 'member-1');
        expect(revokeScorekeeperAccess).toHaveBeenCalledWith('team-1', 'member-1');
        expect(grantVideographerAccess).toHaveBeenCalledWith('team-1', 'member-2');
        expect(revokeVideographerAccess).toHaveBeenCalledWith('team-1', 'member-2');
        expect(deactivatePlayer).toHaveBeenCalledWith('team-1', 'player-1');
        expect(reactivatePlayer).toHaveBeenCalledWith('team-1', 'player-1');

        grantScorekeeperAccess.mockClear();
        grantVideographerAccess.mockClear();
        deactivatePlayer.mockClear();
        reactivatePlayer.mockClear();
        await expect(grantScorekeeperAccessForApp('', 'member-1')).rejects.toThrow('Team ID is required.');
        await expect(grantScorekeeperAccessForApp('team-1', '')).rejects.toThrow('Team member user ID is required.');
        await expect(grantVideographerAccessForApp('', 'member-1')).rejects.toThrow('Team ID is required.');
        await expect(grantVideographerAccessForApp('team-1', '')).rejects.toThrow('Team member user ID is required.');
        await expect(deactivateRosterPlayerForApp('', 'player-1')).rejects.toThrow('Team ID is required.');
        await expect(reactivateRosterPlayerForApp('team-1', '')).rejects.toThrow('Player ID is required.');
        expect(grantScorekeeperAccess).not.toHaveBeenCalled();
        expect(grantVideographerAccess).not.toHaveBeenCalled();
        expect(deactivatePlayer).not.toHaveBeenCalled();
        expect(reactivatePlayer).not.toHaveBeenCalled();
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
                { id: 'player-2', name: 'Sam Wing', number: '12' },
                { id: 'player-3', name: 'Taylor Bench', number: '22', active: false }
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
        expect(model.team.isPublic).toBe(true);
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
        expect(model.players.map((player) => player.id)).toEqual(['player-1', 'player-2']);
        expect(model.inactivePlayers).toEqual([
            expect.objectContaining({ id: 'player-3', active: false, name: 'Taylor Bench' })
        ]);
        expect(model.linkedPlayers.map((player) => player.id)).toEqual(['player-1']);
        expect(model.record).toMatchObject({ wins: 1, losses: 0, ties: 0, gamesPlayed: 1 });
        expect(model.upcomingEvents.map((event) => event.id)).toEqual(['game-1', 'practice-1']);
        expect(model.upcomingEvents[0]).toMatchObject({ shareable: true, isPrivate: false, publicCalendar: false, liveStatus: '', statTrackerConfigLabel: 'No config assigned', statTrackerConfigExists: false });
        expect(model.standings.currentRow.record).toBe('1-0');
        expect(model.leaderboards[0].leaders[0]).toMatchObject({ playerId: 'player-1', formattedValue: '88' });
        expect(model.trackingSummaries[0].items[0]).toMatchObject({ title: 'Bring ball', isComplete: true });
        expect(model.sponsors[0].imageUrl).toBe('https://img.example.test/pizza.png');
        expect(model.statTrackerConfigs).toEqual([
            expect.objectContaining({
                id: 'basketball',
                name: 'Basketball',
                baseType: 'Custom',
                isBasketball: false,
                columnCount: 1,
                columnNames: ['pts'],
                assignedUpcomingGames: []
            })
        ]);
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

    it('builds read-only stat tracker config summaries for migrated and legacy shapes', () => {
        const model = buildTeamDetailModel({
            teamId: 'team-1',
            team: {
                name: 'Bears',
                sport: 'Basketball',
                ownerId: 'coach-1',
                adminEmails: ['coach@example.com']
            },
            games: [
                { id: 'game-1', opponent: 'Falcons', date: new Date('2100-06-01T18:00:00Z'), status: 'scheduled', statTrackerConfigId: 'cfg-basketball' },
                { id: 'game-2', opponent: 'Tigers', date: new Date('2100-06-02T18:00:00Z'), status: 'scheduled', statTrackerConfigId: 'cfg-legacy' },
                { id: 'game-3', opponent: 'Orphans', date: new Date('2100-06-03T18:00:00Z'), status: 'scheduled', statTrackerConfigId: 'cfg-missing' },
                { id: 'stale-game', opponent: 'Past Tigers', date: new Date('2020-06-02T18:00:00Z'), status: 'scheduled', statTrackerConfigId: 'cfg-legacy' }
            ],
            configs: [
                {
                    id: 'cfg-basketball',
                    name: 'Varsity Basketball',
                    baseType: 'Basketball',
                    columns: ['PTS', 'REB', 'AST']
                },
                {
                    id: 'cfg-legacy',
                    name: 'Legacy Soccer',
                    baseType: 'Soccer',
                    columns: [
                        { label: 'Goals', acronym: 'GOALS' },
                        { name: 'Shots', key: 'SHOTS' }
                    ],
                    statDefinitions: [
                        { id: 'goals', label: 'Goals', acronym: 'GOALS' },
                        { id: 'shots', label: 'Shots', acronym: 'SHOTS' },
                        { id: 'shotpct', label: 'Shot%', acronym: 'Shot%', formula: '(GOALS/SHOTS)*100' }
                    ]
                }
            ],
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] }
        });

        expect(model.statTrackerConfigs).toEqual([
            expect.objectContaining({
                id: 'cfg-legacy',
                name: 'Legacy Soccer',
                baseType: 'Soccer',
                isBasketball: false,
                columnCount: 2,
                columnNames: ['GOALS', 'SHOTS'],
                assignedUpcomingGames: [
                    expect.objectContaining({ gameId: 'game-2', title: 'vs. Tigers' })
                ]
            }),
            expect.objectContaining({
                id: 'cfg-basketball',
                name: 'Varsity Basketball',
                baseType: 'Basketball',
                isBasketball: true,
                columnCount: 3,
                columnNames: ['PTS', 'REB', 'AST'],
                assignedUpcomingGames: [
                    expect.objectContaining({ gameId: 'game-1', title: 'vs. Falcons' })
                ]
            })
        ]);
        expect(model.statTrackerConfigs.find((config) => config.id === 'cfg-legacy').assignedUpcomingGames)
            .toEqual([expect.objectContaining({ gameId: 'game-2', title: 'vs. Tigers' })]);
        expect(model.upcomingEvents.find((event) => event.id === 'game-1')).toMatchObject({
            statTrackerConfigId: 'cfg-basketball',
            statTrackerConfigLabel: 'Varsity Basketball',
            statTrackerConfigExists: true,
            statTrackerConfigIsBasketball: true
        });
        expect(model.upcomingEvents.find((event) => event.id === 'game-3')).toMatchObject({
            statTrackerConfigId: 'cfg-missing',
            statTrackerConfigLabel: 'Missing config (cfg-missing)',
            statTrackerConfigExists: false,
            statTrackerConfigIsBasketball: false
        });
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

    it('skips leaderboards and trackingSummaries when includeInsights is false', () => {
        const teamBase = {
            teamId: 'team-1',
            team: { name: 'Bears', sport: 'Basketball' },
            players: [
                { id: 'player-1', name: 'Pat Star', number: '9' },
                { id: 'player-2', name: 'Sam Wing', number: '12' }
            ],
            configs: [{
                id: 'basketball',
                name: 'Basketball',
                columns: ['pts'],
                statDefinitions: [{ id: 'pts', label: 'Points', acronym: 'PTS', topStat: true, visibility: 'public', scope: 'player' }]
            }],
            seasonStatsByPlayerId: {
                'player-1': { pts: 88 },
                'player-2': { pts: 31 }
            },
            trackingItems: [{ id: 'item-1', title: 'Bring ball', public: true }],
            trackingStatuses: [{ itemId: 'item-1', playerId: 'player-1', status: 'complete', public: true }],
            user: { uid: 'user-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'], parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] }
        };

        const deferredModel = buildTeamDetailModel({ ...teamBase, includeInsights: false });
        expect(deferredModel.leaderboards).toEqual([]);
        expect(deferredModel.trackingSummaries).toEqual([]);

        const fullModel = buildTeamDetailModel({ ...teamBase, includeInsights: true });
        expect(fullModel.leaderboards.length).toBeGreaterThan(0);
        expect(fullModel.leaderboards[0].leaders[0]).toMatchObject({ playerId: 'player-1', formattedValue: '88' });
        expect(fullModel.trackingSummaries[0].items[0]).toMatchObject({ title: 'Bring ball', isComplete: true });

        const defaultModel = buildTeamDetailModel({ ...teamBase });
        expect(defaultModel.leaderboards.length).toBeGreaterThan(0);
        expect(defaultModel.trackingSummaries.length).toBeGreaterThan(0);
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
        expect(getDocs).toHaveBeenCalledWith([
            { db: {}, name: 'accessCodes' },
            { field: 'teamId', op: '==', value: 'team-1' }
        ]);

        getDocs.mockClear();
        getAllUsers.mockClear();
        const parentStaffPermissions = await loadTeamStaffPermissions('team-1', { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'] });
        expect(parentStaffPermissions).toBeNull();
        expect(getDocs).not.toHaveBeenCalled();
        expect(getAllUsers).not.toHaveBeenCalled();
    });

    it('updates only the managed basic team settings fields for app editing', async () => {
        getTeam.mockResolvedValue({
            id: 'team-1',
            ownerId: 'owner-1',
            name: 'Bears',
            sport: 'Basketball',
            zip: '66210',
            photoUrl: 'https://img.example.test/existing.png',
            isPublic: true,
            adminEmails: ['coach@example.com'],
            leagueUrl: 'https://league.example.test',
            colors: { primary: '#111111' }
        });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);
        updateTeam.mockResolvedValue(undefined);
        uploadTeamPhoto.mockResolvedValue('https://img.example.test/updated.png');

        const photoFile = new File(['abc'], 'team.png', { type: 'image/png' });
        await updateTeamSettingsForApp(' team-1 ', { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] }, {
            name: '  Lady Bears  ',
            sport: ' Soccer ',
            zip: '66210-1234',
            isPublic: false,
            photoFile
        });

        expect(uploadTeamPhoto).toHaveBeenCalledWith(photoFile);
        expect(updateTeam).toHaveBeenCalledWith('team-1', {
            name: 'Lady Bears',
            sport: 'Soccer',
            zip: '662101234',
            isPublic: false,
            photoUrl: 'https://img.example.test/updated.png',
            updatedAt: expect.any(Date)
        });
    });

    it('rejects empty team names and non-staff team setting edits', async () => {
        getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'], photoUrl: 'https://img.example.test/existing.png' });
        getPlayers.mockResolvedValue([]);
        getGames.mockResolvedValue([]);
        getConfigs.mockResolvedValue([]);

        await expect(updateTeamSettingsForApp('team-1', { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] }, {
            name: '   ',
            sport: 'Soccer',
            zip: '12345',
            isPublic: true
        })).rejects.toThrow('Team name is required.');
        expect(updateTeam).not.toHaveBeenCalled();

        await expect(updateTeamSettingsForApp('team-1', { uid: 'parent-1', email: 'parent@example.com', roles: ['parent'] }, {
            name: 'Bears',
            sport: 'Soccer',
            zip: '12345',
            isPublic: true
        })).rejects.toThrow('You do not have permission to edit this team.');
    });
});
