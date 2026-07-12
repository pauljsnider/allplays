// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
