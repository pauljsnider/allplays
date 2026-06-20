import { describe, expect, it } from 'vitest';
import { shouldReloadTeamsToHome } from '../../apps/app/src/lib/reloadRouting.ts';

describe('shouldReloadTeamsToHome', () => {
    it('preserves bare /teams reloads for signed-in users', () => {
        expect(shouldReloadTeamsToHome({
            hasUser: true,
            pathname: '/teams',
            search: '',
            isReload: true
        })).toBe(false);
    });

    it('preserves /teams reloads when query params are present', () => {
        expect(shouldReloadTeamsToHome({
            hasUser: true,
            pathname: '/teams',
            search: '?scenario=error',
            isReload: true
        })).toBe(false);
    });

    it('preserves non-reload visits and team detail routes', () => {
        expect(shouldReloadTeamsToHome({
            hasUser: true,
            pathname: '/teams',
            search: '',
            isReload: false
        })).toBe(false);
        expect(shouldReloadTeamsToHome({
            hasUser: true,
            pathname: '/teams/team-2',
            search: '',
            isReload: true
        })).toBe(false);
    });
});
