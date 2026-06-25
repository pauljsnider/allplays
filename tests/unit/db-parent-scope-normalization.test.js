import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
    const start = dbSource.indexOf(`export async function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = dbSource.indexOf('\nexport async function ', start + 1);
    const nextImport = dbSource.indexOf('\nimport ', start + 1);
    const candidates = [nextExport, nextImport].filter((value) => value !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : dbSource.length;
    return dbSource.slice(start, end);
}

function buildNormalizeParentScopeLinks({ getTeam, getDoc, doc, db, isTeamActive }) {
    const functionSource = getFunctionSource('normalizeParentScopeLinks')
        .replace('export async function normalizeParentScopeLinks', 'return async function normalizeParentScopeLinks');

    return new Function('getTeam', 'getDoc', 'doc', 'db', 'isTeamActive', functionSource)(
        getTeam,
        getDoc,
        doc,
        db,
        isTeamActive
    );
}

function buildGetParentDashboardData({
    getUserProfile,
    updateUserProfile,
    listParentRegistrationApplicationsForProfile,
    normalizeParentScopeLinks,
    getTeam,
    getEvents
}) {
    const functionSource = getFunctionSource('getParentDashboardData')
        .replace('export async function getParentDashboardData', 'return async function getParentDashboardData');

    return new Function(
        'getUserProfile',
        'updateUserProfile',
        'listParentRegistrationApplicationsForProfile',
        'normalizeParentScopeLinks',
        'getTeam',
        'getEvents',
        functionSource
    )(
        getUserProfile,
        updateUserProfile,
        listParentRegistrationApplicationsForProfile,
        normalizeParentScopeLinks,
        getTeam,
        getEvents
    );
}

function makeSnap(id, data) {
    return {
        id,
        exists: () => data !== null,
        data: () => data
    };
}

describe('parent scope normalization', () => {
    it('keeps inactive players out of team-wide parent scope while preserving player-scoped access keys', async () => {
        const getTeam = vi.fn(async (teamId) => ({
            'team-active': { id: 'team-active', name: 'Active Team', active: true },
            'team-inactive': { id: 'team-inactive', name: 'Inactive Team', active: false },
            'team-missing-player': { id: 'team-missing-player', name: 'Missing Player Team', active: true },
            'team-inactive-player': { id: 'team-inactive-player', name: 'Inactive Player Team', active: true }
        }[teamId] || null));
        const getDoc = vi.fn(async (ref) => ({
            'teams/team-active/players/player-active': makeSnap('player-active', { name: 'Avery Lee', number: '9', active: true }),
            'teams/team-missing-player/players/player-missing': makeSnap('player-missing', null),
            'teams/team-inactive-player/players/player-inactive': makeSnap('player-inactive', { name: 'Casey Drew', active: false })
        }[ref.path] || makeSnap('missing', null)));
        const doc = vi.fn((_db, collectionPath, playerId) => ({ path: `${collectionPath}/${playerId}` }));
        const normalizeParentScopeLinks = buildNormalizeParentScopeLinks({
            getTeam,
            getDoc,
            doc,
            db: {},
            isTeamActive: (team) => team?.active !== false
        });

        const result = await normalizeParentScopeLinks([
            { teamId: 'team-active', playerId: 'player-active', playerName: 'Old Name' },
            { teamId: 'team-inactive', playerId: 'player-stale' },
            { teamId: 'team-missing-player', playerId: 'player-missing' },
            { teamId: 'team-inactive-player', playerId: 'player-inactive' },
            { teamId: 'team-active', playerId: 'player-active', playerName: 'Duplicate' }
        ]);

        expect(result).toEqual({
            activeLinks: [
                {
                    teamId: 'team-active',
                    playerId: 'player-active',
                    teamName: 'Active Team',
                    playerName: 'Avery Lee',
                    playerNumber: '9',
                    playerPhotoUrl: null
                }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-active', 'team-inactive-player::player-inactive'],
            blockedLinkCount: 0,
            staleLinkCount: 2
        });
    });

    it('preserves legacy parent links when roster reads are blocked during key repair', async () => {
        const getTeam = vi.fn(async (teamId) => ({
            'team-active': { id: 'team-active', name: 'Active Team', active: true }
        }[teamId] || null));
        const getDoc = vi.fn(async (ref) => {
            if (ref.path === 'teams/team-active/players/player-blocked') {
                const error = new Error('blocked');
                error.code = 'permission-denied';
                throw error;
            }
            return makeSnap('missing', null);
        });
        const doc = vi.fn((_db, collectionPath, playerId) => ({ path: `${collectionPath}/${playerId}` }));
        const normalizeParentScopeLinks = buildNormalizeParentScopeLinks({
            getTeam,
            getDoc,
            doc,
            db: {},
            isTeamActive: (team) => team?.active !== false
        });

        const result = await normalizeParentScopeLinks([
            {
                teamId: 'team-active',
                playerId: 'player-blocked',
                teamName: 'Legacy Team',
                playerName: 'Legacy Player',
                playerNumber: '12',
                playerPhotoUrl: 'https://example.com/player.png'
            }
        ]);

        expect(result).toEqual({
            activeLinks: [
                {
                    teamId: 'team-active',
                    playerId: 'player-blocked',
                    teamName: 'Active Team',
                    playerName: 'Legacy Player',
                    playerNumber: '12',
                    playerPhotoUrl: 'https://example.com/player.png'
                }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-blocked'],
            blockedLinkCount: 1,
            staleLinkCount: 0
        });
    });

    it('backfills cleaned parent access scope fields instead of raw parentOf links', async () => {
        const getUserProfile = vi.fn().mockResolvedValue({
            parentOf: [
                { teamId: 'team-active', playerId: 'player-active', teamName: 'Old Team', playerName: 'Old Name' },
                { teamId: 'team-inactive', playerId: 'player-stale' }
            ],
            parentTeamIds: ['team-active', 'team-inactive'],
            parentPlayerKeys: ['team-active::player-active', 'team-inactive::player-stale']
        });
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const listParentRegistrationApplicationsForProfile = vi.fn().mockResolvedValue([]);
        const normalizeParentScopeLinks = vi.fn().mockResolvedValue({
            activeLinks: [
                {
                    teamId: 'team-active',
                    playerId: 'player-active',
                    teamName: 'Active Team',
                    playerName: 'Avery Lee',
                    playerNumber: '9',
                    playerPhotoUrl: null
                }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-active'],
            blockedLinkCount: 0,
            staleLinkCount: 1
        });
        const getTeam = vi.fn().mockResolvedValue({ id: 'team-active', name: 'Active Team', active: true });
        const getEvents = vi.fn().mockResolvedValue([]);
        const getParentDashboardData = buildGetParentDashboardData({
            getUserProfile,
            updateUserProfile,
            listParentRegistrationApplicationsForProfile,
            normalizeParentScopeLinks,
            getTeam,
            getEvents
        });

        const result = await getParentDashboardData('parent-1');

        expect(normalizeParentScopeLinks).toHaveBeenCalledWith([
            { teamId: 'team-active', playerId: 'player-active', teamName: 'Old Team', playerName: 'Old Name' },
            { teamId: 'team-inactive', playerId: 'player-stale' }
        ]);
        expect(updateUserProfile).toHaveBeenCalledWith('parent-1', {
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-active']
        });
        expect(result.children).toEqual([
            {
                teamId: 'team-active',
                playerId: 'player-active',
                teamName: 'Active Team',
                playerName: 'Avery Lee',
                playerNumber: '9',
                playerPhotoUrl: null
            }
        ]);
        expect(result.dashboardState).toEqual({
            kind: 'ready',
            blockedLinkCount: 0,
            staleLinkCount: 1,
            teamEventErrors: 0
        });
    });

    it('keeps player cards visible when team event reads fail during parent access repair', async () => {
        const getUserProfile = vi.fn().mockResolvedValue({
            parentOf: [
                { teamId: 'team-active', playerId: 'player-active', teamName: 'Active Team', playerName: 'Avery Lee' }
            ],
            parentTeamIds: [],
            parentPlayerKeys: []
        });
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const listParentRegistrationApplicationsForProfile = vi.fn().mockResolvedValue([]);
        const normalizeParentScopeLinks = vi.fn().mockResolvedValue({
            activeLinks: [
                {
                    teamId: 'team-active',
                    playerId: 'player-active',
                    teamName: 'Active Team',
                    playerName: 'Avery Lee',
                    playerNumber: '9',
                    playerPhotoUrl: null
                }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-active'],
            blockedLinkCount: 1,
            staleLinkCount: 0
        });
        const getEvents = vi.fn(async () => {
            const error = new Error('blocked');
            error.code = 'permission-denied';
            throw error;
        });
        const getParentDashboardData = buildGetParentDashboardData({
            getUserProfile,
            updateUserProfile,
            listParentRegistrationApplicationsForProfile,
            normalizeParentScopeLinks,
            getTeam: vi.fn(),
            getEvents
        });

        const result = await getParentDashboardData('parent-1');

        expect(result.children).toEqual([
            {
                teamId: 'team-active',
                playerId: 'player-active',
                teamName: 'Active Team',
                playerName: 'Avery Lee',
                playerNumber: '9',
                playerPhotoUrl: null
            }
        ]);
        expect(result.upcomingGames).toEqual([]);
        expect(result.dashboardState).toEqual({
            kind: 'degraded',
            blockedLinkCount: 1,
            staleLinkCount: 0,
            teamEventErrors: 1
        });
    });

    it('keeps players visible when the registration applications query fails (missing index)', async () => {
        const getUserProfile = vi.fn().mockResolvedValue({
            parentOf: [
                { teamId: 'team-active', playerId: 'player-active', teamName: 'Active Team', playerName: 'Avery Lee' }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-active']
        });
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        // Simulate the Firestore "missing COLLECTION_GROUP index" failure.
        const indexError = new Error('The query requires a COLLECTION_GROUP_ASC index for collection registrations and field guardian.email');
        indexError.code = 'failed-precondition';
        const listParentRegistrationApplicationsForProfile = vi.fn().mockRejectedValue(indexError);
        const normalizeParentScopeLinks = vi.fn().mockResolvedValue({
            activeLinks: [
                {
                    teamId: 'team-active',
                    playerId: 'player-active',
                    teamName: 'Active Team',
                    playerName: 'Avery Lee',
                    playerNumber: '9',
                    playerPhotoUrl: null
                }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-active'],
            blockedLinkCount: 0,
            staleLinkCount: 0
        });
        const getParentDashboardData = buildGetParentDashboardData({
            getUserProfile,
            updateUserProfile,
            listParentRegistrationApplicationsForProfile,
            normalizeParentScopeLinks,
            getTeam: vi.fn().mockResolvedValue({ id: 'team-active', name: 'Active Team', active: true }),
            getEvents: vi.fn().mockResolvedValue([])
        });

        // Must not throw, and the player must still be returned.
        const result = await getParentDashboardData('parent-1');

        expect(listParentRegistrationApplicationsForProfile).toHaveBeenCalled();
        expect(result.registrationApplications).toEqual([]);
        expect(result.children).toEqual([
            {
                teamId: 'team-active',
                playerId: 'player-active',
                teamName: 'Active Team',
                playerName: 'Avery Lee',
                playerNumber: '9',
                playerPhotoUrl: null
            }
        ]);
    });
});
