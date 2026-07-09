import { describe, expect, it, vi } from 'vitest';
import {
  preloadSearchRoute,
  resolveSearchRoutePreloader
} from './searchRoutePreload';

vi.mock('../pages/Home', () => ({}));
vi.mock('../pages/RegistrationDetail', () => ({}));

describe('searchRoutePreload', () => {
  it('matches query-string search routes by pathname while preserving navigation routes', async () => {
    const homePreloader = resolveSearchRoutePreloader('/home');
    const authPreloader = resolveSearchRoutePreloader('/auth');

    expect(resolveSearchRoutePreloader('/home?section=feed')).toBe(homePreloader);
    expect(resolveSearchRoutePreloader('/auth?mode=signup')).toBe(authPreloader);
    await expect(preloadSearchRoute('/home?section=feed')).resolves.toBe(true);
  });

  it('keeps existing plain-path route preload coverage intact', () => {
    expect(resolveSearchRoutePreloader('/teams')).toBeTypeOf('function');
    expect(resolveSearchRoutePreloader('/teams/browse')).toBeTypeOf('function');
    expect(resolveSearchRoutePreloader('/players/team-1/player-1')).toBeTypeOf('function');
    expect(resolveSearchRoutePreloader('/help/parent-fees')).toBeTypeOf('function');
  });

  it('preloads protected parent registration details with the registration detail loader', async () => {
    const registrationDetailPreloader = resolveSearchRoutePreloader('/registration');
    const parentToolsPreloader = resolveSearchRoutePreloader('/parent-tools');

    expect(resolveSearchRoutePreloader('/parent-tools/registrations/team-1/form-1')).toBe(registrationDetailPreloader);
    expect(resolveSearchRoutePreloader('/parent-tools/registrations/team-1/form-1')).not.toBe(parentToolsPreloader);
    await expect(preloadSearchRoute('/parent-tools/registrations/team-1/form-1?source=search')).resolves.toBe(true);
  });

  it('keeps parent registrations tab routes on the parent tools preloader', () => {
    const parentToolsPreloader = resolveSearchRoutePreloader('/parent-tools');

    expect(resolveSearchRoutePreloader('/parent-tools/registrations')).toBe(parentToolsPreloader);
  });

  it('does not match unknown routes after normalization', async () => {
    expect(resolveSearchRoutePreloader('/unknown?section=feed')).toBeNull();
    await expect(preloadSearchRoute('/unknown?section=feed')).resolves.toBe(false);
  });
});
