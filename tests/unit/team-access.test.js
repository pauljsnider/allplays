import { describe, it, expect } from 'vitest';
import { hasFullTeamAccess, hasScorekeepingTeamAccess, hasStreamTeamAccess, hasVideographerTeamAccess, hasTeamMediaAccess, getTeamAccessInfo, normalizeTeamPermissions } from '../../js/team-access.js';

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

  it('returns parent access level for users linked only by parent player keys', () => {
    expect(getTeamAccessInfo({ uid: 'u4', parentPlayerKeys: ['team-1::p1'] }, TEAM)).toEqual({
      hasAccess: true,
      accessLevel: 'parent',
      exitUrl: 'parent-dashboard.html'
    });
  });

  it('does not grant parent access from parent player keys for another team', () => {
    expect(getTeamAccessInfo({ uid: 'u4', parentPlayerKeys: ['team-2::p1'] }, TEAM)).toEqual({
      hasAccess: false,
      accessLevel: null,
      exitUrl: 'index.html'
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

  it('grants limited scorekeeper access to selected team permission members', () => {
    const team = {
      ...TEAM,
      teamPermissions: {
        scorekeeping: { mode: 'selected', memberIds: [' selected-user '] }
      }
    };
    const game = { id: 'game-1', status: 'scheduled' };

    expect(hasScorekeepingTeamAccess({ uid: 'selected-user' }, team, game)).toBe(true);
    expect(hasFullTeamAccess({ uid: 'selected-user' }, team)).toBe(false);
    expect(getTeamAccessInfo({ uid: 'selected-user' }, team, { game })).toEqual({
      hasAccess: true,
      accessLevel: 'scorekeep',
      exitUrl: 'team.html#teamId=team-1'
    });
  });

  it('returns combined stream and score access for volunteers with both permissions', () => {
    const team = {
      ...TEAM,
      teamPermissions: {
        scorekeeping: { mode: 'selected', memberIds: ['dual-volunteer'] },
        streaming: { mode: 'selected', memberIds: ['dual-volunteer'] }
      }
    };
    const game = { id: 'game-1', status: 'scheduled' };

    expect(hasScorekeepingTeamAccess({ uid: 'dual-volunteer' }, team, game)).toBe(true);
    expect(hasStreamTeamAccess({ uid: 'dual-volunteer' }, team, game)).toBe(true);
    expect(getTeamAccessInfo({ uid: 'dual-volunteer' }, team, { game })).toEqual({
      hasAccess: true,
      accessLevel: 'stream-score',
      exitUrl: 'team.html#teamId=team-1'
    });
  });

  it('denies selected scorekeeper access to admin-only management when the game is cancelled', () => {
    const team = {
      ...TEAM,
      teamPermissions: {
        scorekeeping: { mode: 'selected', memberIds: ['selected-user'] }
      }
    };

    expect(hasScorekeepingTeamAccess({ uid: 'selected-user' }, team, { id: 'game-1', status: 'cancelled' })).toBe(false);
    expect(getTeamAccessInfo({ uid: 'selected-user' }, team, { game: { id: 'game-1', status: 'cancelled' } })).toEqual({
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

  it('grants videographer access to selected videography memberIds', () => {
    const team = {
      ...TEAM,
      teamPermissions: {
        videography: { mode: 'selected', memberIds: [' vid-user ', 'vid-user'] }
      }
    };

    expect(hasVideographerTeamAccess({ uid: 'vid-user' }, team)).toBe(true);
    expect(hasFullTeamAccess({ uid: 'vid-user' }, team)).toBe(false);
    expect(getTeamAccessInfo({ uid: 'vid-user' }, team)).toEqual({
      hasAccess: true,
      accessLevel: 'videographer',
      exitUrl: 'team.html#teamId=team-1'
    });
  });

  it('denies videographer access to users not in the memberIds list', () => {
    const team = {
      ...TEAM,
      teamPermissions: {
        videography: { mode: 'selected', memberIds: ['vid-user'] }
      }
    };

    expect(hasVideographerTeamAccess({ uid: 'other-user' }, team)).toBe(false);
  });

  it('denies videographer access when teamPermissions.videography is absent', () => {
    expect(hasVideographerTeamAccess({ uid: 'vid-user' }, TEAM)).toBe(false);
  });

  it('videographer access is superseded by full access', () => {
    const team = {
      ...TEAM,
      teamPermissions: {
        videography: { mode: 'selected', memberIds: ['owner-1'] }
      }
    };

    expect(getTeamAccessInfo({ uid: 'owner-1' }, team)).toEqual({
      hasAccess: true,
      accessLevel: 'full',
      exitUrl: 'dashboard.html'
    });
  });

  it('grants media access to delegated Team Media upload members without full access', () => {
    expect(hasTeamMediaAccess({ uid: 'media-user', teamMediaUploadTeamIds: [' team-1 '] }, TEAM)).toBe(true);
    expect(hasTeamMediaAccess({ uid: 'legacy-media-user', mediaUploadTeamIds: ['team-1'] }, TEAM)).toBe(true);
    expect(hasFullTeamAccess({ uid: 'media-user', teamMediaUploadTeamIds: ['team-1'] }, TEAM)).toBe(false);
    expect(getTeamAccessInfo({ uid: 'media-user', teamMediaUploadTeamIds: ['team-1'] }, TEAM)).toEqual({
      hasAccess: true,
      accessLevel: 'media',
      exitUrl: 'team.html#teamId=team-1'
    });
  });

  it('does not grant media access from upload grants for another team', () => {
    expect(hasTeamMediaAccess({ uid: 'media-user', teamMediaUploadTeamIds: ['other-team'] }, TEAM)).toBe(false);
    expect(getTeamAccessInfo({ uid: 'media-user', teamMediaUploadTeamIds: ['other-team'] }, TEAM)).toEqual({
      hasAccess: false,
      accessLevel: null,
      exitUrl: 'index.html'
    });
  });

});
