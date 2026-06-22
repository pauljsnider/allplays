// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyPlayerDbMocks = vi.hoisted(() => ({
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

const legacyPlayerProfileMocks = vi.hoisted(() => ({
  calculateEarnings: vi.fn(() => ({ totalCents: 0, uncappedTotalCents: 0, wasCapped: false, breakdown: [] })),
  buildAthleteProfileShareUrl: vi.fn(() => 'https://allplays.ai/athlete-profile.html?profileId=profile-1'),
  collectPlayerVideoClips: vi.fn(() => []),
  getApplicableRulesForGame: vi.fn((rules) => rules),
  getCapSetting: vi.fn().mockResolvedValue(null),
  getIncentiveRules: vi.fn().mockResolvedValue([]),
  getPaidGames: vi.fn().mockResolvedValue(new Map()),
  getStatOptionsForTeam: vi.fn().mockResolvedValue([]),
  getVisiblePlayerTrackingSummary: vi.fn(() => []),
  isCurrentRuleVersion: vi.fn(() => true),
  markGamePaid: vi.fn(),
  retireIncentiveRule: vi.fn(),
  saveCapSetting: vi.fn(),
  saveIncentiveRule: vi.fn(),
  toggleIncentiveRule: vi.fn()
}));
const legacyRosterPrivacyMocks = vi.hoisted(() => ({
  canViewRosterField: vi.fn((field, access) => {
    if (field?.visibility === 'admins') return Boolean(access?.isAdmin);
    if (field?.visibility === 'team' || field?.visibility === 'parents') {
      return Boolean(access?.isAdmin || access?.isTeamMember || access?.isLinkedParent);
    }
    return true;
  }),
  getRosterProfileValues: vi.fn((player) => ({
    ...(player?.rosterFieldValues || {}),
    ...(player?.customFields || {}),
    ...(player?.profile?.rosterFields || {}),
    ...(player?.profile?.customFields || {})
  })),
  normalizeRosterFieldDefinitions: vi.fn((fields) => fields),
  splitRosterProfileValuesByVisibility: vi.fn((fields, values) => ({
    publicValues: Object.fromEntries(Object.entries(values || {}).filter(([key]) => !fields.find((field: any) => field.key === key && field.visibility === 'admins'))),
    privateValues: Object.fromEntries(Object.entries(values || {}).filter(([key]) => !!fields.find((field: any) => field.key === key && field.visibility === 'admins')))
  })),
  validateRosterProfileValues: vi.fn(() => [])
}));

