// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAppDataCache,
  getTeamsSummaryBootstrapCacheKey,
  loadCachedAppData
} from './appDataCache';

const legacyMocks = vi.hoisted(() => ({
  createTeam: vi.fn(),
  createConfig: vi.fn(),
  getDefaultStatConfigForSport: vi.fn(),
  getStatConfigPresetOptions: vi.fn()
}));

vi.mock('./adapters/legacyTeamCreation', () => legacyMocks);

import { createTeamForApp, getCreateTeamSportOptions } from './teamCreationService';

const user = {
  uid: 'coach-1',
  email: 'coach@example.com',
  displayName: 'Coach'
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  clearAppDataCache();
  legacyMocks.createTeam.mockResolvedValue('team-new');
  legacyMocks.createConfig.mockResolvedValue('config-new');
  legacyMocks.getDefaultStatConfigForSport.mockReturnValue({ name: 'Soccer Standard', baseType: 'Soccer' });
  legacyMocks.getStatConfigPresetOptions.mockReturnValue([
    { baseType: 'Custom' },
    { baseType: 'Basketball' },
    { baseType: 'Soccer' },
    { baseType: 'Basketball' }
  ]);
});

describe('createTeamForApp', () => {
  it('creates a team with owner fields and adds the default sport stat config', async () => {
    const result = await createTeamForApp(user, {
      name: '  KC Current U12  ',
      sport: ' Soccer ',
      zip: '66210-1234',
      isPublic: false
    });

    expect(result).toEqual({
      teamId: 'team-new',
      defaultStatConfigCreated: true,
      defaultStatConfigError: null
    });
    expect(legacyMocks.createTeam).toHaveBeenCalledWith({
      name: 'KC Current U12',
      sport: 'Soccer',
      zip: '662101234',
      isPublic: false,
      ownerId: 'coach-1',
      ownerEmail: 'coach@example.com',
      adminEmails: []
    });
    expect(legacyMocks.getDefaultStatConfigForSport).toHaveBeenCalledWith('Soccer');
    expect(legacyMocks.createConfig).toHaveBeenCalledWith('team-new', { name: 'Soccer Standard', baseType: 'Soccer' });
  });

  it('invalidates only the creator team-summary cache after the team write succeeds', async () => {
    const creatorCacheKey = getTeamsSummaryBootstrapCacheKey(user.uid);
    const otherCacheKey = getTeamsSummaryBootstrapCacheKey('coach-2');
    await loadCachedAppData(creatorCacheKey, async () => 'stale creator teams', { persist: false });
    await loadCachedAppData(otherCacheKey, async () => 'other coach teams', { persist: false });

    await createTeamForApp(user, { name: 'Team', sport: 'Soccer' });

    const reloadCreatorTeams = vi.fn(async () => 'creator teams with new team');
    const reloadOtherTeams = vi.fn(async () => 'unexpected reload');
    await expect(loadCachedAppData(creatorCacheKey, reloadCreatorTeams, { persist: false }))
      .resolves.toBe('creator teams with new team');
    await expect(loadCachedAppData(otherCacheKey, reloadOtherTeams, { persist: false }))
      .resolves.toBe('other coach teams');
    expect(reloadCreatorTeams).toHaveBeenCalledTimes(1);
    expect(reloadOtherTeams).not.toHaveBeenCalled();
  });

  it('returns a non-blocking warning when the stat config write fails after team creation', async () => {
    legacyMocks.createConfig.mockRejectedValueOnce(new Error('permission denied'));

    await expect(createTeamForApp(user, {
      name: 'Team',
      sport: 'Basketball',
      zip: '12345',
      isPublic: true
    })).resolves.toEqual({
      teamId: 'team-new',
      defaultStatConfigCreated: false,
      defaultStatConfigError: 'permission denied'
    });
    expect(legacyMocks.createTeam).toHaveBeenCalledTimes(1);
  });

  it('returns the created team id when preset resolution fails after the team write', async () => {
    legacyMocks.getDefaultStatConfigForSport.mockImplementationOnce(() => {
      throw new Error('preset unavailable');
    });

    await expect(createTeamForApp(user, {
      name: 'Team',
      sport: 'Basketball',
      zip: '12345',
      isPublic: true
    })).resolves.toEqual({
      teamId: 'team-new',
      defaultStatConfigCreated: false,
      defaultStatConfigError: 'preset unavailable'
    });
    expect(legacyMocks.createTeam).toHaveBeenCalledTimes(1);
    expect(legacyMocks.createConfig).not.toHaveBeenCalled();
  });

  it('skips default stat config creation when no sport preset exists', async () => {
    legacyMocks.getDefaultStatConfigForSport.mockReturnValueOnce(null);

    await expect(createTeamForApp(user, {
      name: 'Curling Club',
      sport: 'Curling'
    })).resolves.toEqual({
      teamId: 'team-new',
      defaultStatConfigCreated: false,
      defaultStatConfigError: null
    });
    expect(legacyMocks.createConfig).not.toHaveBeenCalled();
  });

  it('does not attempt config creation when the team write fails or returns no id', async () => {
    legacyMocks.createTeam.mockRejectedValueOnce(new Error('team write failed'));

    await expect(createTeamForApp(user, {
      name: 'Team',
      sport: 'Soccer'
    })).rejects.toThrow('team write failed');
    expect(legacyMocks.createConfig).not.toHaveBeenCalled();

    legacyMocks.createTeam.mockResolvedValueOnce('  ');

    await expect(createTeamForApp(user, {
      name: 'Team',
      sport: 'Soccer'
    })).rejects.toThrow('Team could not be created.');
    expect(legacyMocks.createConfig).not.toHaveBeenCalled();
  });

  it('validates required creator and team fields before writing', async () => {
    await expect(createTeamForApp(null, { name: 'Team', sport: 'Soccer' })).rejects.toThrow('Sign in to create a team.');
    await expect(createTeamForApp(user, { name: ' ', sport: 'Soccer' })).rejects.toThrow('Team name is required.');
    await expect(createTeamForApp(user, { name: 'Team', sport: ' ' })).rejects.toThrow('Sport is required.');
    expect(legacyMocks.createTeam).not.toHaveBeenCalled();
  });
});

describe('getCreateTeamSportOptions', () => {
  it('derives unique sports from default stat config presets', () => {
    expect(getCreateTeamSportOptions()).toEqual(['Basketball', 'Soccer']);
  });

  it('keeps every built-in sport available when the preset catalog is empty', () => {
    legacyMocks.getStatConfigPresetOptions.mockReturnValueOnce([]);

    expect(getCreateTeamSportOptions()).toEqual([
      'Basketball',
      'Soccer',
      'Baseball',
      'Softball',
      'Football',
      'Volleyball'
    ]);
  });
});
