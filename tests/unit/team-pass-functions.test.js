import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    normalizeTeamPassCheckoutInput,
    isEligibleTeamPassPurchaser,
    shouldUnlockTeamPassFromEvent,
    buildTeamPassEntitlement
} = require('../../functions/team-pass-core.cjs');

describe('team pass function helpers', () => {
    it('normalizes a bounded team pass checkout request', () => {
        expect(normalizeTeamPassCheckoutInput({
            teamId: ' team_123 ',
            seasonId: '2026',
            tier: 'team-pass'
        })).toEqual({
            teamId: 'team_123',
            seasonId: '2026',
            tier: 'team-pass'
        });
    });

    it('rejects unsupported tiers before creating checkout sessions', () => {
        expect(() => normalizeTeamPassCheckoutInput({
            teamId: 'team_123',
            seasonId: '2026',
            tier: 'vip'
        })).toThrow('Unsupported team pass tier');
    });

    it('allows team owners, admins, and linked parents to purchase', () => {
        const team = {
            id: 'team_123',
            ownerId: 'owner_1',
            adminEmails: ['Coach@Example.com']
        };

        expect(isEligibleTeamPassPurchaser({ team, uid: 'owner_1' })).toBe(true);
        expect(isEligibleTeamPassPurchaser({ team, uid: 'admin_1', email: 'coach@example.com' })).toBe(true);
        expect(isEligibleTeamPassPurchaser({
            team,
            user: { parentTeamIds: ['team_123'] },
            uid: 'parent_1'
        })).toBe(true);
        expect(isEligibleTeamPassPurchaser({ team, uid: 'fan_1', email: 'fan@example.com' })).toBe(false);
    });

    it('unlocks only paid completed checkout events', () => {
        expect(shouldUnlockTeamPassFromEvent({
            type: 'checkout.session.completed',
            data: { object: { payment_status: 'paid' } }
        })).toBe(true);

        expect(shouldUnlockTeamPassFromEvent({
            type: 'checkout.session.completed',
            data: { object: { payment_status: 'unpaid' } }
        })).toBe(false);

        expect(shouldUnlockTeamPassFromEvent({
            type: 'checkout.session.expired',
            data: { object: { payment_status: 'paid' } }
        })).toBe(false);
    });

    it('builds a season-scoped active entitlement from Stripe metadata', () => {
        const entitlement = buildTeamPassEntitlement({
            eventId: 'evt_123',
            receivedAt: 'now',
            session: {
                id: 'cs_123',
                customer: 'cus_123',
                payment_intent: 'pi_123',
                metadata: {
                    teamId: 'team_123',
                    seasonId: '2026',
                    tier: 'team-pass',
                    purchaserUid: 'user_123'
                }
            }
        });

        expect(entitlement.refPath).toBe('teams/team_123/entitlements/2026_team-pass');
        expect(entitlement.data).toMatchObject({
            provider: 'stripe',
            status: 'active',
            teamId: 'team_123',
            seasonId: '2026',
            tier: 'team-pass',
            purchasedByUid: 'user_123',
            stripeCheckoutSessionId: 'cs_123',
            stripeEventId: 'evt_123'
        });
    });
});
