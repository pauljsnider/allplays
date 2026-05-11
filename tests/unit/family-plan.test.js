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
    removeFamilyMember
} from '../../js/family-plan.js';

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
            members: [member('active', 'active@example.com'), member('pending', 'pending@example.com'), member('removed', 'removed@example.com')]
        });

        expect(markup).toContain('Family Plan');
        expect(markup).toContain('Billing and premium activation are not connected yet');
        expect(markup).toContain('active');
        expect(markup).toContain('pending');
        expect(markup).toContain('removed');
    });

    it('blocks pending member writes when the four active-or-pending slots are full', async () => {
        await expect(addPendingFamilyMember('user-1', { email: 'new@example.com' }, {
            existingMembers: [member('active', 'one@example.com'), member('pending', 'two@example.com'), member('active', 'three@example.com'), member('pending', 'four@example.com')]
        })).rejects.toThrow('limited to 4');
    });

    it('rejects malformed pending member email addresses', async () => {
        await expect(addPendingFamilyMember('user-1', { email: 'invalid' }, {
            existingMembers: []
        })).rejects.toThrow('valid email');
    });

    it('writes a pending family membership record for an available slot', async () => {
        const addDoc = vi.fn().mockResolvedValue({ id: 'member-1' });
        const firebase = {
            db: {},
            collection: vi.fn((_db, path) => ({ path })),
            addDoc,
            serverTimestamp: () => 'server-now'
        };

        await addPendingFamilyMember('user-1', { email: ' NEW@EXAMPLE.COM ', displayName: ' New Person ' }, {
            deps: { firebase },
            existingMembers: []
        });

        expect(firebase.collection).toHaveBeenCalledWith({}, 'users/user-1/familyMemberships');
        expect(addDoc).toHaveBeenCalledWith({ path: 'users/user-1/familyMemberships' }, expect.objectContaining({
            email: 'new@example.com',
            displayName: 'New Person',
            status: 'pending',
            organizerUserId: 'user-1'
        }));
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
    });

    it('normalizes household invite records without granting access fields', () => {
        expect(normalizeHouseholdInvites([{ id: 'invite-1', email: ' NEW@EXAMPLE.COM ', status: 'pending', teamAccessIntent: true }])).toEqual([
            expect.objectContaining({
                id: 'invite-1',
                email: 'new@example.com',
                status: 'pending',
                teamAccessIntent: true
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
            removedAt: 'server-now'
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
        expect(rules).toContain("affectedKeys().hasOnly(['status', 'updatedAt', 'removedAt'])");
        expect(rules).toContain('allow delete: if false;');
    });

    it('grants parents create/read access to pending household invites only for linked players', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        expect(rules).toContain('match /householdInvites/{inviteId}');
        expect(rules).toContain('allow read: if isOwner(userId) || isGlobalAdmin();');
        expect(rules).toContain('allow create: if isOwner(userId) && isHouseholdInvitePayloadValid');
        expect(rules).toContain('data.status == \'pending\'');
        expect(rules).toContain('data.playerKey == data.teamId + "::" + data.playerId');
        expect(rules).toContain('isParentForPlayer(data.teamId, data.playerId)');
        expect(rules).toContain('allow update, delete: if false;');
    });
});
