import { describe, expect, it } from 'vitest';
import { getAllSkillTags } from '../../js/drill-constants.js';
import { getStarterDrillById, getStarterDrills } from '../../js/practice-starter-drills.js';

describe('baseball and softball practice starter drills', () => {
    it('exposes baseball and softball skills', () => {
        expect(getAllSkillTags('Baseball')).toContain('fielding play');
        expect(getAllSkillTags('Softball')).toContain('base running');
    });

    it('returns sport-filtered starter drills', () => {
        const baseball = getStarterDrills('Baseball');
        const softball = getStarterDrills('Softball');
        expect(baseball.length).toBeGreaterThanOrEqual(6);
        expect(softball.length).toBe(baseball.length);
        expect(baseball.every(drill => drill.sport === 'Baseball')).toBe(true);
    });

    it('supports starter drill lookup by id', () => {
        const [drill] = getStarterDrills('Baseball', { skill: 'fielding play' });
        expect(getStarterDrillById(drill.id)).toMatchObject({
            id: drill.id,
            source: 'starter'
        });
    });
});

