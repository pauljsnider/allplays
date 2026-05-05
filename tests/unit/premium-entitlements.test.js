import { describe, expect, it } from 'vitest';
import {
    isValidPremiumEntitlementRecord,
    readAccountPremiumEntitlement,
    readTeamPremiumEntitlement
} from '../../js/premium-entitlements.js';

function mockFirebaseForDocs(docs) {
    return {
        db: {},
        collection: (_db, path) => ({ path }),
        getDocs: async () => ({
            docs: docs.map((data) => ({ data: () => data }))
        })
    };
}

describe('premium entitlement helpers', () => {
    it('accepts active unexpired team-pass entitlements for the current team', () => {
        expect(isValidPremiumEntitlementRecord({
            status: 'active',
            tier: 'team-pass',
            teamId: 'team_123',
            expiresAt: '2099-01-01T00:00:00.000Z'
        }, {
            scope: 'team',
            teamId: 'team_123',
            now: new Date('2026-05-05T00:00:00.000Z')
        })).toBe(true);
    });

    it('rejects expired, revoked, wrong-team, and malformed records', () => {
        const now = new Date('2026-05-05T00:00:00.000Z');
        expect(isValidPremiumEntitlementRecord({ status: 'active', teamId: 'team_123', expiresAt: '2026-01-01' }, { scope: 'team', teamId: 'team_123', now })).toBe(false);
        expect(isValidPremiumEntitlementRecord({ status: 'active', teamId: 'team_123', revokedAt: '2026-01-01' }, { scope: 'team', teamId: 'team_123', now })).toBe(false);
        expect(isValidPremiumEntitlementRecord({ status: 'active', teamId: 'other_team' }, { scope: 'team', teamId: 'team_123', now })).toBe(false);
        expect(isValidPremiumEntitlementRecord({ status: 'active', teamId: 'team_123', expiresAt: {} }, { scope: 'team', teamId: 'team_123', now })).toBe(false);
        expect(isValidPremiumEntitlementRecord({ status: 'revoked', teamId: 'team_123' }, { scope: 'team', teamId: 'team_123', now })).toBe(false);
    });

    it('unlocks team premium only for linked team users with a valid team record', async () => {
        await expect(readTeamPremiumEntitlement({
            teamId: 'team_123',
            user: { uid: 'user_123' },
            teamAccessInfo: { hasAccess: true },
            deps: { firebase: mockFirebaseForDocs([{ status: 'active', teamId: 'team_123', tier: 'team-pass' }]) }
        })).resolves.toMatchObject({ state: 'unlocked' });

        await expect(readTeamPremiumEntitlement({
            teamId: 'team_123',
            user: { uid: 'user_123' },
            teamAccessInfo: { hasAccess: false },
            deps: { firebase: mockFirebaseForDocs([{ status: 'active', teamId: 'team_123', tier: 'team-pass' }]) }
        })).resolves.toMatchObject({ state: 'locked' });
    });

    it('unlocks player premium for the current user with a valid account record', async () => {
        await expect(readAccountPremiumEntitlement({
            user: { uid: 'user_123' },
            deps: { firebase: mockFirebaseForDocs([{ status: 'active', accountUserId: 'user_123' }]) }
        })).resolves.toMatchObject({ state: 'unlocked' });

        await expect(readAccountPremiumEntitlement({
            user: { uid: 'user_123' },
            deps: { firebase: mockFirebaseForDocs([{ status: 'active', accountUserId: 'other_user' }]) }
        })).resolves.toMatchObject({ state: 'locked' });
    });
});
