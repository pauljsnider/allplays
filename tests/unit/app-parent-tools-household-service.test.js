import { beforeEach, describe, expect, it, vi } from 'vitest';

const familyPlanMocks = vi.hoisted(() => ({
    addPendingFamilyMember: vi.fn(),
    readFamilyMembers: vi.fn()
}));

const dbMocks = vi.hoisted(() => ({
    moveTeamMediaItems: vi.fn(),
    setTeamMediaAlbumCover: vi.fn()
}));

vi.mock('../../js/family-plan.js', () => familyPlanMocks);
vi.mock('../../js/db.js', () => ({
    createFamilyShareToken: vi.fn(),
    createParentMembershipRequest: vi.fn(),
    createRegistrationCheckoutSession: vi.fn(),
    createTeamMediaLink: vi.fn(),
    getPlayers: vi.fn(),
    getTeam: vi.fn(),
    getTeamMediaFolders: vi.fn(),
    getTeamMediaItems: vi.fn(),
    getTeams: vi.fn(),
    canAccessTeamChat: vi.fn(() => false),
    listCertificatesForPlayer: vi.fn(),
    listFamilyShareTokens: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    listParentTeamFeeRecipients: vi.fn(),
    listTeamRegistrationForms: vi.fn(),
    revokeFamilyShareToken: vi.fn(),
    updateFamilyShareTokenCalendars: vi.fn(),
    uploadTeamMediaFile: vi.fn(),
    uploadTeamMediaPhoto: vi.fn(),
    deleteTeamMediaItem: vi.fn(),
    updateTeamMediaItem: vi.fn(),
    moveTeamMediaItems: dbMocks.moveTeamMediaItems,
    setTeamMediaAlbumCover: dbMocks.setTeamMediaAlbumCover
}));
vi.mock('../../js/firebase.js?v=18', () => ({
    db: {},
    doc: vi.fn(),
    collection: vi.fn(),
    serverTimestamp: vi.fn(),
    runTransaction: vi.fn()
}));
vi.mock('../../js/parent-dashboard-fees.js', () => ({
    formatParentFeeAmount: vi.fn(),
    formatParentFeeDueDate: vi.fn(),
    getParentFeeStatusMeta: vi.fn(),
    normalizeParentFeeRecord: vi.fn((record) => record),
    sortParentFeeRecords: vi.fn((records) => records)
}));
vi.mock('../../js/stripe-service.js', () => ({ initiateTeamFeeCheckout: vi.fn() }));
vi.mock('../../js/registration-flow.js', () => ({
    buildPendingRegistrationRecord: vi.fn(),
    calculateRegistrationFeeSnapshot: vi.fn(),
    decideRegistrationPlacement: vi.fn(),
    getActiveRegistrationOptions: vi.fn(() => []),
    getPaymentPlanChoices: vi.fn(() => []),
    getRegistrationPaymentNotice: vi.fn(() => ''),
    hasOnlineRegistrationCheckout: vi.fn(() => false),
    normalizeRegistrationForm: vi.fn((form) => form),
    requiresRegistrationOption: vi.fn(() => false)
}));
vi.mock('../../js/team-media-utils.js', () => ({
    canContributeTeamMedia: vi.fn(() => false),
    canManageTeamMedia: vi.fn(() => false),
    canReadTeamMediaAlbum: vi.fn(() => true),
    getTeamMediaItemUrl: vi.fn(() => ''),
    isSafeTeamMediaUrl: vi.fn(() => true),
    sortByMediaOrder: vi.fn((items) => items)
}));
vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    firebaseAuth: { currentUser: null },
    getNativeAuthIdToken: vi.fn()
}));
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => ({ loadParentSchedule: vi.fn() }));

import {
    createParentHouseholdMemberInvite,
    loadParentHouseholdInviteModel,
    moveTeamMediaItemForApp,
    setTeamMediaAlbumCoverForApp
} from '../../apps/app/src/lib/parentToolsService.ts';

const user = {
    uid: 'user-1',
    parentOf: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9' }]
};

beforeEach(() => {
    vi.clearAllMocks();
    familyPlanMocks.readFamilyMembers.mockResolvedValue([]);
    familyPlanMocks.addPendingFamilyMember.mockResolvedValue({ code: 'HOME1234', inviteUrl: 'accept-invite.html?code=HOME1234' });
    dbMocks.moveTeamMediaItems.mockResolvedValue(undefined);
    dbMocks.setTeamMediaAlbumCover.mockResolvedValue(undefined);
});

