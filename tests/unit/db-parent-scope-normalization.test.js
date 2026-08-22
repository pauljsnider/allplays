import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveCanonicalParentScopeInput } from '../../js/parent-membership-utils.js';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function getFunctionSource(functionName, source = dbSource) {
    const asyncSignature = `export async function ${functionName}`;
    const syncSignature = `export function ${functionName}`;
    const start = Math.max(source.indexOf(asyncSignature), source.indexOf(syncSignature));
    expect(start).toBeGreaterThanOrEqual(0);
    const nextAsyncExport = source.indexOf('\nexport async function ', start + 1);
    const nextSyncExport = source.indexOf('\nexport function ', start + 1);
    const nextImport = source.indexOf('\nimport ', start + 1);
    const candidates = [nextAsyncExport, nextSyncExport, nextImport].filter((value) => value !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
    return source.slice(start, end);
}

function buildNormalizeParentScopeLinks({ getTeam, getDoc, doc, db, isTeamActive }) {
    const normalizeFunctionSource = getFunctionSource('normalizeParentScopeLinks')
        .replace('export async function normalizeParentScopeLinks', 'return async function normalizeParentScopeLinks');

    return new Function('getTeam', 'getDoc', 'doc', 'db', 'isTeamActive', 'resolveCanonicalParentScopeInput', normalizeFunctionSource)(
        getTeam,
        getDoc,
        doc,
        db,
        isTeamActive,
        resolveCanonicalParentScopeInput
    );
}

function buildResolveCanonicalParentScopeInput() {
    return resolveCanonicalParentScopeInput;
}

function buildGetParentDashboardData({
    getUserProfile,
    updateUserProfile,
    listParentRegistrationApplicationsForProfile,
    listMyParentMembershipRequests = vi.fn().mockResolvedValue([]),
    mergeApprovedParentMembershipRequests = vi.fn((userProfile) => ({ changed: false, userUpdate: userProfile })),
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
        'listMyParentMembershipRequests',
        'mergeApprovedParentMembershipRequests',
        'normalizeParentScopeLinks',
        'getTeam',
        'getEvents',
        functionSource
    )(
        getUserProfile,
        updateUserProfile,
        listParentRegistrationApplicationsForProfile,
        listMyParentMembershipRequests,
        mergeApprovedParentMembershipRequests,
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
            hasCanonicalParentTeamIds: false,
            hasCanonicalParentPlayerKeys: false,
            blockedLinkCount: 0,
            staleLinkCount: 2
        });
    });

    it('resolves team and player reads concurrently instead of one link at a time', async () => {
        // Regression coverage for the dashboard load-performance fix: this used to
        // await each link's team, then that link's player, before moving to the
        // next link — serializing every parent's page load behind N round trips.
        let concurrentTeamReads = 0;
        let maxConcurrentTeamReads = 0;
        const getTeam = vi.fn((teamId) => new Promise((resolve) => {
            concurrentTeamReads += 1;
            maxConcurrentTeamReads = Math.max(maxConcurrentTeamReads, concurrentTeamReads);
            setTimeout(() => {
                concurrentTeamReads -= 1;
                resolve({ id: teamId, name: teamId, active: true });
            }, 0);
        }));

        let concurrentPlayerReads = 0;
        let maxConcurrentPlayerReads = 0;
        const getDoc = vi.fn((ref) => new Promise((resolve) => {
            concurrentPlayerReads += 1;
            maxConcurrentPlayerReads = Math.max(maxConcurrentPlayerReads, concurrentPlayerReads);
            setTimeout(() => {
                concurrentPlayerReads -= 1;
                resolve(makeSnap(ref.path, { name: 'Player', active: true }));
            }, 0);
        }));
        const doc = vi.fn((_db, collectionPath, playerId) => ({ path: `${collectionPath}/${playerId}` }));
        const normalizeParentScopeLinks = buildNormalizeParentScopeLinks({
            getTeam,
            getDoc,
            doc,
            db: {},
            isTeamActive: (team) => team?.active !== false
        });

        await normalizeParentScopeLinks([
            { teamId: 'team-a', playerId: 'player-a' },
            { teamId: 'team-b', playerId: 'player-b' },
            { teamId: 'team-c', playerId: 'player-c' }
        ]);

        expect(maxConcurrentTeamReads).toBe(3);
        expect(maxConcurrentPlayerReads).toBe(3);
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
            hasCanonicalParentTeamIds: false,
            hasCanonicalParentPlayerKeys: false,
            blockedLinkCount: 1,
            staleLinkCount: 0
        });
    });

    it('uses canonical player keys instead of restoring a revoked same-team sibling from parentOf', () => {
        const resolveCanonicalParentScopeInput = buildResolveCanonicalParentScopeInput();

        expect(resolveCanonicalParentScopeInput({
            parentOf: [
                { teamId: 'team-a', playerId: 'player-1', playerName: 'Current child' },
                { teamId: 'team-a', playerId: 'player-2', playerName: 'Revoked child' }
            ],
            parentTeamIds: ['team-a'],
            parentPlayerKeys: ['team-a::player-1']
        })).toEqual({
            parentLinks: [
                { teamId: 'team-a', playerId: 'player-1', playerName: 'Current child' }
            ],
            parentTeamIds: ['team-a'],
            parentPlayerKeys: ['team-a::player-1'],
            hasCanonicalParentTeamIds: true,
            hasCanonicalParentPlayerKeys: true
        });
    });

    it('treats present empty or malformed canonical scope fields as revocation', () => {
        const resolveCanonicalParentScopeInput = buildResolveCanonicalParentScopeInput();

        expect(resolveCanonicalParentScopeInput({
            parentOf: [{ teamId: 'team-a', playerId: 'player-1' }],
            parentTeamIds: null,
            parentPlayerKeys: { stale: true }
        })).toEqual({
            parentLinks: [],
            parentTeamIds: [],
            parentPlayerKeys: [],
            hasCanonicalParentTeamIds: true,
            hasCanonicalParentPlayerKeys: true
        });

        expect(resolveCanonicalParentScopeInput({
            parentOf: [{ teamId: '123', playerId: 'player-1' }],
            parentTeamIds: [123, { id: 'team-a' }],
            parentPlayerKeys: ['123::player-1::junk', 456]
        })).toEqual({
            parentLinks: [],
            parentTeamIds: [],
            parentPlayerKeys: [],
            hasCanonicalParentTeamIds: true,
            hasCanonicalParentPlayerKeys: true
        });
    });

    it('does not infer exact child links from team-only canonical evidence', () => {
        const resolveCanonicalParentScopeInput = buildResolveCanonicalParentScopeInput();

        expect(resolveCanonicalParentScopeInput({
            parentOf: [
                { teamId: 'team-a', playerId: 'player-current' },
                { teamId: 'team-a', playerId: 'player-revoked' }
            ],
            parentTeamIds: ['team-a']
        })).toEqual({
            parentLinks: [],
            parentTeamIds: ['team-a'],
            parentPlayerKeys: [],
            hasCanonicalParentTeamIds: true,
            hasCanonicalParentPlayerKeys: false
        });
    });

    it('derives exact links from player keys when the canonical team field is absent', () => {
        const resolveCanonicalParentScopeInput = buildResolveCanonicalParentScopeInput();

        expect(resolveCanonicalParentScopeInput({
            parentOf: [
                { teamId: 'team-a', playerId: 'player-current', playerName: 'Current' },
                { teamId: 'team-revoked', playerId: 'player-old' }
            ],
            parentPlayerKeys: ['team-a::player-current']
        })).toEqual({
            parentLinks: [
                { teamId: 'team-a', playerId: 'player-current', playerName: 'Current' }
            ],
            parentTeamIds: [],
            parentPlayerKeys: ['team-a::player-current'],
            hasCanonicalParentTeamIds: false,
            hasCanonicalParentPlayerKeys: true
        });
    });

    it('backfills cleaned parent access scope fields only for a legacy profile with missing canonical fields', async () => {
        const getUserProfile = vi.fn().mockResolvedValue({
            parentOf: [
                { teamId: 'team-active', playerId: 'player-active', teamName: 'Old Team', playerName: 'Old Name' },
                { teamId: 'team-inactive', playerId: 'player-stale' }
            ]
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
            hasCanonicalParentTeamIds: false,
            hasCanonicalParentPlayerKeys: false,
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

        expect(normalizeParentScopeLinks).toHaveBeenCalledWith({
            parentOf: [
                { teamId: 'team-active', playerId: 'player-active', teamName: 'Old Team', playerName: 'Old Name' },
                { teamId: 'team-inactive', playerId: 'player-stale' }
            ]
        });
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
            ]
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
            hasCanonicalParentTeamIds: false,
            hasCanonicalParentPlayerKeys: false,
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

    it('seals a team-only canonical profile with an empty player key field before returning no links', async () => {
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const normalizeParentScopeLinks = vi.fn().mockResolvedValue({
            activeLinks: [],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: [],
            hasCanonicalParentTeamIds: true,
            hasCanonicalParentPlayerKeys: false,
            blockedLinkCount: 0,
            staleLinkCount: 0
        });
        const getParentDashboardData = buildGetParentDashboardData({
            getUserProfile: vi.fn().mockResolvedValue({
                parentOf: [{ teamId: 'team-active', playerId: 'player-stale' }],
                parentTeamIds: ['team-active']
            }),
            updateUserProfile,
            listParentRegistrationApplicationsForProfile: vi.fn(),
            normalizeParentScopeLinks,
            getTeam: vi.fn(),
            getEvents: vi.fn()
        });

        await expect(getParentDashboardData('parent-1')).resolves.toMatchObject({
            children: [],
            upcomingGames: [],
            dashboardState: { kind: 'no-links' }
        });
        expect(updateUserProfile).toHaveBeenCalledWith('parent-1', {
            parentPlayerKeys: []
        });
    });

    it('syncs approved membership requests into the parent profile before loading the dashboard', async () => {
        const getUserProfile = vi.fn().mockResolvedValue({
            parentOf: [
                { teamId: 'team-active', playerId: 'player-existing', teamName: 'Active Team', playerName: 'Existing Child' }
            ]
        });
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const approvedRequests = [
            {
                status: 'approved',
                teamId: 'team-active',
                playerId: 'player-new',
                playerName: 'Avery Lee',
                playerNumber: '9',
                requesterUserId: 'parent-1',
                requesterEmail: 'parent@example.com'
            }
        ];
        const listMyParentMembershipRequests = vi.fn().mockResolvedValue(approvedRequests);
        const mergeApprovedParentMembershipRequests = vi.fn().mockReturnValue({
            changed: true,
            userUpdate: {
                parentOf: [
                    { teamId: 'team-active', playerId: 'player-existing', teamName: 'Active Team', playerName: 'Existing Child' },
                    { teamId: 'team-active', playerId: 'player-new', teamName: 'Active Team', playerName: 'Avery Lee', playerNumber: '9' }
                ],
                parentTeamIds: ['team-active'],
                parentPlayerKeys: ['team-active::player-existing', 'team-active::player-new']
            }
        });
        const normalizeParentScopeLinks = vi.fn().mockResolvedValue({
            activeLinks: [
                { teamId: 'team-active', playerId: 'player-existing', teamName: 'Active Team', playerName: 'Existing Child', playerNumber: '', playerPhotoUrl: null },
                { teamId: 'team-active', playerId: 'player-new', teamName: 'Active Team', playerName: 'Avery Lee', playerNumber: '9', playerPhotoUrl: null }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-existing', 'team-active::player-new'],
            hasCanonicalParentTeamIds: true,
            hasCanonicalParentPlayerKeys: true,
            blockedLinkCount: 0,
            staleLinkCount: 0
        });
        const getParentDashboardData = buildGetParentDashboardData({
            getUserProfile,
            updateUserProfile,
            listParentRegistrationApplicationsForProfile: vi.fn().mockResolvedValue([]),
            listMyParentMembershipRequests,
            mergeApprovedParentMembershipRequests,
            normalizeParentScopeLinks,
            getTeam: vi.fn().mockResolvedValue({ id: 'team-active', name: 'Active Team', active: true }),
            getEvents: vi.fn().mockResolvedValue([])
        });

        const result = await getParentDashboardData('parent-1');

        expect(listMyParentMembershipRequests).toHaveBeenCalledWith('parent-1');
        expect(mergeApprovedParentMembershipRequests).toHaveBeenCalledTimes(1);
        expect(updateUserProfile).toHaveBeenCalledWith('parent-1', {
            parentOf: [
                { teamId: 'team-active', playerId: 'player-existing', teamName: 'Active Team', playerName: 'Existing Child' },
                { teamId: 'team-active', playerId: 'player-new', teamName: 'Active Team', playerName: 'Avery Lee', playerNumber: '9' }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-existing', 'team-active::player-new']
        });
        expect(normalizeParentScopeLinks).toHaveBeenCalledWith({
            parentOf: [
                { teamId: 'team-active', playerId: 'player-existing', teamName: 'Active Team', playerName: 'Existing Child' },
                { teamId: 'team-active', playerId: 'player-new', teamName: 'Active Team', playerName: 'Avery Lee', playerNumber: '9' }
            ],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-existing', 'team-active::player-new']
        });
        expect(result.children).toHaveLength(2);
    });

    it('does not invoke registration history while loading dashboard players', async () => {
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
            hasCanonicalParentTeamIds: true,
            hasCanonicalParentPlayerKeys: true,
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

        expect(listParentRegistrationApplicationsForProfile).not.toHaveBeenCalled();
        expect(result).not.toHaveProperty('registrationApplications');
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
