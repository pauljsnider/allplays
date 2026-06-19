import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    addPendingHouseholdInvite,
    addPendingFamilyMember,
    buildFamilyPlanSectionMarkup,
    buildFamilyPlanMarkup,
    buildHouseholdInviteMarkup,
    canAddFamilyMember,
    getFamilySlotCounts,
    loadFamilyPlanState,
    normalizeHouseholdInvites,
    removeFamilyMember,
    removePendingHouseholdInvite,
    revokeHouseholdInvite
} from '../../js/family-plan.js';
import { normalizeFamilyShareCalendarUrls, normalizeFamilyShareChildren } from '../../js/family-share-utils.js';

function member(status, email = `${status}@example.com`) {
    return { id: email, email, status };
}

describe('family plan helpers', () => {
    it('counts only pending and active members against the four-slot limit', () => {
        const members = [
            member('active', 'one@example.com'),
            member('pending', 'two@example.com'),
            member('removed', 'old@example.com'),
            member('active', 'three@example.com'),
            member('pending', 'four@example.com'),
        ];

        expect(getFamilySlotCounts(members)).toEqual({ used: 4, remaining: 0, max: 4 });
        expect(canAddFamilyMember(members)).toBe(false);
    });

    it('renders the setup-only billing and premium activation notice without active entitlement', () => {
        const markup = buildFamilyPlanMarkup({
            entitlementState: 'locked',
            members: [
                member('active', 'active@example.com'),
                { ...member('pending', 'pending@example.com'), playerName: 'Sam', playerNumber: '12', teamName: 'Tigers', accessCode: 'HOME1234', inviteUrl: 'accept-invite.html?code=HOME1234' },
                member('removed', 'removed@example.com')
            ]
        });

        expect(markup).toContain('Family Plan');
        expect(markup).toContain('Billing and premium activation are not connected yet');
        expect(markup).toContain('active');
        expect(markup).toContain('pending');
        expect(markup).toContain('Invite code');
        expect(markup).toContain('HOME1234');
        expect(markup).toContain('Access: Sam #12, Tigers');
        expect(markup).toContain('removed');
    });

    it('blocks pending member writes when the four active-or-pending slots are full', async () => {
        await expect(addPendingFamilyMember('user-1', { email: 'new@example.com' }, {
            existingMembers: [member('active', 'one@example.com'), member('pending', 'two@example.com'), member('active', 'three@example.com'), member('pending', 'four@example.com')]
        })).rejects.toThrow('limited to 4');
    });

    it('rejects malformed pending member email addresses', async () => {
        await expect(addPendingFamilyMember('user-1', { email: 'invalid', teamId: 'team-1', playerId: 'player-1' }, {
            existingMembers: []
        })).rejects.toThrow('valid email');
    });

    it('writes a pending household invite and access code for an available slot', async () => {
        const addDoc = vi.fn()
            .mockResolvedValueOnce({ id: 'member-1' })
            .mockResolvedValueOnce({ id: 'code-1' });
        const updateDoc = vi.fn().mockResolvedValue();
        const firebase = {
            db: {},
            collection: vi.fn((_db, path) => ({ path })),
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            addDoc,
            updateDoc,
            Timestamp: { fromMillis: (value) => ({ millis: value }) },
            serverTimestamp: () => 'server-now'
        };

        const result = await addPendingFamilyMember('user-1', {
            email: ' NEW@EXAMPLE.COM ',
            displayName: ' New Person ',
            teamId: 'team-1',
            playerId: 'player-1',
            teamName: 'Tigers',
            playerName: 'Sam',
            playerNumber: '12',
            relation: 'Guardian'
        }, {
            deps: { firebase },
            existingMembers: []
        });

        expect(firebase.collection).toHaveBeenCalledWith({}, 'users/user-1/familyMemberships');
        expect(addDoc).toHaveBeenCalledWith({ path: 'users/user-1/familyMemberships' }, expect.objectContaining({
            email: 'new@example.com',
            displayName: 'New Person',
            status: 'pending',
            organizerUserId: 'user-1',
            teamId: 'team-1',
            playerId: 'player-1',
            relation: 'Guardian'
        }));
        expect(addDoc).toHaveBeenCalledWith({ path: 'accessCodes' }, expect.objectContaining({
            type: 'household_invite',
            email: 'new@example.com',
            organizerUserId: 'user-1',
            familyMembershipId: 'member-1',
            teamId: 'team-1',
            playerId: 'player-1',
            used: false,
            revoked: false
        }));
        expect(updateDoc).toHaveBeenCalledWith({ path: 'users/user-1/familyMemberships/member-1' }, expect.objectContaining({
            accessCodeId: 'code-1',
            inviteUrl: expect.stringContaining('accept-invite.html?code=')
        }));
        expect(result.inviteUrl).toContain('accept-invite.html?code=');
    });

    it('requires a selected player before creating a household invite', async () => {
        await expect(addPendingFamilyMember('user-1', { email: 'new@example.com' }, {
            existingMembers: []
        })).rejects.toThrow('Select the player access');
    });

    it('renders household invite form and pending invites scoped to linked players', () => {
        const markup = buildHouseholdInviteMarkup({
            linkedPlayers: [{ teamId: 'team-1', teamName: 'Tigers', playerId: 'player-1', playerName: 'Sam' }],
            invites: [{
                id: 'invite-1',
                contactName: 'Alex Contact',
                email: 'alex@example.com',
                relation: 'Grandparent',
                status: 'pending',
                playerId: 'player-1',
                playerName: 'Sam',
                teamId: 'team-1',
                teamName: 'Tigers',
                teamAccessIntent: true
            }]
        });

        expect(markup).toContain('Household player access');
        expect(markup).toContain('Sam');
        expect(markup).toContain('Tigers');
        expect(markup).toContain('Alex Contact');
        expect(markup).toContain('alex@example.com');
        expect(markup).toContain('Grandparent');
        expect(markup).toContain('pending');
        expect(markup).toContain('data-household-invite-revoke="invite-1"');
        expect(markup).toContain('Revoke access');
    });

    it('deletes the householdInvites document when revoking a pending invite', async () => {
        const deleteDoc = vi.fn().mockResolvedValue();
        const firebase = {
            db: {},
            doc: vi.fn((_db, path) => ({ path })),
            deleteDoc,
        };

        await removePendingHouseholdInvite('user-1', 'invite-1', { deps: { firebase } });

        expect(firebase.doc).toHaveBeenCalledWith({}, 'users/user-1/householdInvites/invite-1');
        expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/householdInvites/invite-1' });
    });

    it('normalizes household invite records without granting access fields', () => {
        expect(normalizeHouseholdInvites([{ id: 'invite-1', email: ' NEW@EXAMPLE.COM ', status: 'pending', teamAccessIntent: true, accessCodeId: 'code-1', inviteCode: 'home1234' }])).toEqual([
            expect.objectContaining({
                id: 'invite-1',
                email: 'new@example.com',
                status: 'pending',
                teamAccessIntent: true,
                accessCodeId: 'code-1',
                inviteCode: 'home1234'
            })
        ]);
    });

    it('rejects household invites for players outside the linked parent list', async () => {
        await expect(addPendingHouseholdInvite('user-1', {
            playerKey: 'team-2::player-2',
            contactName: 'Alex Contact',
            email: 'alex@example.com',
            relation: 'Grandparent'
        }, {
            linkedPlayers: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Sam' }]
        })).rejects.toThrow('already linked');
    });

    it('writes a pending household invite for a linked player only', async () => {
        const addDoc = vi.fn().mockResolvedValue({ id: 'invite-1' });
        const firebase = {
            db: {},
            collection: vi.fn((_db, path) => ({ path })),
            addDoc,
            serverTimestamp: () => 'server-now'
        };

        await addPendingHouseholdInvite('user-1', {
            playerKey: 'team-1::player-1',
            contactName: ' Alex Contact ',
            email: ' ALEX@EXAMPLE.COM ',
            relation: ' Grandparent ',
            teamAccessIntent: true
        }, {
            deps: { firebase },
            linkedPlayers: [{ teamId: 'team-1', teamName: 'Tigers', playerId: 'player-1', playerName: 'Sam' }]
        });

        expect(firebase.collection).toHaveBeenCalledWith({}, 'users/user-1/householdInvites');
        expect(addDoc).toHaveBeenCalledWith({ path: 'users/user-1/householdInvites' }, expect.objectContaining({
            contactName: 'Alex Contact',
            email: 'alex@example.com',
            relation: 'Grandparent',
            teamAccessIntent: true,
            status: 'pending',
            organizerUserId: 'user-1',
            playerId: 'player-1',
            playerName: 'Sam',
            teamId: 'team-1',
            teamName: 'Tigers',
            playerKey: 'team-1::player-1'
        }));
    });

    it('combines Family Plan slots and household player-access invites in one section', () => {
        const markup = buildFamilyPlanSectionMarkup({
            members: [member('pending', 'pending@example.com')],
            linkedPlayers: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Sam' }],
            invites: []
        });

        expect(markup).toContain('Family Plan');
        expect(markup).toContain('Household player access');
    });

    it('marks a family member as removed instead of deleting the record', async () => {
        const updateDoc = vi.fn().mockResolvedValue();
        const firebase = {
            db: {},
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            serverTimestamp: () => 'server-now'
        };

        await removeFamilyMember('user-1', 'member-1', { deps: { firebase } });

        expect(firebase.doc).toHaveBeenCalledWith({}, 'users', 'user-1', 'familyMemberships', 'member-1');
        expect(updateDoc).toHaveBeenCalledWith({ path: 'users/user-1/familyMemberships/member-1' }, expect.objectContaining({
            status: 'removed',
            accessStatus: 'revoked',
            removedAt: 'server-now'
        }));
    });

    it('revokes invite tokens before marking a member removed without unprivileged profile or player writes', async () => {
        const updateDoc = vi.fn().mockResolvedValue();
        const docs = new Map([
            ['users/organizer/familyMemberships/member-1', {
                email: 'household@example.com',
                userId: 'contact-1',
                accessCodeId: 'code-1',
                status: 'active',
                organizerUserId: 'organizer',
                playerAccess: [{ teamId: 'team-1', playerId: 'player-1', teamName: 'Team', playerName: 'Player' }]
            }]
        ]);
        const firebase = {
            db: {},
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            getDoc: vi.fn(async (ref) => ({
                exists: () => docs.has(ref.path),
                data: () => docs.get(ref.path) || {}
            })),
            updateDoc,
            serverTimestamp: () => 'server-now'
        };

        await removeFamilyMember('organizer', 'member-1', { deps: { firebase } });

        expect(updateDoc).toHaveBeenNthCalledWith(1, { path: 'accessCodes/code-1' }, expect.objectContaining({
            revoked: true,
            used: true,
            revokedAt: 'server-now'
        }));
        expect(updateDoc).toHaveBeenNthCalledWith(2, { path: 'users/organizer/familyMemberships/member-1' }, expect.objectContaining({
            status: 'removed',
            accessStatus: 'revoked',
            removedAt: 'server-now'
        }));
        const updatedPaths = updateDoc.mock.calls.map(([ref]) => ref.path);
        expect(updatedPaths).not.toContain('users/contact-1');
        expect(updatedPaths).not.toContain('teams/team-1/players/player-1');
    });

    it('marks a pending household invite revoked and invalidates its access code', async () => {
        const updateDoc = vi.fn().mockResolvedValue();
        const docs = new Map([
            ['users/organizer/householdInvites/invite-1', {
                email: 'household@example.com',
                contactName: 'Household Contact',
                status: 'pending',
                organizerUserId: 'organizer',
                accessCodeId: 'code-1'
            }]
        ]);
        const firebase = {
            db: {},
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            getDoc: vi.fn(async (ref) => ({
                exists: () => docs.has(ref.path),
                data: () => docs.get(ref.path) || {}
            })),
            updateDoc,
            serverTimestamp: () => 'server-now'
        };

        await revokeHouseholdInvite('organizer', 'invite-1', { deps: { firebase } });

        expect(updateDoc).toHaveBeenNthCalledWith(1, { path: 'accessCodes/code-1' }, expect.objectContaining({
            revoked: true,
            used: true,
            revokedAt: 'server-now'
        }));
        expect(updateDoc).toHaveBeenNthCalledWith(2, { path: 'users/organizer/householdInvites/invite-1' }, expect.objectContaining({
            status: 'removed',
            accessStatus: 'revoked',
            removedAt: 'server-now',
            revokedAt: 'server-now'
        }));
    });

    it('does not mark a household invite removed when access code revocation fails', async () => {
        const updateDoc = vi.fn(async (ref) => {
            if (ref.path === 'accessCodes/code-1') {
                throw new Error('access code write failed');
            }
        });
        const docs = new Map([
            ['users/organizer/householdInvites/invite-1', {
                email: 'household@example.com',
                contactName: 'Household Contact',
                status: 'pending',
                organizerUserId: 'organizer',
                accessCodeId: 'code-1'
            }]
        ]);
        const firebase = {
            db: {},
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            getDoc: vi.fn(async (ref) => ({
                exists: () => docs.has(ref.path),
                data: () => docs.get(ref.path) || {}
            })),
            updateDoc,
            serverTimestamp: () => 'server-now'
        };

        await expect(revokeHouseholdInvite('organizer', 'invite-1', { deps: { firebase } })).rejects.toThrow('access code write failed');
        expect(updateDoc).toHaveBeenCalledTimes(1);
        expect(updateDoc).toHaveBeenCalledWith({ path: 'accessCodes/code-1' }, expect.objectContaining({
            revoked: true,
            used: true,
            revokedAt: 'server-now'
        }));
    });

    it('loads family members and account entitlement state together', async () => {
        const firebase = {
            db: {},
            collection: vi.fn((_db, path) => ({ path })),
            getDocs: async () => ({
                docs: [{ id: 'member-1', data: () => ({ email: 'pending@example.com', status: 'pending' }) }]
            })
        };

        await expect(loadFamilyPlanState({ uid: 'user-1' }, {
            deps: { firebase },
            entitlementReader: async () => ({ state: 'locked' })
        })).resolves.toMatchObject({
            entitlementState: 'locked',
            members: [expect.objectContaining({ email: 'pending@example.com', status: 'pending' })]
        });
    });

    it('grants parents read/create/update access to their family membership shell records', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        expect(rules).toContain('match /familyMemberships/{memberId}');
        expect(rules).toContain('allow read: if isOwner(userId) || isGlobalAdmin();');
        expect(rules).toContain('allow create: if isOwner(userId) && isFamilyMembershipPayloadValid');
        expect(rules).toContain('allow update: if isOwner(userId) &&');
        expect(rules).toContain("affectedKeys().hasOnly(['status', 'accessStatus', 'updatedAt', 'removedAt'])");
        expect(rules).toContain("data.accessStatus == 'revoked'");
        expect(rules).toContain('isFamilyMembershipInviteMetadataUpdate');
        expect(rules).toContain('isFamilyMembershipAcceptance');
        expect(rules).toContain('allow delete: if false;');
    });

    it('grants parents create/read/revoke access to pending household invites only for linked players', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        expect(rules).toContain('match /householdInvites/{inviteId}');
        expect(rules).toContain('allow read: if isOwner(userId) || isGlobalAdmin();');
        expect(rules).toContain('allow create: if isOwner(userId) && isHouseholdInvitePayloadValid');
        expect(rules).toContain('data.status == \'pending\'');
        expect(rules).toContain('data.playerKey == data.teamId + "::" + data.playerId');
        expect(rules).toContain('isParentForPlayer(data.teamId, data.playerId)');
        expect(rules).toContain('allow update: if isHouseholdInviteRevocation');
        expect(rules).toContain("affectedKeys().hasOnly(['status', 'accessStatus', 'updatedAt', 'removedAt', 'revokedAt'])");
        expect(rules).toContain('allow delete: if isOwner(userId);');
    });

    it('keeps family share link listing on an owner-only query without composite index requirements', () => {
        const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
        const listFn = source.slice(source.indexOf('export async function listFamilyShareTokens'));
        expect(listFn).toContain("where('ownerUserId', '==', ownerUserId)");
        expect(listFn).not.toContain("where('active', '==', true)");
        expect(listFn).not.toContain("orderBy('createdAt', 'desc')");
        expect(listFn).toContain('.filter(token => token.active !== false)');
        expect(listFn).toContain('return bTime - aTime;');
    });

    it('guards family share token creation and normalizes share payloads', () => {
        const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
        expect(source).toContain("from './family-share-utils.js?v=1'");
        expect(source).toContain("throw new Error('No linked players are available to share yet.')");
        expect(source).toContain('globalThis.crypto.getRandomValues(bytes)');
    });

    it('normalizes family share calendar URLs to valid unique web links', () => {
        expect(normalizeFamilyShareCalendarUrls([
            ' https://league.example/schedule.ics ',
            'ftp://league.example/schedule.ics',
            'not-a-url',
            'https://league.example/schedule.ics',
            'http://travel.example/team.ics'
        ])).toEqual([
            'https://league.example/schedule.ics',
            'http://travel.example/team.ics'
        ]);
    });

    it('normalizes family share children and drops incomplete player links', () => {
        expect(normalizeFamilyShareChildren([
            { teamId: 'team-1', teamName: 'Tigers', playerId: 'player-1', playerName: 'Sam', playerPhotoUrl: 'photo.jpg' },
            { teamId: 'team-2', playerName: 'Missing player id' },
            { playerId: 'player-3', playerName: 'Missing team id' }
        ])).toEqual([
            {
                teamId: 'team-1',
                teamName: 'Tigers',
                playerId: 'player-1',
                playerName: 'Sam',
                playerPhotoUrl: 'photo.jpg'
            }
        ]);
    });

    it('shows a clearer parent dashboard family-share workflow', () => {
        const html = readFileSync(new URL('../../parent-dashboard.html', import.meta.url), 'utf8');
        expect(html).toContain('id="share-link-workflow-status"');
        expect(html).toContain('function updateShareLinkControlsReady()');
        expect(html).toContain('Link created and copied to clipboard.');
        expect(html).toContain('id="retry-share-links-btn"');
        expect(html).toContain("from './js/db.js?v=52'");
    });
});
