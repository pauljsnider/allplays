"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { canonicalScheduleRoles, createCanonicalScheduleMembership } = require('../schedule-canonical-membership.cjs');
const { createScheduleDeliveryAudience, createFirestoreScheduleRecipientLoader } = require('../schedule-delivery-audience.cjs');
function fixture() {
    const rows = new Map([
        ['teams/team', { ownerId: 'owner', adminEmails: ['admin@example.test'] }],
        ['users/owner', {}], ['users/admin', {}], ['users/parent', { parentTeamIds: ['team'] }],
        ['users/fan', { favoriteTeams: ['team'], coachOf: ['team'], email: 'admin@example.test' }]
    ]);
    const accounts = new Map(['owner', 'admin', 'parent', 'fan'].map((uid) => [uid, { uid, email: `${uid}@example.test`, disabled: false, emailVerified: true }]));
    const devices = new Map([['parent', [{ token: 'synthetic-device' }]]]); let overflow = false; let queryFailed = false;
    const firestore = { doc: (path) => ({ get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }) }), collection: (path) => ({
        where: (field, op, teamId) => { assert.equal(path, 'users'); assert.equal(field, 'parentTeamIds'); assert.equal(op, 'array-contains');
            return { limit: (limit) => ({ get: async () => { assert.equal(limit, 101); if (queryFailed) throw new Error('query unavailable');
                return { docs: overflow ? Array.from({ length: 101 }, (_, i) => ({ id: `parent${i}` })) : [...rows].filter(([key, data]) => /^users\/[^/]+$/.test(key) && data.parentTeamIds?.includes(teamId)).map(([key]) => ({ id: key.split('/')[1] })) }; } }) }; },
        limit: (limit) => ({ get: async () => { assert.equal(limit, 21); const uid = path.split('/')[1]; return { docs: (devices.get(uid) || []).map((data) => ({ data: () => data })) }; } })
    }) };
    const auth = { getUser: async (uid) => { if (!accounts.has(uid)) throw Object.assign(new Error('absent'), { code: 'auth/user-not-found' }); return accounts.get(uid); },
        getUserByEmail: async (address) => { const user = [...accounts.values()].find((row) => row.email === address); if (!user) throw Object.assign(new Error('absent'), { code: 'auth/user-not-found' }); return user; } };
    const membership = createCanonicalScheduleMembership({ firestore, auth });
    const audience = createScheduleDeliveryAudience({ ...membership, loadRecipient: createFirestoreScheduleRecipientLoader({ firestore, auth, resolveCanonicalRoles: membership.resolveCanonicalRoles }) });
    return { rows, accounts, devices, membership, audience, auth, overflow: () => { overflow = true; }, failQuery: () => { queryFailed = true; } };
}
describe('canonical schedule audience adapters', () => {
    it('uses current canonical records, preferences and Auth-owned devices', async () => {
        const f = fixture(); assert.deepEqual(await f.membership.listCanonicalMembers('team'), { complete: true, uids: ['admin', 'owner', 'parent'] });
        assert.equal(await f.membership.authorizeActor({ uid: 'admin' }, 'team'), true);
        assert.deepEqual(await f.audience.resolve({ teamId: 'team', actorUid: 'owner' }), [
            { recipientUid: 'admin', channel: 'inbox', endpoint: 'admin' }, { recipientUid: 'parent', channel: 'inbox', endpoint: 'parent' },
            { recipientUid: 'parent', channel: 'push', endpoint: 'synthetic-device' }
        ]);
        f.rows.set('users/parent/notificationPreferences/team', { schedule: false });
        assert.equal((await f.audience.resolve({ teamId: 'team', actorUid: 'owner' })).length, 1);
    });
    it('revalidates parent links, device ownership and actor admin access immediately before delivery', async () => {
        const f = fixture(); const input = { actor: { uid: 'owner' }, binding: { teamId: 'team' }, request: { teamId: 'team', actorUid: 'owner', recipientUid: 'parent', channel: 'push', endpoint: 'synthetic-device' } };
        assert.equal((await f.audience.authorize(input)).recipientAllowed, true);
        f.rows.set('users/parent', { parentTeamIds: [] }); assert.equal((await f.audience.authorize(input)).recipientAllowed, false);
        f.rows.set('users/parent', { parentTeamIds: ['team'] }); f.devices.set('parent', []); assert.equal((await f.audience.authorize(input)).recipientAllowed, false);
        f.rows.get('teams/team').ownerId = 'someone-else'; assert.equal((await f.audience.authorize(input)).actorAllowed, false);
    });
    it('does not grant roles through favorites, coachOf, profile email or cached role labels', async () => {
        const f = fixture(); assert.equal(await f.membership.authorizeActor({ uid: 'fan' }, 'team'), false);
        assert.deepEqual(canonicalScheduleRoles({ teamId: 'team', team: f.rows.get('teams/team'), user: f.rows.get('users/fan'), uid: 'fan', email: 'fan@example.test', emailVerified: true }), []);
    });
    it('suppresses disabled recipients and unverified email-based administrators', async () => {
        const f = fixture(); f.accounts.get('parent').disabled = true; f.accounts.get('admin').emailVerified = false;
        assert.deepEqual(await f.audience.resolve({ teamId: 'team', actorUid: 'owner' }), []);
        assert.equal(await f.membership.authorizeActor({ uid: 'admin' }, 'team'), false);
    });
    it('allows unambiguous verified legacy owner email only when ownerId is absent', async () => {
        const f = fixture(); f.rows.set('teams/team', { ownerEmail: 'ADMIN@example.test', ownerEmailLower: 'admin@example.test' });
        assert.equal(await f.membership.authorizeActor({ uid: 'admin' }, 'team'), true);
        f.rows.get('teams/team').ownerId = 'owner'; assert.equal(await f.membership.authorizeActor({ uid: 'admin' }, 'team'), false);
        delete f.rows.get('teams/team').ownerId; f.rows.get('teams/team').ownerEmailLower = 'other@example.test';
        await assert.rejects(f.membership.listCanonicalMembers('team'));
    });
    for (const [label, team] of [
        ['padded owner ID', { ownerId: ' owner ' }], ['tabbed owner ID', { ownerId: '\towner\t' }],
        ['null owner ID', { ownerId: null, ownerEmail: 'owner@example.test' }],
        ['numeric owner ID', { ownerId: 0, ownerEmail: 'owner@example.test' }],
        ['boolean owner ID', { ownerId: false, ownerEmail: 'owner@example.test' }],
        ['blank owner ID', { ownerId: ' ', ownerEmail: 'owner@example.test' }],
        ['padded owner email', { ownerId: '', ownerEmail: ' owner@example.test ' }],
        ['tabbed owner email', { ownerId: '', ownerEmail: '\towner@example.test\t' }],
        ['null owner email alias', { ownerId: '', ownerEmail: 'owner@example.test', ownerEmailLower: null }],
        ['tabbed admin email', { ownerId: 'other', adminEmails: ['\towner@example.test\t'] }],
        ['uppercase admin mismatch', { ownerId: 'other', adminEmails: ['OWNER@example.test'] }]
    ]) it(`does not normalize ${label} into manager access`, async () => {
        const f = fixture(); f.rows.set('teams/team', team);
        assert.equal(await f.membership.authorizeActor({ uid: 'owner' }, 'team'), false);
    });
    it('fails closed on incomplete queries, too many candidates or failed Auth lookups', async () => {
        const f = fixture(); f.overflow(); await assert.rejects(f.audience.resolve({ teamId: 'team', actorUid: 'owner' }));
        const g = fixture(); g.failQuery(); await assert.rejects(g.audience.resolve({ teamId: 'team', actorUid: 'owner' }));
        const h = fixture(); h.auth.getUserByEmail = async () => { throw new Error('Auth unavailable'); }; await assert.rejects(h.membership.listCanonicalMembers('team'));
    });
    it('does not trust mismatched Auth email resolution or ambiguous cross-user device tokens', async () => {
        const f = fixture(); f.auth.getUserByEmail = async () => ({ ...f.accounts.get('admin'), email: 'different@example.test' }); await assert.rejects(f.membership.listCanonicalMembers('team'));
        const g = fixture(); g.devices.set('admin', [{ token: 'synthetic-device' }]); await assert.rejects(g.audience.resolve({ teamId: 'team', actorUid: 'owner' }));
    });
});
