import { describe, expect, it } from 'vitest';
import {
    buildDiamondTeamSetup,
    getDefaultDiamondRulesProfile,
    getDiamondRulesProfile,
    listDiamondRulesProfilesForSport,
    normalizeDiamondRulesSport
} from '../../js/diamond-rules-profiles.js';

describe('Diamond rules profile contract', () => {
    it('uses distinct versioned Baseball and Fastpitch defaults', () => {
        expect(getDefaultDiamondRulesProfile('Baseball')).toMatchObject({ id: 'baseball-youth', version: 1, sport: 'baseball' });
        expect(getDefaultDiamondRulesProfile('Softball')).toMatchObject({ id: 'fastpitch-youth', version: 1, sport: 'fastpitch' });
        expect(getDefaultDiamondRulesProfile('Fastpitch')).toMatchObject({ id: 'fastpitch-youth', version: 1, sport: 'fastpitch' });
    });

    it('rejects unknown sports, versions, and cross-sport selections', () => {
        expect(normalizeDiamondRulesSport('Soccer')).toBe('');
        expect(getDiamondRulesProfile('baseball-youth', 2)).toBeNull();
        expect(buildDiamondTeamSetup('Baseball', { rulesProfileId: 'fastpitch-nfhs' }))
            .toMatchObject({ rulesProfileId: 'baseball-youth' });
    });

    it('builds a bounded server payload and defaults to Quick capture', () => {
        expect(buildDiamondTeamSetup('Fastpitch', {
            rulesProfileId: 'fastpitch-nfhs',
            rulesProfileVersion: 1,
            captureMode: 'full'
        })).toEqual({
            enabled: true,
            sport: 'fastpitch',
            rulesProfileId: 'fastpitch-nfhs',
            rulesProfileVersion: 1,
            captureMode: 'full'
        });
        expect(buildDiamondTeamSetup('Baseball')).toMatchObject({ captureMode: 'quick' });
        expect(listDiamondRulesProfilesForSport('Softball')).toHaveLength(2);
    });
});
