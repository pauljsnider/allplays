// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  deleteAthleteProfileMediaByPath: vi.fn(),
  getAggregatedStatsForPlayer: vi.fn(),
  getGames: vi.fn(),
  getPlayerPrivateProfile: vi.fn(),
  getPlayerTrackingStatuses: vi.fn(),
  getPlayers: vi.fn(),
  getPublicTrackingItems: vi.fn(),
  getRosterFieldDefinitions: vi.fn(),
  getTeam: vi.fn(),
  inviteCoParentToAthlete: vi.fn(),
  listAthleteProfilesForParent: vi.fn(),
  listCertificatesForPlayer: vi.fn(),
  saveAthleteProfile: vi.fn(),
  setPlayerPrivateRosterProfileFields: vi.fn(),
  updatePlayer: vi.fn(),
  updatePlayerProfile: vi.fn(),
  uploadAthleteProfileMedia: vi.fn(),
  uploadPlayerPhoto: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/parent-incentives.js', () => ({
  calculateEarnings: vi.fn(),
  getApplicableRulesForGame: vi.fn(),
  getCapSetting: vi.fn(),
  getIncentiveRules: vi.fn(),
  getPaidGames: vi.fn(),
  getStatOptionsForTeam: vi.fn(),
  isCurrentRuleVersion: vi.fn(),
  markGamePaid: vi.fn(),
  retireIncentiveRule: vi.fn(),
  saveCapSetting: vi.fn(),
  saveIncentiveRule: vi.fn(),
  toggleIncentiveRule: vi.fn()
}));
vi.mock('../../../../js/athlete-profile-utils.js', () => ({
  buildAthleteProfileShareUrl: vi.fn(() => 'https://allplays.ai/athlete-profile.html?profileId=profile-1')
}));
vi.mock('../../../../js/player-profile-stats.js', () => ({
  collectPlayerVideoClips: vi.fn(() => [])
}));
vi.mock('../../../../js/player-tracking-summary.js', () => ({
  getVisiblePlayerTrackingSummary: vi.fn(() => [])
}));
vi.mock('./scheduleLogic', () => ({
  getOpenScheduleAssignments: vi.fn(() => []),
  normalizeRsvpResponse: vi.fn(() => 'not_responded')
}));
const scheduleServiceMocks = vi.hoisted(() => ({
  loadParentPlayerSchedule: vi.fn()
}));

vi.mock('./scheduleService', () => scheduleServiceMocks);
const appDataCacheMocks = vi.hoisted(() => ({
  clearAppDataCache: vi.fn()
}));

vi.mock('./appDataCache', () => appDataCacheMocks);

import { loadParentPlayerDetail, saveParentAthleteProfileDraft, savePlayerCustomRosterFieldValues, saveStaffPlayerRosterDetails } from './playerService';

describe('saveParentAthleteProfileDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.saveAthleteProfile.mockResolvedValue({ id: 'profile-1' });
  });

  it('passes caller-provided selectedSeasonKeys to saveAthleteProfile', async () => {
    await saveParentAthleteProfileDraft({
      user: {
        uid: 'parent-1',
        parentOf: [
          { teamId: 'team-current', playerId: 'player-current' },
          { teamId: 'team-prior', playerId: 'player-prior' }
        ]
      } as any,
      teamId: 'team-current',
      playerId: 'player-current',
      draft: {
        athlete: { name: 'Sam Player', headline: '2028 Guard' },
        bio: {},
        privacy: 'public',
        clips: [],
        selectedSeasonKeys: ['team-current::player-current', 'team-prior::player-prior']
      }
    });

    expect(dbMocks.saveAthleteProfile).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        selectedSeasonKeys: ['team-current::player-current', 'team-prior::player-prior']
      }),
      { profileId: expect.any(String) }
    );
  });
});


describe('saveStaffPlayerRosterDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      adminEmails: ['coach@example.com']
    });
    dbMocks.uploadPlayerPhoto.mockResolvedValue('https://cdn.example.com/photo.jpg');
    dbMocks.updatePlayer.mockResolvedValue(undefined);
  });

  it('updates only dirty public roster fields and clears app cache', async () => {
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

    const result = await saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: {
        name: 'Sam Player',
        number: '12',
        photoUrl: 'https://cdn.example.com/old.jpg'
      },
      name: 'Sam Player',
      number: '44',
      photoFile: file
    });

    expect(dbMocks.updatePlayer).toHaveBeenCalledWith('team-1', 'player-1', {
      number: '44',
      photoUrl: 'https://cdn.example.com/photo.jpg'
    });
    expect(dbMocks.setPlayerPrivateRosterProfileFields).not.toHaveBeenCalled();
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledWith();
    expect(result).toEqual({
      updatedFields: ['number', 'photoUrl'],
      payload: {
        number: '44',
        photoUrl: 'https://cdn.example.com/photo.jpg'
      }
    });
  });

  it('rejects roster edits from non-staff users', async () => {
    await expect(saveStaffPlayerRosterDetails({
      user: {
        uid: 'parent-1',
        email: 'parent@example.com',
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player', number: '12' },
      name: 'Sam Player',
      number: '12'
    })).rejects.toThrow('Only team staff can edit roster details.');

    expect(dbMocks.updatePlayer).not.toHaveBeenCalled();
    expect(appDataCacheMocks.clearAppDataCache).not.toHaveBeenCalled();
  });
});

describe('savePlayerCustomRosterFieldValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      adminEmails: ['coach@example.com']
    });
    dbMocks.getPlayers.mockResolvedValue([
      {
        id: 'player-1',
        profile: {
          position: 'Guard',
          customFields: {
            nickname: 'Rocket',
            stale: 'delete me'
          }
        }
      }
    ]);
    dbMocks.getPlayerPrivateProfile.mockResolvedValue({
      rosterFields: {
        jerseySize: 'YM'
      }
    });
    dbMocks.getRosterFieldDefinitions.mockResolvedValue([
      { key: 'nickname', label: 'Nickname', type: 'text', visibility: 'team', sortOrder: 1 },
      { key: 'jerseySize', label: 'Jersey Size', type: 'menu', visibility: 'admins', options: ['YS', 'YM'], sortOrder: 2 }
    ]);
    dbMocks.updatePlayer.mockResolvedValue(undefined);
    dbMocks.setPlayerPrivateRosterProfileFields.mockResolvedValue(undefined);
  });

  it('writes only currently defined custom roster values to public and private containers', async () => {
    await savePlayerCustomRosterFieldValues({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      values: {
        nickname: 'Speedy',
        jerseySize: 'YS',
        stale: 'must not resurrect deleted definitions'
      }
    });

    expect(dbMocks.updatePlayer).toHaveBeenCalledWith('team-1', 'player-1', {
      profile: {
        position: 'Guard',
        customFields: {
          nickname: 'Speedy'
        }
      }
    });
    expect(dbMocks.setPlayerPrivateRosterProfileFields).toHaveBeenCalledWith('team-1', 'player-1', {
      jerseySize: 'YS'
    });
  });

  it('rejects custom roster field edits from linked parent-only users', async () => {
    await expect(savePlayerCustomRosterFieldValues({
      user: {
        uid: 'parent-1',
        email: 'parent@example.com',
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      values: { nickname: 'Speedy' }
    })).rejects.toThrow('Only team owners and admins can edit custom roster fields.');

    expect(dbMocks.updatePlayer).not.toHaveBeenCalled();
    expect(dbMocks.setPlayerPrivateRosterProfileFields).not.toHaveBeenCalled();
  });

  it('rejects custom roster field edits from coachOf-only users without team admin rights', async () => {
    await expect(savePlayerCustomRosterFieldValues({
      user: {
        uid: 'coach-2',
        email: 'assistant@example.com',
        coachOf: ['team-1']
      } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      values: { nickname: 'Speedy' }
    })).rejects.toThrow('Only team owners and admins can edit custom roster fields.');

    expect(dbMocks.updatePlayer).not.toHaveBeenCalled();
    expect(dbMocks.setPlayerPrivateRosterProfileFields).not.toHaveBeenCalled();
  });
});