vi.mock('./adapters/legacyPlayerDb', () => legacyPlayerDbMocks);
vi.mock('./adapters/legacyPlayerProfile', () => legacyPlayerProfileMocks);
vi.mock('./adapters/legacyRosterPrivacy', () => legacyRosterPrivacyMocks);
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
    legacyPlayerDbMocks.saveAthleteProfile.mockResolvedValue({ id: 'profile-1' });
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

    expect(legacyPlayerDbMocks.saveAthleteProfile).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        selectedSeasonKeys: ['team-current::player-current', 'team-prior::player-prior']
      }),
      { profileId: expect.any(String) }
    );
  });

  it('uploads profile headshots and highlight clips into the saved athlete profile', async () => {
    const headshot = new File(['headshot'], 'headshot.png', { type: 'image/png' });
    const clip = new File(['clip-data'], 'fast-break.mp4', { type: 'video/mp4' });
    legacyPlayerDbMocks.uploadAthleteProfileMedia
      .mockResolvedValueOnce({
        url: 'https://cdn.example.com/headshot.png',
        storagePath: 'profiles/profile-1/headshot.png',
        mediaType: 'image',
        mimeType: 'image/png',
        sizeBytes: headshot.size,
        uploadedAtMs: 100
      })
      .mockResolvedValueOnce({
        url: 'https://cdn.example.com/fast-break.mp4',
        storagePath: 'profiles/profile-1/fast-break.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
        sizeBytes: clip.size,
        uploadedAtMs: 200
      });
    legacyPlayerDbMocks.saveAthleteProfile.mockImplementation(async (_userId, nextDraft, options) => ({
      id: options.profileId,
      ...nextDraft
    }));

    const result = await saveParentAthleteProfileDraft({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-current', playerId: 'player-current' }]
      } as any,
      teamId: 'team-current',
      playerId: 'player-current',
      profileId: 'profile-1',
      draft: {
        athlete: { name: 'Sam Player' },
        bio: {},
        privacy: 'public',
        profilePhoto: null,
        clips: [{ id: 'existing-clip', title: 'Existing clip' }]
      },
      profilePhotoFile: headshot,
      highlightClipFile: clip,
      highlightClipTitle: 'Fast break'
    });

    expect(legacyPlayerDbMocks.uploadAthleteProfileMedia).toHaveBeenNthCalledWith(1, 'parent-1', 'profile-1', headshot, { kind: 'profile-photo' });
    expect(legacyPlayerDbMocks.uploadAthleteProfileMedia).toHaveBeenNthCalledWith(2, 'parent-1', 'profile-1', clip, { kind: 'clip' });
    expect(legacyPlayerDbMocks.saveAthleteProfile).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        profilePhoto: expect.objectContaining({
          url: 'https://cdn.example.com/headshot.png',
          storagePath: 'profiles/profile-1/headshot.png',
          mimeType: 'image/png',
          mediaType: 'image'
        }),
        clips: [
          { id: 'existing-clip', title: 'Existing clip' },
          expect.objectContaining({
            source: 'upload',
            mediaType: 'video',
            title: 'Fast break',
            url: 'https://cdn.example.com/fast-break.mp4',
            storagePath: 'profiles/profile-1/fast-break.mp4',
            mimeType: 'video/mp4'
          })
        ],
        selectedSeasonKeys: ['team-current::player-current']
      }),
      { profileId: 'profile-1' }
    );
    expect(result.shareUrl).toBe('https://allplays.ai/athlete-profile.html?profileId=profile-1');
    expect(result.builderUrl).toContain('athlete-profile-builder.html');
  });

  it('removes an uploaded headshot when the highlight clip upload fails', async () => {
    const headshot = new File(['headshot'], 'headshot.png', { type: 'image/png' });
    const clip = new File(['clip-data'], 'clip.mp4', { type: 'video/mp4' });
    legacyPlayerDbMocks.deleteAthleteProfileMediaByPath.mockResolvedValue(undefined);
    legacyPlayerDbMocks.uploadAthleteProfileMedia
      .mockResolvedValueOnce({
        url: 'https://cdn.example.com/headshot.png',
        storagePath: 'athleteProfiles/profile-rollback/profile-photo/headshot.png',
        mimeType: 'image/png',
        sizeBytes: headshot.size,
        uploadedAtMs: 111,
        mediaType: 'image'
      })
      .mockRejectedValueOnce(new Error('clip upload failed'));

    await expect(saveParentAthleteProfileDraft({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-current', playerId: 'player-current' }]
      } as any,
      teamId: 'team-current',
      playerId: 'player-current',
      profileId: 'profile-rollback',
      draft: {
        athlete: { name: 'Sam Player' },
        bio: {},
        privacy: 'public',
        clips: []
      },
      profilePhotoFile: headshot,
      highlightClipFile: clip
    })).rejects.toThrow('clip upload failed');

    expect(legacyPlayerDbMocks.deleteAthleteProfileMediaByPath).toHaveBeenCalledWith('athleteProfiles/profile-rollback/profile-photo/headshot.png');
    expect(legacyPlayerDbMocks.saveAthleteProfile).not.toHaveBeenCalled();
  });

  it('rejects invalid athlete profile media before upload or save', async () => {
    await expect(saveParentAthleteProfileDraft({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-current', playerId: 'player-current' }]
      } as any,
      teamId: 'team-current',
      playerId: 'player-current',
      draft: {
        athlete: { name: 'Sam Player' },
        bio: {},
        privacy: 'private',
        clips: []
      },
      profilePhotoFile: new File(['not image'], 'notes.txt', { type: 'text/plain' })
    })).rejects.toThrow('Player photos must be image files.');

    await expect(saveParentAthleteProfileDraft({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-current', playerId: 'player-current' }]
      } as any,
      teamId: 'team-current',
      playerId: 'player-current',
      draft: {
        athlete: { name: 'Sam Player' },
        bio: {},
        privacy: 'private',
        clips: []
      },
      highlightClipFile: {
        name: 'huge.mp4',
        type: 'video/mp4',
        size: 101 * 1024 * 1024
      } as File
    })).rejects.toThrow('Choose a highlight clip under 100 MB.');

    expect(legacyPlayerDbMocks.uploadAthleteProfileMedia).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.saveAthleteProfile).not.toHaveBeenCalled();
  });
});


describe('saveStaffPlayerRosterDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyPlayerDbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      adminEmails: ['coach@example.com']
    });
    legacyPlayerDbMocks.uploadPlayerPhoto.mockResolvedValue('https://cdn.example.com/photo.jpg');
    legacyPlayerDbMocks.updatePlayer.mockResolvedValue(undefined);
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

    expect(legacyPlayerDbMocks.updatePlayer).toHaveBeenCalledWith('team-1', 'player-1', {
      number: '44',
      photoUrl: 'https://cdn.example.com/photo.jpg'
    });
    expect(legacyPlayerDbMocks.setPlayerPrivateRosterProfileFields).not.toHaveBeenCalled();
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledWith();
    expect(result).toEqual({
      updatedFields: ['number', 'photoUrl'],
      payload: {
        number: '44',
        photoUrl: 'https://cdn.example.com/photo.jpg'
      }
    });
  });

  it('rejects roster edits from parent-only users', async () => {
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
    })).rejects.toThrow('Only team owners and admins can edit roster details.');

    expect(legacyPlayerDbMocks.updatePlayer).not.toHaveBeenCalled();
    expect(appDataCacheMocks.clearAppDataCache).not.toHaveBeenCalled();
  });

  it('rejects roster edits from coachOf-only users without team admin rights', async () => {
    await expect(saveStaffPlayerRosterDetails({
      user: {
        uid: 'coach-2',
        email: 'assistant@example.com',
        coachOf: ['team-1']
      } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player', number: '12' },
      name: 'Sam Player',
      number: '12'
    })).rejects.toThrow('Only team owners and admins can edit roster details.');

    expect(legacyPlayerDbMocks.updatePlayer).not.toHaveBeenCalled();
    expect(appDataCacheMocks.clearAppDataCache).not.toHaveBeenCalled();
  });
});

describe('savePlayerCustomRosterFieldValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyPlayerDbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      adminEmails: ['coach@example.com']
    });
    legacyPlayerDbMocks.getPlayers.mockResolvedValue([
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
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockResolvedValue({
      rosterFields: {
        jerseySize: 'YM'
      }
    });
    legacyPlayerDbMocks.getRosterFieldDefinitions.mockResolvedValue([
      { key: 'nickname', label: 'Nickname', type: 'text', visibility: 'team', sortOrder: 1 },
      { key: 'jerseySize', label: 'Jersey Size', type: 'menu', visibility: 'admins', options: ['YS', 'YM'], sortOrder: 2 }
    ]);
    legacyPlayerDbMocks.updatePlayer.mockResolvedValue(undefined);
    legacyPlayerDbMocks.setPlayerPrivateRosterProfileFields.mockResolvedValue(undefined);
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

    expect(legacyPlayerDbMocks.updatePlayer).toHaveBeenCalledWith('team-1', 'player-1', {
      profile: {
        position: 'Guard',
        customFields: {
          nickname: 'Speedy'
        }
      }
    });
    expect(legacyPlayerDbMocks.setPlayerPrivateRosterProfileFields).toHaveBeenCalledWith('team-1', 'player-1', {
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

    expect(legacyPlayerDbMocks.updatePlayer).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.setPlayerPrivateRosterProfileFields).not.toHaveBeenCalled();
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

    expect(legacyPlayerDbMocks.updatePlayer).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.setPlayerPrivateRosterProfileFields).not.toHaveBeenCalled();
  });
});


describe('loadParentPlayerDetail custom roster fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleServiceMocks.loadParentPlayerSchedule.mockResolvedValue({
      children: [{ teamId: 'team-1', teamName: 'Comets', playerId: 'player-1', playerName: 'Sam Player' }],
      events: []
    });
    legacyPlayerDbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      name: 'Comets',
      adminEmails: ['coach@example.com']
    });
    legacyPlayerDbMocks.getPlayers.mockResolvedValue([
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
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockResolvedValue({
      rosterFields: {
        jerseySize: 'YM'
      }
    });
    legacyPlayerDbMocks.getRosterFieldDefinitions.mockResolvedValue([
      { key: 'nickname', label: 'Nickname', type: 'text', visibility: 'team', sortOrder: 1 },
      { key: 'jerseySize', label: 'Jersey Size', type: 'menu', visibility: 'admins', options: ['YS', 'YM'], sortOrder: 2 }
    ]);
    legacyPlayerDbMocks.getGames.mockResolvedValue([]);
    legacyPlayerDbMocks.listCertificatesForPlayer.mockResolvedValue([]);
    legacyPlayerDbMocks.getPublicTrackingItems.mockResolvedValue([]);
    legacyPlayerDbMocks.getPlayerTrackingStatuses.mockResolvedValue([]);
    legacyPlayerDbMocks.listAthleteProfilesForParent.mockResolvedValue([]);
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
    expect(detail.access.canEditRosterDetails).toBe(true);
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
    expect(detail.access.canEditRosterDetails).toBe(false);
    expect(detail.access.canEditCustomRosterFields).toBe(false);
    expect(detail.customRosterFields).toEqual([
      expect.objectContaining({ key: 'nickname', value: 'Rocket' })
    ]);
    expect(detail.customRosterFields.some((field) => field.key === 'jerseySize')).toBe(false);
  });
});
