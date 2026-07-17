import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../apps/app/src/components/AppShell.tsx', import.meta.url), 'utf8');

describe('signed-in primary navigation order', () => {
  it('keeps Discover as the last signed-in menu item', () => {
    const navItemsStart = source.indexOf('const navItems');
    const signedInItems = source.slice(navItemsStart, source.indexOf('];', navItemsStart) + 2);
    const labels = [...signedInItems.matchAll(/label: '([^']+)'/g)].map((match) => match[1]);
    expect(labels).toEqual(['Home', 'Schedule', 'Messages', 'My Teams', 'Profile', 'Discover']);

    const desktopItemsStart = source.indexOf('const desktopNavItems');
    const desktopItems = source.slice(desktopItemsStart, source.indexOf('];', desktopItemsStart) + 2);
    expect(desktopItems).toMatch(/\.\.\.navItems\.slice\(0, -1\),\s*familyNavItem,\s*navItems\[navItems\.length - 1\]/s);
  });

  it('does not change the public navigation order', () => {
    const publicItems = source.slice(source.indexOf('const publicNavItems'), source.indexOf('type AddWorkflow'));
    const labels = [...publicItems.matchAll(/label: '([^']+)'/g)].map((match) => match[1]);
    expect(labels).toEqual(['Discover', 'Find Teams', 'Sign In']);
  });
});
