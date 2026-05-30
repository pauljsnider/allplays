import { describe, it, expect } from 'vitest';
import {
    isTeamActive,
    isTeamPublic,
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

    it('treats archived and inactive status markers as inactive', () => {
        expect(isTeamActive({ id: 't1', archived: true })).toBe(false);
        expect(isTeamActive({ id: 't2', status: 'archived' })).toBe(false);
        expect(isTeamActive({ id: 't3', status: 'inactive' })).toBe(false);
        expect(isTeamActive({ id: 't4', status: 'disabled' })).toBe(false);
        expect(isTeamActive({ id: 't5', status: 'active' })).toBe(true);
    });

    it('filters inactive teams by default', () => {
        const teams = [
            { id: 'a', active: true },
            { id: 'b', active: false },
            { id: 'c' },
            { id: 'd', archived: true },
            { id: 'e', status: 'archived' }
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

    it('only treats explicitly public teams as public', () => {
        expect(isTeamPublic({ id: 'a', isPublic: true })).toBe(true);
        expect(isTeamPublic({ id: 'b', isPublic: false })).toBe(false);
        expect(isTeamPublic({ id: 'c' })).toBe(false);
    });

    it('excludes inactive and private teams from upcoming/live cards', () => {
        expect(shouldIncludeTeamInLiveOrUpcoming({ id: 'a', active: true, isPublic: true })).toBe(true);
        expect(shouldIncludeTeamInLiveOrUpcoming({ id: 'b', active: false, isPublic: true })).toBe(false);
        expect(shouldIncludeTeamInLiveOrUpcoming({ id: 'c', active: true, isPublic: false })).toBe(false);
        expect(shouldIncludeTeamInLiveOrUpcoming({ id: 'd', active: true })).toBe(false);
    });

    it('keeps replay cards for inactive public teams to preserve historical context', () => {
        expect(shouldIncludeTeamInReplay({ id: 'a', active: false, isPublic: true })).toBe(true);
    });

    it('excludes private teams from replay cards', () => {
        expect(shouldIncludeTeamInReplay({ id: 'a', active: true, isPublic: false })).toBe(false);
        expect(shouldIncludeTeamInReplay({ id: 'b', active: true })).toBe(false);
    });
});
