import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyParentIncentives = vi.hoisted(() => ({
    calculateEarnings: vi.fn(),
    getApplicableRulesForGame: vi.fn(),
    getCapSetting: vi.fn(),
    getIncentiveRules: vi.fn(),
    getPaidGames: vi.fn(),
    getStatOptionsForTeam: vi.fn(),
    isCurrentRuleVersion: vi.fn(),
    markGamePaid: vi.fn(),
    retireIncentiveRule: vi.fn(),
    saveCapSetting: vi.fn(),
    saveIncentiveRule: vi.fn(),
    toggleIncentiveRule: vi.fn()
}));

vi.mock('@legacy/parent-incentives.js', () => legacyParentIncentives);
vi.mock('@legacy/athlete-profile-utils.js', () => ({
    buildAthleteProfileShareUrl: vi.fn()
}));
vi.mock('@legacy/player-profile-stats.js', () => ({
    collectPlayerVideoClips: vi.fn()
}));
vi.mock('@legacy/player-tracking-summary.js', () => ({
    getVisiblePlayerTrackingSummary: vi.fn()
}));

import { getCapSetting } from './legacyPlayerProfile';

describe('legacy player profile adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('preserves an unset cap setting as null', async () => {
        legacyParentIncentives.getCapSetting.mockReturnValue(null);

        await expect(getCapSetting('user-1', 'player-1')).resolves.toBeNull();
        expect(legacyParentIncentives.getCapSetting).toHaveBeenCalledWith('user-1', 'player-1');
    });

    it('normalizes finite cap setting values without dropping zero', async () => {
        legacyParentIncentives.getCapSetting.mockReturnValueOnce('1250');
        await expect(getCapSetting('user-1', 'player-1')).resolves.toBe(1250);

        legacyParentIncentives.getCapSetting.mockReturnValueOnce(0);
        await expect(getCapSetting('user-1', 'player-1')).resolves.toBe(0);
    });
});