describe('Parent Tools household invite service', () => {
    it('loads linked players and pending family memberships for the signed-in parent', async () => {
        familyPlanMocks.readFamilyMembers.mockResolvedValueOnce([{ id: 'member-1', email: 'home@example.com', status: 'pending', inviteUrl: 'accept-invite.html?code=HOME1234' }]);

        const model = await loadParentHouseholdInviteModel(user);

        expect(model.linkedPlayers).toEqual([expect.objectContaining({ teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star' })]);
        expect(familyPlanMocks.readFamilyMembers).toHaveBeenCalledWith('user-1');
        expect(model.members[0].inviteUrl).toBe('https://allplays.ai/accept-invite.html?code=HOME1234');
    });

    it('validates required fields before creating a household member invite', async () => {
        await expect(createParentHouseholdMemberInvite(null, { playerKey: 'team-1::player-1', email: 'home@example.com', relation: 'Guardian' })).rejects.toThrow('Sign in');
        await expect(createParentHouseholdMemberInvite(user, { playerKey: '', email: 'home@example.com', relation: 'Guardian' })).rejects.toThrow('Choose a linked player');
        await expect(createParentHouseholdMemberInvite(user, { playerKey: 'team-1::player-1', email: 'bad-email', relation: 'Guardian' })).rejects.toThrow('valid email');
        await expect(createParentHouseholdMemberInvite(user, { playerKey: 'team-1::player-1', email: 'home@example.com', relation: '' })).rejects.toThrow('relation');
        expect(familyPlanMocks.addPendingFamilyMember).not.toHaveBeenCalled();
    });

    it('calls the legacy family plan creator with the selected linked player fields', async () => {
        familyPlanMocks.readFamilyMembers.mockResolvedValueOnce([{ id: 'member-1', email: 'old@example.com', status: 'pending' }]);

        const result = await createParentHouseholdMemberInvite(user, {
            playerKey: 'team-1::player-1',
            email: ' HOME@EXAMPLE.COM ',
            displayName: ' Home Contact ',
            relation: ' Guardian '
        });

        expect(familyPlanMocks.addPendingFamilyMember).toHaveBeenCalledWith('user-1', expect.objectContaining({
            email: 'home@example.com',
            displayName: 'Home Contact',
            relation: 'Guardian',
            teamId: 'team-1',
            teamName: 'Bears',
            playerId: 'player-1',
            playerName: 'Pat Star',
            playerNumber: '9'
        }), { existingMembers: [{ id: 'member-1', email: 'old@example.com', status: 'pending' }] });
        expect(result).toEqual({ code: 'HOME1234', inviteUrl: 'https://allplays.ai/accept-invite.html?code=HOME1234' });
    });
});


describe('React app team media move service', () => {
    it('moves one media item through the legacy move helper', async () => {
        await moveTeamMediaItemForApp('team-1', 'item-1', 'folder-2');

        expect(dbMocks.moveTeamMediaItems).toHaveBeenCalledWith('team-1', ['item-1'], 'folder-2');
    });

    it('rejects missing move identifiers before calling the legacy helper', async () => {
        await expect(moveTeamMediaItemForApp('', 'item-1', 'folder-2')).rejects.toThrow('Missing team, media item, or destination album ID.');
        await expect(moveTeamMediaItemForApp('team-1', '', 'folder-2')).rejects.toThrow('Missing team, media item, or destination album ID.');
        await expect(moveTeamMediaItemForApp('team-1', 'item-1', '')).rejects.toThrow('Missing team, media item, or destination album ID.');
        expect(dbMocks.moveTeamMediaItems).not.toHaveBeenCalled();
    });
});

describe('React app team media cover service', () => {
    it('persists a selected photo through the legacy album cover helper', async () => {
        const item = { id: 'item-1', title: 'Bench celebration', type: 'photo', url: 'https://example.test/bench.jpg' };

        await setTeamMediaAlbumCoverForApp('team-1', 'folder-2', item);

        expect(dbMocks.setTeamMediaAlbumCover).toHaveBeenCalledWith('team-1', 'folder-2', item);
    });

    it('rejects missing cover identifiers before calling the legacy helper', async () => {
        const item = { id: 'item-1', type: 'photo', url: 'https://example.test/bench.jpg' };

        await expect(setTeamMediaAlbumCoverForApp('', 'folder-2', item)).rejects.toThrow('Choose a photo to use as the album cover.');
        await expect(setTeamMediaAlbumCoverForApp('team-1', '', item)).rejects.toThrow('Choose a photo to use as the album cover.');
        await expect(setTeamMediaAlbumCoverForApp('team-1', 'folder-2', { ...item, id: '' })).rejects.toThrow('Choose a photo to use as the album cover.');
        expect(dbMocks.setTeamMediaAlbumCover).not.toHaveBeenCalled();
    });
});
