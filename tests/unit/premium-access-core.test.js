import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PREMIUM_OPEN_TO_ALL,
    PREMIUM_FEATURES,
    normalizePremiumAccessConfig,
    resolvePremiumAccess
} from '../../js/premium-access-core.js';

describe('global premium access core', () => {
    it('defaults a confirmed missing config document to open for everyone', () => {
        expect(DEFAULT_PREMIUM_OPEN_TO_ALL).toBe(true);
        expect(normalizePremiumAccessConfig(null, { exists: false })).toEqual({
            state: 'ready',
            openToAll: true,
            reason: 'default-open'
        });
    });

    it('normalizes explicit on and off values and rejects malformed config', () => {
        expect(normalizePremiumAccessConfig({ openToAll: true })).toMatchObject({ state: 'ready', openToAll: true, reason: 'global-open' });
        expect(normalizePremiumAccessConfig({ openToAll: false })).toMatchObject({ state: 'ready', openToAll: false, reason: 'entitlement-required' });
        expect(normalizePremiumAccessConfig({ openToAll: 'true' })).toMatchObject({ state: 'unavailable', openToAll: false });
        expect(normalizePremiumAccessConfig(null)).toMatchObject({ state: 'unavailable', openToAll: false });
    });

    it('uses one resolver for global-open and entitlement-required modes', () => {
        const feature = PREMIUM_FEATURES.RECORDED_REPLAY;
        expect(resolvePremiumAccess({
            feature,
            config: { state: 'ready', openToAll: true, reason: 'global-open' }
        })).toMatchObject({ state: 'unlocked', reason: 'global-open' });
        expect(resolvePremiumAccess({
            feature,
            config: { state: 'ready', openToAll: false, reason: 'entitlement-required' },
            entitlement: { state: 'unlocked', reason: 'valid-team-entitlement' }
        })).toMatchObject({ state: 'unlocked', reason: 'valid-team-entitlement' });
        expect(resolvePremiumAccess({
            feature,
            config: { state: 'ready', openToAll: false, reason: 'entitlement-required' }
        })).toMatchObject({ state: 'locked' });
    });

    it('never lets the premium override bypass normal resource authorization', () => {
        expect(resolvePremiumAccess({
            feature: PREMIUM_FEATURES.TEAM_ANALYTICS,
            normalAccess: false,
            config: { state: 'ready', openToAll: true, reason: 'global-open' }
        })).toMatchObject({ state: 'locked', reason: 'missing-resource-access' });
    });

    it('fails closed when config cannot be verified', () => {
        expect(resolvePremiumAccess({
            feature: PREMIUM_FEATURES.PLAYER_ANALYTICS,
            config: { state: 'unavailable', openToAll: false, reason: 'global-config-read-failed' }
        })).toMatchObject({ state: 'unavailable', reason: 'global-config-read-failed' });
    });
});
