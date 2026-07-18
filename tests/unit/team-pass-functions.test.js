import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    normalizeTeamPassCheckoutInput,
    buildTeamPassCheckoutMetadata,
    isValidEntitlementCollectionGroupCursorPath,
    isEligibleTeamPassPurchaser,
    shouldUnlockTeamPassFromEvent,
    hasLegacyTeamPassMetadata,
    getLegacyTeamPassCheckoutGuardFailure,
    getTeamPassCheckoutGuardFailure,
    getTeamPassChargeGuardFailure,
    getTeamPassPaymentIntentGuardFailure,
    getTeamPassReversalStatus,
    reconcileTeamPassReversal,
    getTeamPassEffectivePaymentStatus,
    buildTeamPassEntitlement,
    buildTeamPassAttemptPaymentUpdate
} = require('../../functions/team-pass-core.cjs');
const { createInMemoryRateLimiter } = require('../../functions/rate-limit.cjs');

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

    it('unlocks only paid completed checkout events with team pass metadata', () => {
        const teamPassSession = {
            payment_status: 'paid',
            metadata: buildTeamPassCheckoutMetadata({
                teamId: 'team_123',
                seasonId: '2026',
                tier: 'team-pass',
                purchaserUid: 'user_123',
                checkoutAttemptToken: 'tok_1234567890abcdef',
                priceId: 'price_team_pass'
            })
        };

        expect(shouldUnlockTeamPassFromEvent({
            type: 'checkout.session.completed',
            data: { object: teamPassSession }
        })).toBe(true);

        expect(shouldUnlockTeamPassFromEvent({
            type: 'checkout.session.completed',
            data: { object: { ...teamPassSession, payment_status: 'unpaid' } }
        })).toBe(false);

        expect(shouldUnlockTeamPassFromEvent({
            type: 'checkout.session.expired',
            data: { object: teamPassSession }
        })).toBe(false);
    });

    it('acknowledges unrelated paid checkout sessions without unlocking', () => {
        expect(shouldUnlockTeamPassFromEvent({
            type: 'checkout.session.completed',
            data: { object: { payment_status: 'paid', metadata: { product: 'other' } } }
        })).toBe(false);

        expect(shouldUnlockTeamPassFromEvent({
            type: 'checkout.session.completed',
            data: {
                object: {
                    payment_status: 'paid',
                    metadata: {
                        teamId: 'team_123',
                        seasonId: '2026',
                        tier: 'team-pass',
                        product: 'team_pass'
                    }
                }
            }
        })).toBe(false);
    });

    it('accepts only the exact pre-authority Team Pass shape through the legacy reconciliation guard', () => {
        const session = {
            id: 'cs_legacy', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_legacy',
            client_reference_id: 'team_123:2026:user_123', amount_total: 4900, currency: 'usd', livemode: false,
            metadata: { teamId: 'team_123', seasonId: '2026', tier: 'team-pass', purchaserUid: 'user_123' }
        };
        const paymentIntent = {
            id: 'pi_legacy', amount_received: 4900, currency: 'usd', livemode: false,
            latest_charge: 'ch_legacy', metadata: {}
        };
        const configuredPrice = {
            id: 'price_team_pass', active: true, type: 'one_time', unit_amount: 4900, currency: 'usd'
        };
        const lineItems = [{
            quantity: 1, amount_total: 4900, currency: 'usd', price: configuredPrice
        }];
        const guard = (overrides = {}) => getLegacyTeamPassCheckoutGuardFailure({
            session, paymentIntent, lineItems, configuredPrice, configuredPriceId: 'price_team_pass',
            expectedLivemode: false, paidEvent: true, ...overrides
        });

        expect(hasLegacyTeamPassMetadata(session)).toBe(true);
        expect(guard()).toBe('');
        expect(guard({ session: { ...session, client_reference_id: 'victim:2026:user_123' } })).toBe('client_reference_mismatch');
        expect(guard({ session: { ...session, amount_total: 1 } })).toBe('checkout_amount_mismatch');
        expect(guard({ paymentIntent: { ...paymentIntent, metadata: { product: 'team_pass' } } })).toBe('legacy_payment_intent_metadata_mismatch');
        expect(guard({ lineItems: [{ ...lineItems[0], quantity: 2 }] })).toBe('checkout_line_item_mismatch');
        expect(hasLegacyTeamPassMetadata({
            ...session,
            metadata: { ...session.metadata, checkoutAttemptToken: 'tok_1234567890abcdef' }
        })).toBe(false);
        expect(hasLegacyTeamPassMetadata({
            ...session,
            metadata: { ...session.metadata, unexpectedAuthority: 'unsafe' }
        })).toBe(false);
    });

    it('rate limits webhook requests by requester within a fixed window', () => {
        const checkRateLimit = createInMemoryRateLimiter({ windowMs: 60_000, maxRequests: 2 });
        const req = { ip: '203.0.113.10', headers: {} };

        expect(checkRateLimit(req, 1_000)).toMatchObject({ allowed: true, remaining: 1 });
        expect(checkRateLimit(req, 2_000)).toMatchObject({ allowed: true, remaining: 0 });
        expect(checkRateLimit(req, 3_000)).toMatchObject({ allowed: false });
        expect(checkRateLimit(req, 62_000)).toMatchObject({ allowed: true, remaining: 1 });
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
        expect(entitlement.data).toEqual({
            status: 'active',
            teamId: 'team_123',
            seasonId: '2026',
            tier: 'team-pass',
            updatedAt: 'now'
        });
        expect(entitlement.data).not.toHaveProperty('purchasedByUid');
        expect(entitlement.data).not.toHaveProperty('stripeCheckoutSessionId');
    });

    it('requires the exact server-reserved Team Pass checkout authority', () => {
        const metadata = buildTeamPassCheckoutMetadata({
            teamId: 'team_123', seasonId: '2026', tier: 'team-pass',
            purchaserUid: 'user_123', checkoutAttemptToken: 'tok_1234567890abcdef',
            priceId: 'price_team_pass'
        });
        const attempt = {
            ...metadata,
            checkoutStatus: 'open',
            stripeCheckoutSessionId: 'cs_123',
            checkoutAmountCents: 4900,
            checkoutCurrency: 'usd',
            livemode: false
        };
        const session = {
            id: 'cs_123', metadata, amount_total: 4900, currency: 'usd',
            livemode: false, payment_status: 'paid'
        };

        expect(getTeamPassCheckoutGuardFailure({ attempt, session, paidEvent: true })).toBe('');
        expect(getTeamPassCheckoutGuardFailure({ attempt, session: { ...session, id: 'cs_old' }, paidEvent: true })).toBe('checkout_session_mismatch');
        expect(getTeamPassCheckoutGuardFailure({ attempt, session: { ...session, amount_total: 1 }, paidEvent: true })).toBe('checkout_amount_mismatch');
        expect(getTeamPassCheckoutGuardFailure({ attempt, session: { ...session, currency: 'eur' }, paidEvent: true })).toBe('checkout_currency_mismatch');
        expect(getTeamPassCheckoutGuardFailure({ attempt, session: { ...session, livemode: true }, paidEvent: true })).toBe('livemode_mismatch');
        expect(getTeamPassCheckoutGuardFailure({ attempt: { ...attempt, checkoutStatus: 'refunded' }, session, paidEvent: true })).toBe('checkout_state_mismatch');
    });

    it('keeps private payment identifiers only in the server-owned attempt update', () => {
        expect(buildTeamPassAttemptPaymentUpdate({
            session: { id: 'cs_123', customer: 'cus_123', payment_intent: 'pi_123', payment_status: 'paid' },
            eventId: 'evt_123', receivedAt: 'now', status: 'paid'
        })).toMatchObject({
            checkoutStatus: 'paid',
            stripeCheckoutSessionId: 'cs_123',
            stripeCustomerId: 'cus_123',
            stripePaymentIntentId: 'pi_123',
            stripeEventId: 'evt_123'
        });
    });

    it('binds paid Team Pass settlement to the exact PaymentIntent and Charge authority', () => {
        const metadata = buildTeamPassCheckoutMetadata({
            teamId: 'team_123', seasonId: '2026', tier: 'team-pass', purchaserUid: 'user_123',
            checkoutAttemptToken: 'tok_1234567890abcdef', priceId: 'price_team_pass'
        });
        const attempt = {
            ...metadata, checkoutStatus: 'open', stripeCheckoutSessionId: 'cs_123',
            checkoutAmountCents: 4900, checkoutCurrency: 'usd', livemode: false
        };
        const session = {
            id: 'cs_123', metadata, amount_total: 4900, currency: 'usd', livemode: false,
            payment_status: 'paid', payment_intent: 'pi_123'
        };
        const paymentIntent = {
            id: 'pi_123', metadata, amount_received: 4900, currency: 'usd', livemode: false,
            latest_charge: 'ch_123'
        };
        const charge = {
            id: 'ch_123', metadata, payment_intent: 'pi_123', amount: 4900,
            amount_refunded: 0, currency: 'usd', livemode: false
        };
        const guard = (overrides = {}) => getTeamPassPaymentIntentGuardFailure({
            attempt, session, paymentIntent, charge, ...overrides
        });

        expect(guard()).toBe('');
        expect(guard({ paymentIntent: { ...paymentIntent, id: 'pi_other' } })).toBe('payment_intent_mismatch');
        expect(guard({ attempt: { ...attempt, stripePaymentIntentId: 'pi_stale' } })).toBe('payment_intent_mismatch');
        expect(guard({ paymentIntent: { ...paymentIntent, metadata: { ...metadata, teamId: 'victim' } } })).toBe('payment_intent_scope_mismatch');
        expect(guard({ paymentIntent: { ...paymentIntent, metadata: { ...metadata, checkoutAttemptToken: 'tok_other_1234567890' } } })).toBe('payment_intent_attempt_mismatch');
        expect(guard({ paymentIntent: { ...paymentIntent, amount_received: 1 } })).toBe('payment_intent_amount_mismatch');
        expect(guard({ paymentIntent: { ...paymentIntent, currency: 'eur' } })).toBe('payment_intent_currency_mismatch');
        expect(guard({ paymentIntent: { ...paymentIntent, livemode: true } })).toBe('payment_intent_livemode_mismatch');
        expect(guard({ paymentIntent: { ...paymentIntent, latest_charge: null } })).toBe('payment_intent_charge_missing');
        expect(guard({ charge: { ...charge, id: 'ch_other' } })).toBe('payment_intent_charge_mismatch');
        expect(guard({ attempt: { ...attempt, stripeChargeId: 'ch_stale' } })).toBe('charge_charge_mismatch');
        expect(guard({ charge: { ...charge, metadata: { ...metadata, purchaserUid: 'attacker' } } })).toBe('charge_purchaser_mismatch');
        expect(guard({ charge: { ...charge, payment_intent: 'pi_other' } })).toBe('charge_payment_intent_mismatch');
        expect(guard({ charge: { ...charge, amount: 1 } })).toBe('charge_charge_amount_mismatch');
        expect(guard({ charge: { ...charge, currency: 'eur' } })).toBe('charge_charge_currency_mismatch');
        expect(guard({ charge: { ...charge, livemode: true } })).toBe('charge_livemode_mismatch');
    });

    it('binds refund and dispute events to the paid attempt before changing access', () => {
        const metadata = buildTeamPassCheckoutMetadata({
            teamId: 'team_123', seasonId: '2026', tier: 'team-pass', purchaserUid: 'user_123',
            checkoutAttemptToken: 'tok_1234567890abcdef', priceId: 'price_team_pass'
        });
        const attempt = {
            ...metadata, checkoutStatus: 'paid', stripePaymentIntentId: 'pi_123',
            checkoutAmountCents: 4900, checkoutCurrency: 'usd', livemode: true
        };
        const charge = {
            id: 'ch_123', metadata, payment_intent: 'pi_123', amount: 4900,
            amount_refunded: 4900, currency: 'usd', livemode: true
        };
        expect(getTeamPassChargeGuardFailure({ attempt, charge })).toBe('');
        expect(getTeamPassChargeGuardFailure({ attempt: { ...attempt, stripeChargeId: 'ch_other' }, charge })).toBe('charge_mismatch');
        expect(getTeamPassChargeGuardFailure({ attempt: { ...attempt, checkoutStatus: 'dispute_lost' }, charge })).toBe('');
        expect(getTeamPassChargeGuardFailure({ attempt: { ...attempt, checkoutStatus: 'disputed_lost' }, charge })).toBe('checkout_state_mismatch');
        expect(getTeamPassChargeGuardFailure({
            attempt: { ...attempt, checkoutStatus: 'open', stripePaymentIntentId: '' },
            charge
        })).toBe('');
        expect(getTeamPassChargeGuardFailure({ attempt, charge: { ...charge, payment_intent: 'pi_other' } })).toBe('payment_intent_mismatch');
        expect(getTeamPassChargeGuardFailure({
            attempt: {
                teamId: 'team_123', seasonId: '2026', tier: 'team-pass', purchaserUid: 'user_123',
                legacyPaymentAuthorityVersion: 1, checkoutStatus: 'paid', stripeCheckoutSessionId: 'cs_legacy',
                stripePaymentIntentId: 'pi_legacy', stripeChargeId: 'ch_legacy', checkoutAmountCents: 4900,
                checkoutCurrency: 'usd', livemode: false
            },
            charge: {
                id: 'ch_legacy', metadata: {}, payment_intent: 'pi_legacy', amount: 4900,
                amount_refunded: 4900, currency: 'usd', livemode: false
            }
        })).toBe('');
        expect(getTeamPassReversalStatus({ type: 'charge.refunded' }, charge)).toBe('refunded');
        expect(getTeamPassReversalStatus({ type: 'charge.dispute.created', data: { object: {} } }, { ...charge, amount_refunded: 0 })).toBe('disputed');
        expect(getTeamPassReversalStatus({ type: 'charge.dispute.closed', data: { object: { status: 'won' } } }, { ...charge, amount_refunded: 0 })).toBe('paid');
    });

    it('keeps Team Pass access monotonic when reversal events arrive before or after paid', () => {
        const refundedBeforePaid = reconcileTeamPassReversal({ current: {}, event: {
            id: 'evt_refund', type: 'charge.refunded', created: 200
        }, charge: { amount_refunded: 4900 } });
        expect(getTeamPassEffectivePaymentStatus(refundedBeforePaid)).toBe('refunded');

        const won = reconcileTeamPassReversal({ current: {}, event: {
            id: 'evt_won', type: 'charge.dispute.closed', created: 300,
            data: { object: { status: 'won' } }
        }, charge: { amount_refunded: 0 } });
        const lateCreated = reconcileTeamPassReversal({ current: won, event: {
            id: 'evt_created', type: 'charge.dispute.created', created: 100,
            data: { object: { status: 'needs_response' } }
        }, charge: { amount_refunded: 0 } });
        expect(lateCreated).toEqual(won);
        expect(getTeamPassEffectivePaymentStatus(lateCreated)).toBe('paid');

        const lost = reconcileTeamPassReversal({ current: lateCreated, event: {
            id: 'evt_lost', type: 'charge.dispute.closed', created: 400,
            data: { object: { status: 'lost' } }
        }, charge: { amount_refunded: 0 } });
        expect(getTeamPassEffectivePaymentStatus(lost)).toBe('dispute_lost');
    });

    it('exposes admin-only recovery for abandoned durable Team Pass checkout attempts', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        expect(source).toContain('exports.expireStripeTeamPassCheckout');
        expect(source).toContain("checkoutStatus: 'recovering'");
        expect(source).toContain('recoveryOperationId');
        expect(source).toContain("hasTeamAdminAccess({ team, user, uid: context.auth.uid, email })");
        expect(source).toContain('stripe.checkout.sessions.create(claimedAttempt.stripeRequest');
        expect(source).toContain('stripe.checkout.sessions.expire(recoveredSession.id)');
    });

    it('exposes a dry-run-first exact entitlement backfill with explicit write confirmation', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        expect(source).toContain('exports.backfillTeamPassEntitlementProjections');
        expect(source).toContain("data?.confirmation !== 'rewrite_safe_team_pass_entitlements_v1'");
        expect(source).toContain("firestore.collectionGroup('entitlements')");
        expect(source).toContain('.orderBy(admin.firestore.FieldPath.documentId())');
        expect(source).toContain('query = query.startAfter(cursorSnap)');
        expect(source).toContain('buildSafeTeamPassEntitlementProjection({');
        expect(source).toContain('rewritten: dryRun ? 0 : candidates.length');
        expect(isValidEntitlementCollectionGroupCursorPath('teams/team-a/entitlements/2026_team-pass')).toBe(true);
        expect(isValidEntitlementCollectionGroupCursorPath('users/user-a/entitlements/team-pass')).toBe(true);
        expect(isValidEntitlementCollectionGroupCursorPath('organizations/org-a/users/user-a/entitlements/team-pass')).toBe(true);
        expect(isValidEntitlementCollectionGroupCursorPath('teams/team-a/other/team-pass')).toBe(false);
        expect(isValidEntitlementCollectionGroupCursorPath('teams//entitlements/team-pass')).toBe(false);
    });
});
