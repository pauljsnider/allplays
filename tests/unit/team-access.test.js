import { describe, it, expect } from 'vitest';
import { hasFullTeamAccess, getTeamAccessInfo } from '../../js/team-access.js';

const TEAM = {
  id: 'team-1',
  ownerId: 'owner-1',
  adminEmails: ['admin@example.com']
};

describe('team access helpers', () => {
  it('grants full access to team owner', () => {
    expect(hasFullTeamAccess({ uid: 'owner-1' }, TEAM)).toBe(true);
  });

  it('grants full access to team admin email (case-insensitive)', () => {
    expect(hasFullTeamAccess({ uid: 'u1', email: 'ADMIN@EXAMPLE.COM' }, TEAM)).toBe(true);
  });

  it('grants full access to platform admin', () => {
    expect(hasFullTeamAccess({ uid: 'u2', isAdmin: true }, TEAM)).toBe(true);
  });

  it('does not grant full access from coachOf alone', () => {
    expect(hasFullTeamAccess({ uid: 'u3', coachOf: ['team-1'] }, TEAM)).toBe(false);
  });

  it('returns parent access level for parent-linked users', () => {
    expect(getTeamAccessInfo({ uid: 'u4', parentOf: [{ teamId: 'team-1', playerId: 'p1' }] }, TEAM)).toEqual({
      hasAccess: true,
      accessLevel: 'parent',
      exitUrl: 'parent-dashboard.html'
    });
  });

  it('returns no access for unrelated users', () => {
    expect(getTeamAccessInfo({ uid: 'u5', email: 'random@example.com' }, TEAM)).toEqual({
      hasAccess: false,
      accessLevel: null,
      exitUrl: 'index.html'
    });
  });
});
