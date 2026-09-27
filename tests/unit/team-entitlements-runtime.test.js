import { describe, expect, it, vi } from 'vitest';
import { getTeamEntitlementStatus } from '../../js/team-entitlements.js';

const premiumOpen = async () => ({ state: 'ready', openToAll: true, reason: 'global-open' });
const premiumClosed = async () => ({ state: 'ready', openToAll: false, reason: 'entitlement-required' });

describe('public Team Pass status', () => {
    it('unlocks replay globally without calling the entitlement status backend', async () => {
        const httpsCallable = vi.fn();
        await expect(getTeamEntitlementStatus({
            teamId: 'team-1',
            seasonId: '2026',
            configReader: premiumOpen,
            deps: { firebase: { functions: {}, httpsCallable } }
        })).resolves.toMatchObject({
            active: true,
            reason: 'global-open',
            access: { state: 'unlocked', reason: 'global-open' }
        });
        expect(httpsCallable).not.toHaveBeenCalled();
    });

    it('uses the sanitized backend status when global access is off', async () => {
        const invoke = vi.fn().mockResolvedValue({
            data: { active: true, reason: 'active', seasonId: '2026', tier: 'team-pass' }
        });
        const httpsCallable = vi.fn(() => invoke);

        await expect(getTeamEntitlementStatus({
            teamId: 'team-1',
            seasonId: '2026',
            configReader: premiumClosed,
            deps: { firebase: { functions: {}, httpsCallable } }
        })).resolves.toMatchObject({
            active: true,
            access: { state: 'unlocked', reason: 'valid-team-entitlement' }
        });
        expect(httpsCallable).toHaveBeenCalledWith({}, 'getPublicTeamPassStatus');
        expect(invoke).toHaveBeenCalledWith({ teamId: 'team-1', seasonId: '2026', tier: 'team-pass' });
    });

    it('fails closed when sanitized status cannot be read', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const httpsCallable = vi.fn(() => vi.fn().mockRejectedValue(new Error('unavailable')));
        await expect(getTeamEntitlementStatus({
            teamId: 'team-1',
            seasonId: '2026',
            configReader: premiumClosed,
            deps: { firebase: { functions: {}, httpsCallable } }
        })).resolves.toMatchObject({
            active: false,
            access: { state: 'unavailable' }
        });
        consoleError.mockRestore();
    });
});
