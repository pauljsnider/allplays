import { describe, it, expect } from 'vitest';
import {
    isTeamActive,
    filterTeamsByActive,
    shouldIncludeTeamInLiveOrUpcoming,
    shouldIncludeTeamInReplay
} from '../../js/team-visibility.js';

describe('team visibility helpers', () => {
    it('treats missing active flag as active', () => {
        expect(isTeamActive({ id: 't1', name: 'No Active Field' })).toBe(true);
    });

    it('treats active false as inactive', () => {
        expect(isTeamActive({ id: 't1', active: false })).toBe(false);
    });

    it('filters inactive teams by default', () => {
        const teams = [
            { id: 'a', active: true },
            { id: 'b', active: false },
            { id: 'c' }
        ];
        expect(filterTeamsByActive(teams)).toEqual([
            { id: 'a', active: true },
            { id: 'c' }
        ]);
    });

    it('returns all teams when includeInactive=true', () => {
        const teams = [{ id: 'a', active: true }, { id: 'b', active: false }];
        expect(filterTeamsByActive(teams, true)).toEqual(teams);
    });

    it('excludes inactive teams from upcoming/live cards', () => {
        expect(shouldIncludeTeamInLiveOrUpcoming({ id: 'a', active: true })).toBe(true);
        expect(shouldIncludeTeamInLiveOrUpcoming({ id: 'b', active: false })).toBe(false);
    });

    it('keeps replay cards for inactive teams to preserve historical context', () => {
        expect(shouldIncludeTeamInReplay({ id: 'a', active: false })).toBe(true);
    });
});