describe('loadParentPlayerDetail custom roster fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleServiceMocks.loadParentPlayerSchedule.mockResolvedValue({
      children: [{ teamId: 'team-1', teamName: 'Comets', playerId: 'player-1', playerName: 'Sam Player' }],
      events: []
    });
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      name: 'Comets',
      adminEmails: ['coach@example.com']
    });
    dbMocks.getPlayers.mockResolvedValue([
      {
        id: 'player-1',
        name: 'Sam Player',
        profile: {
          customFields: {
            nickname: 'Rocket'
          }
        }
      }
    ]);
    dbMocks.getPlayerPrivateProfile.mockResolvedValue({
      rosterFields: {
        jerseySize: 'YM'
      }
    });
    dbMocks.getRosterFieldDefinitions.mockResolvedValue([
      { key: 'nickname', label: 'Nickname', type: 'text', visibility: 'team', sortOrder: 1 },
      { key: 'jerseySize', label: 'Jersey Size', type: 'menu', visibility: 'admins', options: ['YS', 'YM'], sortOrder: 2 }
    ]);
    dbMocks.getGames.mockResolvedValue([]);
    dbMocks.listCertificatesForPlayer.mockResolvedValue([]);
    dbMocks.getPublicTrackingItems.mockResolvedValue([]);
    dbMocks.getPlayerTrackingStatuses.mockResolvedValue([]);
    dbMocks.listAthleteProfilesForParent.mockResolvedValue([]);
  });

  it('applies roster field privacy so parents do not receive admin-only custom values', async () => {
    const detail = await loadParentPlayerDetail({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(detail.customRosterFields).toEqual([
      expect.objectContaining({
        key: 'nickname',
        label: 'Nickname',
        value: 'Rocket'
      })
    ]);
    expect(detail.customRosterFields.some((field) => field.key === 'jerseySize')).toBe(false);
    expect(JSON.stringify(detail.customRosterFields)).not.toContain('YM');
  });

  it('includes admin-only custom roster fields for team staff', async () => {
    const detail = await loadParentPlayerDetail({
      uid: 'coach-1',
      email: 'coach@example.com',
      parentOf: []
    } as any, 'team-1', 'player-1');

    expect(detail.customRosterFields).toEqual([
      expect.objectContaining({ key: 'nickname', value: 'Rocket' }),
      expect.objectContaining({ key: 'jerseySize', value: 'YM' })
    ]);
    expect(detail.access.canEditCustomRosterFields).toBe(true);
  });

  it('allows staff to load a player detail route without a linked parent relationship', async () => {
    scheduleServiceMocks.loadParentPlayerSchedule.mockResolvedValue({
      children: [],
      events: []
    });

    const detail = await loadParentPlayerDetail({
      uid: 'coach-2',
      email: 'assistant@example.com',
      coachOf: ['team-1'],
      parentOf: []
    } as any, 'team-1', 'player-1');

    expect(detail.child).toEqual(expect.objectContaining({
      teamId: 'team-1',
      playerId: 'player-1',
      playerName: 'Sam Player'
    }));
    expect(detail.access.isTeamStaff).toBe(true);
  });

  it('keeps coachOf-only users read-only for custom roster fields', async () => {
    const detail = await loadParentPlayerDetail({
      uid: 'coach-2',
      email: 'assistant@example.com',
      coachOf: ['team-1'],
      parentOf: []
    } as any, 'team-1', 'player-1');

    expect(detail.access.isTeamStaff).toBe(true);
    expect(detail.access.canEditCustomRosterFields).toBe(false);
    expect(detail.customRosterFields).toEqual([
      expect.objectContaining({ key: 'nickname', value: 'Rocket' })
    ]);
    expect(detail.customRosterFields.some((field) => field.key === 'jerseySize')).toBe(false);
  });
});
