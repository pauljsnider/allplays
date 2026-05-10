import { describe, it, expect } from 'vitest';
import { hasFullTeamAccess, hasStreamTeamAccess, getTeamAccessInfo, normalizeTeamPermissions } from '../../js/team-access.js';

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

  it('grants full access when stored admin email has surrounding whitespace', () => {
    expect(hasFullTeamAccess(
      { uid: 'u1', email: 'admin@example.com' },
      { ...TEAM, adminEmails: ['  ADMIN@EXAMPLE.COM  '] }
    )).toBe(true);
  });

  it('grants full access when profile email matches admin list', () => {
    expect(hasFullTeamAccess({ uid: 'u1', profileEmail: 'ADMIN@EXAMPLE.COM' }, TEAM)).toBe(true);
  });

  it('grants full access to platform admin', () => {
    expect(hasFullTeamAccess({ uid: 'u2', isAdmin: true }, TEAM)).toBe(true);
  });

  it('does not grant full access to delegated coach assignment alone', () => {
    expect(hasFullTeamAccess({ uid: 'u3', coachOf: ['team-1'] }, TEAM)).toBe(false);
  });

  it('does not grant coach access when team id is missing', () => {
    expect(hasFullTeamAccess({ uid: 'u3', coachOf: ['team-1'] }, { ownerId: 'owner-1' })).toBe(false);
  });

  it('returns no access for coach-assigned users without owner/admin privileges', () => {
    expect(getTeamAccessInfo({ uid: 'u3', coachOf: ['team-1'] }, TEAM)).toEqual({
      hasAccess: false,
      accessLevel: null,
      exitUrl: 'index.html'
    });
  });

  it('returns parent access level for parent-linked users', () => {
    expect(getTeamAccessInfo({ uid: 'u4', parentOf: [{ teamId: 'team-1', playerId: 'p1' }] }, TEAM)).toEqual({
      hasAccess: true,
      accessLevel: 'parent',
      exitUrl: 'parent-dashboard.html'
    });
  });

  it('grants limited stream access to selected streaming volunteers without full access', () => {
    const team = { ...TEAM, streamAccessMode: 'selected_volunteers', streamVolunteerEmails: [' Video@Example.com '] };
    const game = { id: 'game-1', status: 'scheduled' };

    expect(hasStreamTeamAccess({ uid: 'u5', email: 'video@example.com' }, team, game)).toBe(true);
    expect(hasFullTeamAccess({ uid: 'u5', email: 'video@example.com' }, team)).toBe(false);
    expect(getTeamAccessInfo({ uid: 'u5', email: 'video@example.com' }, team, { game })).toEqual({
      hasAccess: true,
      accessLevel: 'stream',
      exitUrl: 'team.html#teamId=team-1'
    });
  });

  it('grants limited stream access to confirmed members when enabled', () => {
    const team = { ...TEAM, streamAccessMode: 'confirmed_members' };
    const game = { id: 'game-1', status: 'scheduled' };

    expect(hasStreamTeamAccess({ uid: 'u6', email: 'parent@example.com' }, team, game, { response: 'going' })).toBe(true);
    expect(hasStreamTeamAccess({ uid: 'u6', email: 'parent@example.com' }, team, game, { response: 'maybe' })).toBe(false);
  });

  it('grants limited stream access to selected team permission members', () => {
    const team = {
      ...TEAM,
      teamPermissions: {
        streaming: { mode: 'selected', memberIds: [' selected-user ', 'selected-user'] }
      }
    };
    const game = { id: 'game-1', status: 'scheduled' };

    expect(hasStreamTeamAccess({ uid: 'selected-user', email: 'parent@example.com' }, team, game)).toBe(true);
    expect(getTeamAccessInfo({ uid: 'selected-user', email: 'parent@example.com' }, team, { game })).toEqual({
      hasAccess: true,
      accessLevel: 'stream',
      exitUrl: 'team.html#teamId=team-1'
    });
  });

  it('grants limited stream access to all confirmed team permission members', () => {
    const team = {
      ...TEAM,
      teamPermissions: {
        streaming: { mode: 'all_confirmed' }
      }
    };
    const game = { id: 'game-1', status: 'scheduled' };

    expect(hasStreamTeamAccess({ uid: 'u6', email: 'parent@example.com' }, team, game, { response: 'going' })).toBe(true);
    expect(hasStreamTeamAccess({ uid: 'u6', email: 'parent@example.com' }, team, game, { response: 'maybe' })).toBe(false);
  });

  it('denies limited stream access to unrelated users', () => {
    const team = { ...TEAM, streamAccessMode: 'selected_volunteers', streamVolunteerEmails: ['video@example.com'] };
    const game = { id: 'game-1', status: 'scheduled' };

    expect(hasStreamTeamAccess({ uid: 'u7', email: 'random@example.com' }, team, game)).toBe(false);
  });

  it('returns no access for unrelated users', () => {
    expect(getTeamAccessInfo({ uid: 'u5', email: 'random@example.com' }, TEAM)).toEqual({
      hasAccess: false,
      accessLevel: null,
      exitUrl: 'index.html'
    });
  });

  it('normalizes scoped volunteer permissions without granting admin access', () => {
    expect(normalizeTeamPermissions({
      scorekeeping: { mode: 'selected', memberIds: [' user-1 ', 'user-1', '', null, 'user-2'] },
      streaming: { mode: 'all_confirmed', memberIds: ['user-3'] },
      videography: { mode: 'selected', memberIds: [' video-1 ', 'video-1'] }
    })).toEqual({
      scorekeeping: { mode: 'selected', memberIds: ['user-1', 'user-2'] },
      streaming: { mode: 'all_confirmed', memberIds: [] },
      videography: { mode: 'selected', memberIds: ['video-1'] }
    });

    expect(hasFullTeamAccess({ uid: 'user-1' }, {
      ...TEAM,
      teamPermissions: {
        scorekeeping: { mode: 'selected', memberIds: ['user-1'] }
      }
    })).toBe(false);
  });

  it('defaults videography to selected members only', () => {
    expect(normalizeTeamPermissions()).toEqual({
      scorekeeping: { mode: 'all_confirmed', memberIds: [] },
      streaming: { mode: 'all_confirmed', memberIds: [] },
      videography: { mode: 'selected', memberIds: [] }
    });
  });

});
