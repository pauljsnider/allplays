// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyPlayerDbMocks = vi.hoisted(() => ({
  collectRosterParentContacts: vi.fn((): any[] => []),
  deleteAthleteProfileMediaByPath: vi.fn(),
  deleteLegacyImageUpload: vi.fn(),
  getAggregatedStatsForGames: vi.fn(),
  getAggregatedStatsDocumentForPlayer: vi.fn(),
  getDiamondPublicPlayerStatDocument: vi.fn(),
  getAggregatedStatsForPlayer: vi.fn(),
  getConfigs: vi.fn(),
  getGameEvents: vi.fn(),
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
  releaseAthleteProfileMediaReservation: vi.fn(),
  reserveAthleteProfileMediaOwnership: vi.fn(),
  saveAthleteProfile: vi.fn(),
  setPlayerPrivateRosterProfileFields: vi.fn(),
  updatePlayer: vi.fn(),
  updatePlayerWithPrivateRosterProfileFields: vi.fn(),
  updatePlayerPrivateProfile: vi.fn(),
  updatePlayerProfile: vi.fn(),
  uploadAthleteProfileMedia: vi.fn(),
  uploadPlayerPhoto: vi.fn()
}));

const legacyPlayerProfileMocks = vi.hoisted(() => ({
  calculateEarnings: vi.fn(() => ({ totalCents: 0, uncappedTotalCents: 0, wasCapped: false, breakdown: [] })),
  buildPlayerLeaderboardSnapshot: vi.fn(() => ({ topStats: [] })),
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
  selectAnalyticsConfig: vi.fn(() => null),
  summarizePlayerTopStats: vi.fn(() => []),
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
  splitProtectedRosterProfileValues: vi.fn((profile) => {
    const protectedKeys = new Set(['birthDate', 'gender', 'grade', 'school', 'jerseySize', 'memberId', 'dominantHandFoot', 'address']);
    const publicProfile = { ...(profile || {}) };
    const privateValues: Record<string, unknown> = {};
    protectedKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(publicProfile, key)) {
        privateValues[key] = publicProfile[key];
        delete publicProfile[key];
      }
    });
    if (publicProfile.customFields && typeof publicProfile.customFields === 'object') {
      publicProfile.customFields = { ...publicProfile.customFields };
      protectedKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(publicProfile.customFields, key)) {
          privateValues[key] = publicProfile.customFields[key];
          delete publicProfile.customFields[key];
        }
      });
    }
    return { publicProfile, privateValues };
  }),
  splitRosterProfileValuesByVisibility: vi.fn((fields, values) => ({
    publicValues: Object.fromEntries(Object.entries(values || {}).filter(([key]) => fields.find((field: any) => field.key === key && field.visibility === 'public' && !['birthDate', 'gender', 'grade', 'school', 'jerseySize', 'memberId', 'dominantHandFoot', 'address'].includes(key)))),
    privateValues: Object.fromEntries(Object.entries(values || {}).filter(([key]) => fields.find((field: any) => field.key === key && (['birthDate', 'gender', 'grade', 'school', 'jerseySize', 'memberId', 'dominantHandFoot', 'address'].includes(key) || field.visibility === 'team' || field.visibility === 'parents'))))
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
const profileServiceMocks = vi.hoisted(() => ({
  loadProfileDocument: vi.fn()
}));

vi.mock('./profileService', () => profileServiceMocks);
const appDataCacheMocks = vi.hoisted(() => ({
  clearAppDataCache: vi.fn(),
  loadCachedAppData: vi.fn((_key, loader, _options?: any) => loader())
}));

vi.mock('./appDataCache', () => appDataCacheMocks);
const nativeRuntimeState = vi.hoisted(() => ({ isNative: false }));
const nativeStorageMocks = vi.hoisted(() => ({
  deleteNativePrimaryStorageFile: vi.fn(),
  uploadNativePlayerPhoto: vi.fn(),
  uploadNativePlayerPhotoFile: vi.fn()
}));
const nativeFirestoreMutationMocks = vi.hoisted(() => ({
  commitNativeFirestoreWrites: vi.fn()
}));
const diamondManagerStatsMocks = vi.hoisted(() => ({
  loadDiamondManagerStats: vi.fn()
}));
const gameReportMocks = vi.hoisted(() => ({
  loadGameReportPlays: vi.fn()
}));

vi.mock('./nativeRuntime', () => ({
  isNativeRuntime: () => nativeRuntimeState.isNative
}));
vi.mock('./nativeStorageUpload', () => nativeStorageMocks);
vi.mock('./nativeFirestoreMutation', () => nativeFirestoreMutationMocks);
vi.mock('./diamondManagerStatsService', () => ({
  DIAMOND_MANAGER_STATS_MAX_GAMES: 40,
  DIAMOND_MANAGER_STATS_MAX_PLAYERS: 25,
  loadDiamondManagerStats: diamondManagerStatsMocks.loadDiamondManagerStats
}));
vi.mock('./gameReportService', () => gameReportMocks);

import {
  loadParentPlayerAthleteProfile,
  loadParentPlayerDetail,
  loadParentPlayerDetailWithAthleteProfile,
  loadParentPlayerStatTotals,
  loadParentPlayerStatsDetail,
  loadParentPlayerVideoClips,
  normalizeAthleteProfileHighlightClipUrl,
  resolvePlayerDiamondStatDocument,
  saveParentAthleteProfileDraft,
  savePlayerCustomRosterFieldValues,
  saveStaffPlayerRosterDetails,
  updateParentPlayerEditableProfile
} from './playerService';

describe('Diamond player season absence evidence', () => {
  const game = {
    id: 'game-1',
    trackingEngine: 'diamond-v2',
    diamondProjectionStatus: 'current',
    diamondProjectionComplete: true,
    diamondScorebookInstanceId: '00000000-0000-4000-8000-000000000001',
    diamondProjectionRevision: 8,
    diamondProjectionCheckpointHash: `sha256:${'a'.repeat(64)}`,
    diamondStatConfigSnapshotHash: `sha256:${'b'.repeat(64)}`,
    diamondProjectionHash: `sha256:${'c'.repeat(64)}`
  };

  it('accepts confirmed DNP/roster absence but never turns a public read failure into absence', () => {
    expect(resolvePlayerDiamondStatDocument({
      playerId: 'p1', game, publicDocument: {}, privateDocument: null,
      privateLoadStatus: 'complete', publicLoadStatus: 'complete'
    })).toMatchObject({ statVisibility: 'manager-internal', privateStatsStatus: 'complete', absenceConfirmed: true });

    expect(resolvePlayerDiamondStatDocument({
      playerId: 'p1', game, publicDocument: {}, privateDocument: null,
      privateLoadStatus: 'complete', publicLoadStatus: 'unavailable'
    })).toMatchObject({ statVisibility: 'public', privateStatsStatus: 'unavailable', absenceConfirmed: false });

    expect(resolvePlayerDiamondStatDocument({
      playerId: 'p1', game: { ...game, diamondProjectionHash: '' }, publicDocument: {}, privateDocument: null,
      privateLoadStatus: 'complete', publicLoadStatus: 'complete'
    })).toMatchObject({ statVisibility: 'public', absenceConfirmed: false });
  });
});

beforeEach(() => {
  nativeRuntimeState.isNative = false;
  diamondManagerStatsMocks.loadDiamondManagerStats.mockResolvedValue({
    status: 'unavailable',
    reason: 'private-read-unavailable',
    documentsByGameId: new Map(),
    teamDocumentsByGameId: new Map()
  });
});

describe('saveParentAthleteProfileDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyPlayerDbMocks.saveAthleteProfile.mockResolvedValue({ id: 'profile-1' });
    legacyPlayerDbMocks.reserveAthleteProfileMediaOwnership.mockImplementation(async (_userId, profileId) => ({ id: profileId, created: false }));
    legacyPlayerDbMocks.releaseAthleteProfileMediaReservation.mockResolvedValue(true);
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
      { profileId: expect.any(String), isNewProfile: true }
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
        clips: [{ id: 'existing-clip', source: 'external', mediaType: 'link', title: 'Existing clip', url: 'https://video.example/existing' }]
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
          expect.objectContaining({
            id: 'existing-clip',
            source: 'external',
            mediaType: 'link',
            title: 'Existing clip',
            url: 'https://video.example/existing'
          }),
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

  it('saves ordered legacy-compatible clip lists with add remove reorder and upload placeholders', async () => {
    const clip = new File(['clip-data'], 'putback.mp4', { type: 'video/mp4' });
    legacyPlayerDbMocks.uploadAthleteProfileMedia.mockResolvedValueOnce({
      url: 'https://cdn.example.com/putback.mp4',
      storagePath: 'athlete-profile-media/parent-1/profile-1/putback.mp4',
      mediaType: 'video',
      mimeType: 'video/mp4',
      sizeBytes: clip.size,
      uploadedAtMs: 300
    });
    legacyPlayerDbMocks.saveAthleteProfile.mockImplementation(async (_userId, nextDraft, options) => ({
      id: options.profileId,
      ...nextDraft
    }));

    await saveParentAthleteProfileDraft({
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
        privacy: 'private',
        clips: [
          {
            id: 'clip-youtube',
            source: 'external',
            mediaType: 'link',
            title: 'Corner three',
            label: 'Semifinal',
            url: ' https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s '
          },
          {
            id: 'clip-upload-new',
            source: 'upload',
            mediaType: 'video',
            title: 'Putback',
            label: 'Finals',
            pendingUpload: true
          },
          {
            id: 'clip-kept',
            source: 'upload',
            mediaType: 'video',
            title: 'Existing kept clip',
            label: '',
            url: 'https://cdn.example.com/kept.mp4',
            storagePath: 'athlete-profile-media/parent-1/profile-1/kept.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 2048,
            uploadedAtMs: 100
          }
        ]
      },
      highlightClipUploads: [{ id: 'clip-upload-new', file: clip, title: 'Putback', label: 'Finals' }]
    });

    expect(legacyPlayerDbMocks.uploadAthleteProfileMedia).toHaveBeenCalledWith('parent-1', 'profile-1', clip, { kind: 'clip' });
    expect(legacyPlayerDbMocks.saveAthleteProfile).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        clips: [
          {
            id: 'clip-youtube',
            source: 'external',
            mediaType: 'link',
            title: 'Corner three',
            label: 'Semifinal',
            url: 'https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s',
            storagePath: '',
            mimeType: '',
            sizeBytes: null,
            uploadedAtMs: null
          },
          {
            id: 'clip-upload-new',
            source: 'upload',
            mediaType: 'video',
            title: 'Putback',
            label: 'Finals',
            url: 'https://cdn.example.com/putback.mp4',
            storagePath: 'athlete-profile-media/parent-1/profile-1/putback.mp4',
            mimeType: 'video/mp4',
            sizeBytes: clip.size,
            uploadedAtMs: 300
          },
          {
            id: 'clip-kept',
            source: 'upload',
            mediaType: 'video',
            title: 'Existing kept clip',
            label: '',
            url: 'https://cdn.example.com/kept.mp4',
            storagePath: 'athlete-profile-media/parent-1/profile-1/kept.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 2048,
            uploadedAtMs: 100
          }
        ]
      }),
      { profileId: 'profile-1' }
    );
  });

  it('validates external athlete profile clip links before save', async () => {
    expect(normalizeAthleteProfileHighlightClipUrl(' https://youtu.be/LJNfHqRRhBI ')).toBe('https://youtu.be/LJNfHqRRhBI');
    expect(normalizeAthleteProfileHighlightClipUrl('https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s')).toBe('https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s');
    expect(normalizeAthleteProfileHighlightClipUrl('https://www.hudl.com/video/3/123')).toBe('https://www.hudl.com/video/3/123');
    expect(() => normalizeAthleteProfileHighlightClipUrl('javascript:alert(1)')).toThrow('http or https');
    expect(() => normalizeAthleteProfileHighlightClipUrl('not a url')).toThrow('valid highlight clip link');

    await expect(saveParentAthleteProfileDraft({
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
        privacy: 'private',
        clips: [{ id: 'clip-bad', source: 'external', url: 'ftp://video.example/clip.mp4' }]
      }
    })).rejects.toThrow('http or https');

    expect(legacyPlayerDbMocks.uploadAthleteProfileMedia).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.saveAthleteProfile).not.toHaveBeenCalled();
  });

  it('cleans up uploaded athlete profile media when clip link validation fails', async () => {
    const headshot = new File(['headshot'], 'headshot.png', { type: 'image/png' });
    const clip = new File(['clip-data'], 'putback.mp4', { type: 'video/mp4' });
    legacyPlayerDbMocks.deleteAthleteProfileMediaByPath.mockResolvedValue(undefined);
    legacyPlayerDbMocks.uploadAthleteProfileMedia
      .mockResolvedValueOnce({
        url: 'https://cdn.example.com/headshot.png',
        storagePath: 'athlete-profile-media/parent-1/profile-1/headshot.png',
        mediaType: 'image',
        mimeType: 'image/png',
        sizeBytes: headshot.size,
        uploadedAtMs: 100
      })
      .mockResolvedValueOnce({
        url: 'https://cdn.example.com/putback.mp4',
        storagePath: 'athlete-profile-media/parent-1/profile-1/putback.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
        sizeBytes: clip.size,
        uploadedAtMs: 200
      });

    await expect(saveParentAthleteProfileDraft({
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
        privacy: 'private',
        clips: [
          { id: 'clip-bad', source: 'external', url: 'ftp://video.example/clip.mp4' },
          { id: 'clip-upload-new', source: 'upload', mediaType: 'video', pendingUpload: true }
        ]
      },
      profilePhotoFile: headshot,
      highlightClipUploads: [{ id: 'clip-upload-new', file: clip, title: 'Putback' }]
    })).rejects.toThrow('http or https');

    expect(legacyPlayerDbMocks.deleteAthleteProfileMediaByPath).toHaveBeenCalledWith('athlete-profile-media/parent-1/profile-1/headshot.png');
    expect(legacyPlayerDbMocks.deleteAthleteProfileMediaByPath).toHaveBeenCalledWith('athlete-profile-media/parent-1/profile-1/putback.mp4');
    expect(legacyPlayerDbMocks.saveAthleteProfile).not.toHaveBeenCalled();
  });

  it('preserves privacy value through the save flow for both public and private', async () => {
    legacyPlayerDbMocks.saveAthleteProfile.mockImplementation(async (_userId, nextDraft, options) => ({
      id: options.profileId,
      ...nextDraft
    }));

    await saveParentAthleteProfileDraft({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-current', playerId: 'player-current' }]
      } as any,
      teamId: 'team-current',
      playerId: 'player-current',
      profileId: 'profile-1',
      draft: {
        athlete: { name: 'Sam Player' },
        bio: { position: 'Guard' },
        privacy: 'public',
        clips: [],
        selectedSeasonKeys: ['team-current::player-current']
      }
    });

    expect(legacyPlayerDbMocks.saveAthleteProfile).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({ privacy: 'public' }),
      { profileId: 'profile-1' }
    );

    legacyPlayerDbMocks.saveAthleteProfile.mockClear();
    legacyPlayerDbMocks.saveAthleteProfile.mockImplementation(async (_userId, nextDraft, options) => ({
      id: options.profileId,
      ...nextDraft
    }));

    await saveParentAthleteProfileDraft({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-current', playerId: 'player-current' }]
      } as any,
      teamId: 'team-current',
      playerId: 'player-current',
      profileId: 'profile-1',
      draft: {
        athlete: { name: 'Sam Player' },
        bio: { position: 'Guard' },
        privacy: 'private',
        clips: [],
        selectedSeasonKeys: ['team-current::player-current']
      }
    });

    expect(legacyPlayerDbMocks.saveAthleteProfile).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({ privacy: 'private' }),
      { profileId: 'profile-1' }
    );
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
    legacyPlayerDbMocks.uploadPlayerPhoto.mockResolvedValue({
      url: 'https://cdn.example.com/photo.jpg',
      path: 'profile-photos/teams/team-1/players/player-1/photo.jpg'
    });
    legacyPlayerDbMocks.updatePlayer.mockResolvedValue(undefined);
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockResolvedValue(null);
  });

  it('uses authenticated primary Storage for native roster photos', async () => {
    nativeRuntimeState.isNative = true;
    nativeStorageMocks.uploadNativePlayerPhotoFile.mockResolvedValue({
      url: 'https://primary.example/kid.jpg',
      path: 'profile-photos/teams/team-1/players/player-1/kid.jpg'
    });
    const file = new File(['photo'], 'kid.jpg', { type: 'image/jpeg' });

    await saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player' },
      name: 'Sam Player',
      photoFile: file
    });

    expect(nativeStorageMocks.uploadNativePlayerPhotoFile).toHaveBeenCalledWith(file, 'team-1', 'player-1');
    expect(legacyPlayerDbMocks.uploadPlayerPhoto).not.toHaveBeenCalled();
    expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).toHaveBeenCalledWith([
      expect.objectContaining({
        pathSegments: ['teams', 'team-1', 'players', 'player-1'],
        data: expect.objectContaining({ photoUrl: 'https://primary.example/kid.jpg' })
      }),
      expect.objectContaining({
        pathSegments: ['teams', 'team-1', 'players', 'player-1', 'private', 'profile'],
        data: expect.objectContaining({
          photoPath: 'profile-photos/teams/team-1/players/player-1/kid.jpg'
        })
      })
    ]);
    expect(legacyPlayerDbMocks.updatePlayer).not.toHaveBeenCalled();
  });

  it('removes a native roster photo when its player update fails', async () => {
    nativeRuntimeState.isNative = true;
    nativeStorageMocks.uploadNativePlayerPhotoFile.mockResolvedValue({
      url: 'https://primary.example/kid.jpg',
      path: 'profile-photos/teams/team-1/players/player-1/kid.jpg'
    });
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(new Error('write failed'));

    await expect(saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player' },
      name: 'Sam Player',
      photoFile: new File(['photo'], 'kid.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('write failed');

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).toHaveBeenCalledWith(
      'profile-photos/teams/team-1/players/player-1/kid.jpg'
    );
  });

  it('accepts an ambiguous native roster save after the private photo path confirms it committed', async () => {
    const newPath = 'profile-photos/teams/team-1/players/player-1/kid.jpg';
    nativeRuntimeState.isNative = true;
    nativeStorageMocks.uploadNativePlayerPhotoFile.mockResolvedValue({
      url: 'https://primary.example/kid.jpg',
      path: newPath
    });
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true })
    );
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ photoPath: newPath });

    const result = await saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player' },
      name: 'Sam Player',
      photoFile: new File(['photo'], 'kid.jpg', { type: 'image/jpeg' })
    });

    expect(result.payload).toMatchObject({ photoPath: newPath });
    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalledWith(newPath);
  });

  it('keeps a native roster photo when the authoritative commit check is unavailable', async () => {
    nativeRuntimeState.isNative = true;
    nativeStorageMocks.uploadNativePlayerPhotoFile.mockResolvedValue({
      url: 'https://primary.example/kid.jpg',
      path: 'profile-photos/teams/team-1/players/player-1/kid.jpg'
    });
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true })
    );
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('read unavailable'));

    await expect(saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player' },
      name: 'Sam Player',
      photoFile: new File(['photo'], 'kid.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('may have completed');

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalled();
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

    expect(legacyPlayerDbMocks.uploadPlayerPhoto).toHaveBeenCalledWith(file, {
      returnUpload: true,
      teamId: 'team-1',
      playerId: 'player-1'
    });
    expect(legacyPlayerDbMocks.updatePlayer).toHaveBeenCalledWith('team-1', 'player-1', {
      number: '44',
      photoUrl: 'https://cdn.example.com/photo.jpg',
      photoPath: 'profile-photos/teams/team-1/players/player-1/photo.jpg'
    });
    expect(legacyPlayerDbMocks.setPlayerPrivateRosterProfileFields).not.toHaveBeenCalled();
    expect(appDataCacheMocks.clearAppDataCache).toHaveBeenCalledWith();
    expect(result).toEqual({
      updatedFields: ['number', 'photoUrl', 'photoPath'],
      payload: {
        number: '44',
        photoUrl: 'https://cdn.example.com/photo.jpg',
        photoPath: 'profile-photos/teams/team-1/players/player-1/photo.jpg'
      }
    });
  });

  it('rolls back a browser roster photo when the player update fails', async () => {
    legacyPlayerDbMocks.uploadPlayerPhoto.mockResolvedValueOnce({
      url: 'https://cdn.example.com/new-photo.jpg',
      path: 'player-photos/new-photo.jpg'
    });
    legacyPlayerDbMocks.updatePlayer.mockRejectedValueOnce(
      Object.assign(new Error('player update denied'), { code: 'permission-denied' })
    );

    await expect(saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player' },
      name: 'Sam Player',
      photoFile: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('player update denied');

    expect(legacyPlayerDbMocks.deleteLegacyImageUpload).toHaveBeenCalledWith('player-photos/new-photo.jpg');
  });

  it('keeps a browser roster photo when an authoritative read confirms an ambiguous update committed', async () => {
    const newPath = 'profile-photos/teams/team-1/players/player-1/new-photo.jpg';
    legacyPlayerDbMocks.uploadPlayerPhoto.mockResolvedValueOnce({
      url: 'https://cdn.example.com/new-photo.jpg',
      path: newPath
    });
    legacyPlayerDbMocks.updatePlayer.mockRejectedValueOnce(
      Object.assign(new Error('response unavailable'), { code: 'unavailable' })
    );
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ photoPath: newPath });

    const result = await saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player' },
      name: 'Sam Player',
      photoFile: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    });

    expect(result.payload).toMatchObject({ photoPath: newPath });
    expect(legacyPlayerDbMocks.deleteLegacyImageUpload).not.toHaveBeenCalledWith(newPath);
  });

  it('fails closed before a replacement upload when the existing private photo path cannot load', async () => {
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockRejectedValueOnce(new Error('private profile unavailable'));
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

    await expect(saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player', photoUrl: 'https://cdn.example.com/old.jpg' },
      name: 'Sam Player',
      photoFile: file
    })).rejects.toThrow('existing player photo state could not be loaded');

    expect(legacyPlayerDbMocks.uploadPlayerPhoto).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.updatePlayer).not.toHaveBeenCalled();
  });

  it('accepts an ambiguous browser photo removal only after the private path confirms it committed', async () => {
    const oldPath = 'profile-photos/teams/team-1/players/player-1/old.jpg';
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce({ photoPath: oldPath })
      .mockResolvedValueOnce({ photoPath: null });
    legacyPlayerDbMocks.updatePlayer.mockRejectedValueOnce(
      Object.assign(new Error('response unavailable'), { code: 'unavailable' })
    );

    const result = await saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player', photoUrl: 'https://cdn.example.com/old.jpg' },
      name: 'Sam Player',
      removePhoto: true
    });

    expect(result.payload).toMatchObject({ photoUrl: null, photoPath: null });
    expect(legacyPlayerDbMocks.deleteLegacyImageUpload).toHaveBeenCalledWith(oldPath);
  });

  it('preserves the prior photo when an ambiguous browser removal is not committed', async () => {
    const oldPath = 'profile-photos/teams/team-1/players/player-1/old.jpg';
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockResolvedValue({ photoPath: oldPath });
    legacyPlayerDbMocks.updatePlayer.mockRejectedValueOnce(
      Object.assign(new Error('response unavailable'), { code: 'unavailable' })
    );

    await expect(saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player', photoUrl: 'https://cdn.example.com/old.jpg' },
      name: 'Sam Player',
      removePhoto: true
    })).rejects.toThrow('response unavailable');

    expect(legacyPlayerDbMocks.deleteLegacyImageUpload).not.toHaveBeenCalledWith(oldPath);
  });

  it('preserves the prior photo when an ambiguous browser removal cannot be confirmed', async () => {
    const oldPath = 'profile-photos/teams/team-1/players/player-1/old.jpg';
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce({ photoPath: oldPath })
      .mockRejectedValueOnce(new Error('read unavailable'));
    legacyPlayerDbMocks.updatePlayer.mockRejectedValueOnce(
      Object.assign(new Error('response unavailable'), { code: 'unavailable' })
    );

    await expect(saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player', photoUrl: 'https://cdn.example.com/old.jpg' },
      name: 'Sam Player',
      removePhoto: true
    })).rejects.toThrow('response unavailable');

    expect(legacyPlayerDbMocks.deleteLegacyImageUpload).not.toHaveBeenCalledWith(oldPath);
  });

  it('deletes the prior permanent player photo only after a replacement is confirmed', async () => {
    const oldPath = 'profile-photos/teams/team-1/players/player-1/old.jpg';
    const newPath = 'profile-photos/teams/team-1/players/player-1/new.jpg';
    legacyPlayerDbMocks.uploadPlayerPhoto.mockResolvedValueOnce({
      url: 'https://cdn.example.com/new.jpg',
      path: newPath
    });

    await saveStaffPlayerRosterDetails({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      currentPlayer: { name: 'Sam Player', photoUrl: 'https://cdn.example.com/old.jpg', photoPath: oldPath },
      name: 'Sam Player',
      photoFile: new File(['photo'], 'new.jpg', { type: 'image/jpeg' })
    });

    expect(legacyPlayerDbMocks.updatePlayer).toHaveBeenCalledWith('team-1', 'player-1', expect.objectContaining({
      photoPath: newPath
    }));
    expect(legacyPlayerDbMocks.deleteLegacyImageUpload).toHaveBeenCalledWith(oldPath);
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

describe('updateParentPlayerEditableProfile native photo upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeState.isNative = true;
    nativeStorageMocks.uploadNativePlayerPhotoFile.mockResolvedValue({
      url: 'https://primary.example/parent-kid.jpg',
      path: 'profile-photos/teams/team-1/players/player-1/kid.jpg'
    });
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockResolvedValue(null);
  });

  it('uses the linked player path and saves the resulting URL', async () => {
    const file = new File(['photo'], 'kid.jpg', { type: 'image/jpeg' });

    await updateParentPlayerEditableProfile({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      photoFile: file
    });

    expect(nativeStorageMocks.uploadNativePlayerPhotoFile).toHaveBeenCalledWith(file, 'team-1', 'player-1');
    expect(legacyPlayerDbMocks.uploadPlayerPhoto).not.toHaveBeenCalled();
    expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).toHaveBeenCalledWith([
      expect.objectContaining({
        pathSegments: ['teams', 'team-1', 'players', 'player-1', 'private', 'profile'],
        data: expect.objectContaining({
          photoPath: 'profile-photos/teams/team-1/players/player-1/kid.jpg'
        })
      }),
      expect.objectContaining({
        pathSegments: ['teams', 'team-1', 'players', 'player-1'],
        data: expect.objectContaining({
          photoUrl: 'https://primary.example/parent-kid.jpg'
        })
      })
    ]);
    expect(legacyPlayerDbMocks.updatePlayerPrivateProfile).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.updatePlayerProfile).not.toHaveBeenCalled();
  });

  it('accepts an ambiguous native parent photo save after the private path confirms it committed', async () => {
    const newPath = 'profile-photos/teams/team-1/players/player-1/kid.jpg';
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true })
    );
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ photoPath: newPath });

    const result = await updateParentPlayerEditableProfile({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      photoFile: new File(['photo'], 'kid.jpg', { type: 'image/jpeg' })
    });

    expect(result).toMatchObject({ photoPath: newPath });
    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalledWith(newPath);
  });

  it('removes an ambiguous native parent photo after the private path proves it did not commit', async () => {
    const newPath = 'profile-photos/teams/team-1/players/player-1/kid.jpg';
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true })
    );
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ photoPath: 'profile-photos/teams/team-1/players/player-1/old.jpg' });

    await expect(updateParentPlayerEditableProfile({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      photoFile: new File(['photo'], 'kid.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('may have completed');

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).toHaveBeenCalledWith(newPath);
  });

  it('keeps a native parent photo when the authoritative commit check is unavailable', async () => {
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true })
    );
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('read unavailable'));

    await expect(updateParentPlayerEditableProfile({
      user: {
        uid: 'parent-1',
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      photoFile: new File(['photo'], 'kid.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('may have completed');

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalled();
  });
});

describe('updateParentPlayerEditableProfile browser photo durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeState.isNative = false;
    legacyPlayerDbMocks.updatePlayerPrivateProfile.mockResolvedValue(undefined);
    legacyPlayerDbMocks.uploadPlayerPhoto.mockResolvedValue({
      url: 'https://primary.example/parent-new.jpg',
      path: 'profile-photos/teams/team-1/players/player-1/new.jpg'
    });
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockResolvedValue(null);
  });

  it('recovers a post-commit response error and then removes the prior referenced photo', async () => {
    const oldPath = 'profile-photos/teams/team-1/players/player-1/old.jpg';
    const newPath = 'profile-photos/teams/team-1/players/player-1/new.jpg';
    legacyPlayerDbMocks.getPlayerPrivateProfile
      .mockResolvedValueOnce({ photoPath: oldPath })
      .mockResolvedValueOnce({ photoPath: newPath });
    legacyPlayerDbMocks.updatePlayerProfile.mockRejectedValueOnce(
      Object.assign(new Error('response unavailable'), { code: 'unavailable' })
    );

    const result = await updateParentPlayerEditableProfile({
      user: { uid: 'parent-1', parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      photoFile: new File(['photo'], 'new.jpg', { type: 'image/jpeg' })
    });

    expect(result).toMatchObject({ photoPath: newPath });
    expect(legacyPlayerDbMocks.deleteLegacyImageUpload).toHaveBeenCalledWith(oldPath);
    expect(legacyPlayerDbMocks.deleteLegacyImageUpload).not.toHaveBeenCalledWith(newPath);
  });

  it('fails closed before parent upload when the existing private photo path cannot load', async () => {
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockRejectedValueOnce(new Error('private profile unavailable'));

    await expect(updateParentPlayerEditableProfile({
      user: { uid: 'parent-1', parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      photoFile: new File(['photo'], 'new.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('existing player photo state could not be loaded');

    expect(legacyPlayerDbMocks.uploadPlayerPhoto).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.updatePlayerProfile).not.toHaveBeenCalled();
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
    legacyPlayerDbMocks.updatePlayerWithPrivateRosterProfileFields.mockResolvedValue(undefined);
  });

  it('writes only public custom roster values to the public player doc', async () => {
    legacyPlayerDbMocks.getRosterFieldDefinitions.mockResolvedValue([
      { key: 'nickname', label: 'Nickname', type: 'text', visibility: 'public', sortOrder: 1 },
      { key: 'birthDate', label: 'Birth Date', type: 'date', visibility: 'team', sortOrder: 2 },
      { key: 'jerseySize', label: 'Jersey Size', type: 'menu', visibility: 'parents', options: ['YS', 'YM'], sortOrder: 3 },
      { key: 'medicalNote', label: 'Medical Note', type: 'text', visibility: 'admins', sortOrder: 4 }
    ]);

    await savePlayerCustomRosterFieldValues({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      values: {
        nickname: 'Speedy',
        birthDate: '2014-02-03',
        jerseySize: 'YS',
        medicalNote: 'Do not store in parent-readable profile',
        stale: 'must not resurrect deleted definitions'
      }
    });

    expect(legacyPlayerDbMocks.updatePlayerWithPrivateRosterProfileFields).toHaveBeenCalledWith('team-1', 'player-1', {
      profile: {
        position: 'Guard',
        customFields: {
          nickname: 'Speedy'
        }
      }
    }, {
      birthDate: '2014-02-03',
      jerseySize: 'YS'
    });
  });

  it('migrates legacy protected fields and ignores legacy public visibility in app saves', async () => {
    legacyPlayerDbMocks.getPlayers.mockResolvedValue([{
      id: 'player-1',
      profile: {
        birthDate: '2014-02-03',
        customFields: { grade: '6', nickname: 'Rocket' }
      }
    }]);
    legacyPlayerDbMocks.getRosterFieldDefinitions.mockResolvedValue([
      { key: 'nickname', label: 'Nickname', type: 'text', visibility: 'public', sortOrder: 1 },
      { key: 'grade', label: 'Grade', type: 'text', visibility: 'public', sortOrder: 2 }
    ]);

    await savePlayerCustomRosterFieldValues({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      values: { nickname: 'Speedy', grade: '7' }
    });

    expect(legacyPlayerDbMocks.updatePlayerWithPrivateRosterProfileFields).toHaveBeenCalledWith('team-1', 'player-1', {
      profile: { customFields: { nickname: 'Speedy' } }
    }, {
      birthDate: '2014-02-03',
      jerseySize: 'YM',
      grade: '7'
    });
  });

  it('does not fall back to independent writes when the atomic profile migration fails', async () => {
    legacyPlayerDbMocks.updatePlayerWithPrivateRosterProfileFields.mockRejectedValueOnce(new Error('batch failed'));

    await expect(savePlayerCustomRosterFieldValues({
      user: { uid: 'coach-1', email: 'coach@example.com' } as any,
      teamId: 'team-1',
      playerId: 'player-1',
      values: { nickname: 'Speedy' }
    })).rejects.toThrow('batch failed');

    expect(legacyPlayerDbMocks.updatePlayer).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.setPlayerPrivateRosterProfileFields).not.toHaveBeenCalled();
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


function buildDiamondPlayerGame(id: string, revision = 8) {
  return {
    id,
    teamId: 'team-1',
    status: 'completed',
    date: `2026-03-${String(revision).padStart(2, '0')}T18:00:00Z`,
    trackingEngine: 'diamond-v2',
    diamondProjectionStatus: 'current',
    diamondProjectionComplete: true,
    diamondProjectionRevision: revision,
    diamondScorebookInstanceId: `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`,
    diamondProjectionCheckpointHash: `sha256:${'a'.repeat(64)}`,
    diamondStatConfigSnapshotHash: `sha256:${'b'.repeat(64)}`,
    diamondProjectionHash: `sha256:${'c'.repeat(64)}`,
    rulesProfileId: 'baseball-youth@1'
  };
}

function buildDiamondPlayerPublicStat(game: ReturnType<typeof buildDiamondPlayerGame>, {
  hits = 1,
  sourcePlayIds = [] as string[]
} = {}) {
  return {
    schemaVersion: 1,
    trackingEngine: 'diamond-v2',
    projectionSchemaVersion: 1,
    playerId: 'player-1',
    playerName: 'Sam Player',
    playerNumber: '',
    sourceRevision: game.diamondProjectionRevision,
    checkpointHash: game.diamondProjectionCheckpointHash,
    complete: true,
    participated: true,
    participationStatus: 'appeared',
    participationSource: 'diamond-v2',
    publicStatIds: ['h'],
    stats: { h: hits },
    observedStats: {},
    derivedStats: {},
    observedDerivedStats: {},
    statCoverage: { h: 'complete' },
    statSources: sourcePlayIds.length ? { h: sourcePlayIds } : {},
    sourcePlayIds,
    unavailableDerivedStats: [],
    missingStatFamilies: [],
    coverage: { batting: 'complete' },
    teamId: 'team-1',
    diamondGameId: game.id,
    instanceId: game.diamondScorebookInstanceId,
    diamondScorebookInstanceId: game.diamondScorebookInstanceId,
    projectionGeneration: game.diamondScorebookInstanceId,
    statConfigSnapshotHash: game.diamondStatConfigSnapshotHash,
    projectionHash: game.diamondProjectionHash
  };
}

describe('loadParentPlayerDetail custom roster fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyPlayerDbMocks.collectRosterParentContacts.mockReturnValue([]);
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
        parents: [
          { name: 'Jordan Parent', email: 'jordan@example.com', relation: 'Parent', source: 'household' }
        ],
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
    legacyPlayerDbMocks.getAggregatedStatsForGames.mockResolvedValue({});
    legacyPlayerDbMocks.getAggregatedStatsDocumentForPlayer.mockResolvedValue({});
    legacyPlayerDbMocks.getConfigs.mockResolvedValue([]);
    legacyPlayerDbMocks.getGameEvents.mockResolvedValue([]);
    gameReportMocks.loadGameReportPlays.mockResolvedValue({
      game: {},
      plays: [],
      playsFresh: true
    });
    legacyPlayerDbMocks.listCertificatesForPlayer.mockResolvedValue([]);
    legacyPlayerDbMocks.getPublicTrackingItems.mockResolvedValue([]);
    legacyPlayerDbMocks.getPlayerTrackingStatuses.mockResolvedValue([]);
    legacyPlayerDbMocks.listAthleteProfilesForParent.mockResolvedValue([]);
    profileServiceMocks.loadProfileDocument.mockResolvedValue(null);
  });

  it('applies roster field privacy so parents do not receive admin-only custom values', async () => {
    const detail = await loadParentPlayerDetail({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.listAthleteProfilesForParent).not.toHaveBeenCalled();
    expect(detail.athleteProfile).toEqual(expect.objectContaining({
      profile: null,
      shareUrl: '',
      builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-1&playerId=player-1',
      seasonOptions: [
        expect.objectContaining({
          seasonKey: 'team-1::player-1'
        })
      ]
    }));
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

  it('does not load team games or collect clips for the initial detail payload', async () => {
    const detail = await loadParentPlayerDetail({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getGames).not.toHaveBeenCalled();
    expect(legacyPlayerProfileMocks.collectPlayerVideoClips).not.toHaveBeenCalled();
    expect(detail.clips).toEqual([]);
  });

  it('includes parent-visible private roster field values for linked parents', async () => {
    legacyPlayerDbMocks.getRosterFieldDefinitions.mockResolvedValue([
      { key: 'nickname', label: 'Nickname', type: 'text', visibility: 'team', sortOrder: 1 },
      { key: 'jerseySize', label: 'Jersey Size', type: 'menu', visibility: 'parents', options: ['YS', 'YM'], sortOrder: 2 }
    ]);

    const detail = await loadParentPlayerDetail({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(detail.customRosterFields).toEqual([
      expect.objectContaining({ key: 'nickname', value: 'Rocket' }),
      expect.objectContaining({ key: 'jerseySize', value: 'YM' })
    ]);
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

  it('shows linked family contacts to non-parent team viewers without loading private profile data', async () => {
    scheduleServiceMocks.loadParentPlayerSchedule.mockResolvedValue({
      children: [{ teamId: 'team-1', teamName: 'Comets', playerId: 'linked-player', playerName: 'Linked Player' }],
      events: []
    });
    legacyPlayerDbMocks.getPlayers.mockResolvedValue([
      {
        id: 'player-1',
        name: 'Sam Player',
        parents: [
          { name: 'Jordan Parent', email: 'jordan@example.com', relation: 'Parent', source: 'household' }
        ]
      },
      { id: 'linked-player', name: 'Linked Player' }
    ]);
    legacyPlayerDbMocks.collectRosterParentContacts.mockReturnValue([
      { name: 'Jordan Parent', email: 'jordan@example.com', relation: 'Parent', source: 'household' }
    ]);

    const detail = await loadParentPlayerDetail({
      uid: 'parent-2',
      email: 'teammate@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'linked-player' }]
    } as any, 'team-1', 'player-1');

    expect(detail.access.isLinkedParent).toBe(false);
    expect(legacyPlayerDbMocks.getPlayerPrivateProfile).not.toHaveBeenCalled();
    expect(legacyPlayerDbMocks.collectRosterParentContacts).toHaveBeenCalledWith(expect.objectContaining({ id: 'player-1' }), {
      includeImported: false,
      includeFamilyContacts: true,
      includeHousehold: true
    });
    expect(detail.familyContacts).toEqual([
      expect.objectContaining({ name: 'Jordan Parent', email: 'jordan@example.com', relation: 'Parent' })
    ]);
    expect(detail.privateProfile).toBeNull();
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

  it('refreshes the profile access fields before rejecting a linked parent route', async () => {
    scheduleServiceMocks.loadParentPlayerSchedule.mockResolvedValue({
      children: [],
      events: []
    });
    profileServiceMocks.loadProfileDocument.mockResolvedValue({
      parentOf: [
        { teamId: 'team-1', teamName: 'Comets', playerId: 'player-1', playerName: 'Sam Player' }
      ],
      parentPlayerKeys: ['team-1::player-1']
    });

    const detail = await loadParentPlayerDetail({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [],
      parentPlayerKeys: []
    } as any, 'team-1', 'player-1');

    expect(profileServiceMocks.loadProfileDocument).toHaveBeenCalledWith('parent-1');
    expect(scheduleServiceMocks.loadParentPlayerSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parentOf: expect.arrayContaining([
          expect.objectContaining({ teamId: 'team-1', playerId: 'player-1' })
        ]),
        parentPlayerKeys: expect.arrayContaining(['team-1::player-1'])
      }),
      { teamId: 'team-1', playerId: 'player-1' }
    );
    expect(detail.child).toEqual(expect.objectContaining({
      teamId: 'team-1',
      playerId: 'player-1',
      playerName: 'Sam Player'
    }));
    expect(detail.access.isLinkedParent).toBe(true);
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

  it('loads video clips on demand and limits the player clips to 8', async () => {
    const games = [{ id: 'game-1' }, { id: 'game-2' }];
    const clips = Array.from({ length: 9 }, (_, index) => ({
      id: `clip-${index + 1}`,
      title: `Clip ${index + 1}`,
      gameDate: '',
      playLabel: '',
      url: `https://video.example/clip-${index + 1}.mp4`,
      thumbnailUrl: '',
      gameLabel: 'Game'
    }));
    legacyPlayerDbMocks.getGames.mockResolvedValue(games);
    legacyPlayerProfileMocks.collectPlayerVideoClips.mockReturnValue(clips as any);

    const result = await loadParentPlayerVideoClips({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getGames).toHaveBeenCalledWith('team-1');
    expect(legacyPlayerProfileMocks.collectPlayerVideoClips).toHaveBeenCalledWith(games, {
      teamId: 'team-1',
      playerId: 'player-1'
    });
    expect(result).toEqual(clips.slice(0, 8));
  });

  it('allows profile-hydrated parent links to load video clips on demand', async () => {
    const games = [{ id: 'game-1' }];
    const clips = [{
      id: 'clip-1',
      title: 'Fast break',
      gameDate: '',
      playLabel: '',
      url: 'https://video.example/clip-1.mp4',
      thumbnailUrl: '',
      gameLabel: 'Game'
    }];
    scheduleServiceMocks.loadParentPlayerSchedule.mockResolvedValue({
      children: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player' }],
      events: []
    });
    legacyPlayerDbMocks.getGames.mockResolvedValue(games);
    legacyPlayerProfileMocks.collectPlayerVideoClips.mockReturnValue(clips as any);

    const result = await loadParentPlayerVideoClips({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: []
    } as any, 'team-1', 'player-1');

    expect(scheduleServiceMocks.loadParentPlayerSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'parent-1' }),
      { teamId: 'team-1', playerId: 'player-1' }
    );
    expect(legacyPlayerDbMocks.getGames).toHaveBeenCalledWith('team-1');
    expect(legacyPlayerProfileMocks.collectPlayerVideoClips).toHaveBeenCalledWith(games, {
      teamId: 'team-1',
      playerId: 'player-1'
    });
    expect(result).toEqual(clips);
  });

  it('surfaces video clip game fetch failures to the caller', async () => {
    legacyPlayerDbMocks.getGames.mockRejectedValue(new Error('Game fetch failed.'));

    await expect(loadParentPlayerVideoClips({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1')).rejects.toThrow('Game fetch failed.');

    expect(legacyPlayerProfileMocks.collectPlayerVideoClips).not.toHaveBeenCalled();
  });

  it('loads all-game stat totals for a linked parent player', async () => {
    legacyPlayerDbMocks.getGames.mockResolvedValue([
      { id: 'game-1' },
      { id: 'game-2' },
      { id: '' },
      { gameId: 'game-3' }
    ]);
    legacyPlayerDbMocks.getAggregatedStatsForGames.mockResolvedValue({
      'player-1': {
        goals: 7,
        assists: '2',
        empty: '',
        bad: 'not-a-number'
      },
      'player-2': {
        goals: 99
      }
    });

    const totals = await loadParentPlayerStatTotals({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getGames).toHaveBeenCalledWith('team-1');
    expect(legacyPlayerDbMocks.getAggregatedStatsForGames).toHaveBeenCalledWith('team-1', ['game-1', 'game-2', 'game-3']);
    expect(totals).toEqual({
      teamId: 'team-1',
      playerId: 'player-1',
      gameCount: 3,
      gameIds: ['game-1', 'game-2', 'game-3'],
      totals: {
        goals: 7,
        assists: 2,
        empty: 0
      }
    });
  });

  it('loads player stats detail playing time from aggregated stat document metadata', async () => {
    legacyPlayerDbMocks.getGames.mockResolvedValue([
      { id: 'game-1', status: 'completed', date: '2026-03-01T18:00:00Z', opponent: 'Owls' }
    ]);
    legacyPlayerDbMocks.getAggregatedStatsDocumentForPlayer.mockResolvedValue({
      stats: {
        pts: 14,
        reb: 6
      },
      timeMs: 960000
    });

    const detail = await loadParentPlayerStatsDetail({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getAggregatedStatsDocumentForPlayer).toHaveBeenCalledWith('team-1', 'game-1', 'player-1');
    expect(detail.statRows[0]).toEqual(expect.objectContaining({
      stats: { pts: 14, reb: 6 },
      timeMs: 960000
    }));
    expect(detail.summary.gamesWithTime).toBe(1);
    expect(detail.summary.totalTimeMs).toBe(960000);
    expect(detail.summary.totals).toEqual({ pts: 14, reb: 6 });
  });

  it('keeps configured private Diamond stats out of public rows, totals, and rankings', async () => {
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    const config = {
      id: 'baseball',
      baseType: 'Baseball',
      columns: ['H'],
      statDefinitions: [
        { id: 'h', label: 'Hits', scope: 'player', visibility: 'public', topStat: true },
        { id: 'pitches', label: 'Pitch count', scope: 'player', visibility: 'private', topStat: true }
      ]
    };
    legacyPlayerDbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Comets', sport: 'Baseball' });
    legacyPlayerDbMocks.getPlayers.mockResolvedValue([
      { id: 'player-1', name: 'Sam Player' },
      { id: 'player-2', name: 'Other Player' }
    ]);
    legacyPlayerDbMocks.getGames.mockResolvedValue([{
      id: 'game-1',
      status: 'completed',
      date: '2026-03-01T18:00:00Z',
      opponent: 'Owls',
      trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 4,
      diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      rulesProfileId: 'baseball-youth@1'
    }]);
    legacyPlayerDbMocks.getConfigs.mockResolvedValue([config]);
    legacyPlayerProfileMocks.selectAnalyticsConfig.mockReturnValue(config as any);
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument.mockResolvedValue({
      schemaVersion: 1,
      trackingEngine: 'diamond-v2',
      projectionSchemaVersion: 1,
      playerId: 'player-1',
      playerName: 'Sam Player',
      playerNumber: '',
      sourceRevision: 4,
      checkpointHash,
      complete: true,
      participated: true,
      participationStatus: 'appeared',
      participationSource: 'diamond-v2',
      publicStatIds: ['h'],
      stats: { h: 2 },
      observedStats: {},
      derivedStats: {},
      observedDerivedStats: {},
      statCoverage: { h: 'complete' },
      statSources: {},
      sourcePlayIds: [],
      unavailableDerivedStats: [],
      missingStatFamilies: [],
      coverage: { batting: 'complete' },
      teamId: 'team-1',
      diamondGameId: 'game-1',
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      statConfigSnapshotHash: configHash,
      projectionHash
    });

    const detail = await loadParentPlayerStatsDetail({
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(detail.statRows[0].stats).toEqual({ h: 2 });
    expect(detail.summary.totals).toEqual(expect.objectContaining({ h: 2 }));
    expect(detail.summary.totals).not.toHaveProperty('pitches');
    expect(detail.summary.statDefinitions?.map((definition) => definition.id)).not.toContain('pitches');
    expect(legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument).toHaveBeenCalledWith(
      `teams/team-1/games/game-1/diamondStatGenerations/${instanceId}/publicPlayerStats`,
      'player-1'
    );
    expect(legacyPlayerDbMocks.getAggregatedStatsDocumentForPlayer).not.toHaveBeenCalled();
    expect(legacyPlayerProfileMocks.buildPlayerLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      players: [{ id: 'player-1', name: 'Sam Player' }]
    }));
  });

  it('recovers a partial-empty Diamond first load with exactly one bounded retry', async () => {
    const game = buildDiamondPlayerGame('diamond-game-1');
    legacyPlayerDbMocks.getGames.mockResolvedValue([game]);
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument
      .mockRejectedValueOnce(new Error('temporary rules propagation'))
      .mockResolvedValueOnce(buildDiamondPlayerPublicStat(game, { hits: 2 }));

    const detail = await loadParentPlayerStatsDetail({
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument).toHaveBeenCalledTimes(2);
    expect(detail.summary).toMatchObject({
      totals: { h: 2 },
      diamond: { pending: false, publicStatsStatus: 'complete', absenceConfirmed: false }
    });
  });

  it('rejects repeated partial-empty Diamond season totals so AI callers cannot infer zero', async () => {
    const game = buildDiamondPlayerGame('diamond-game-1');
    legacyPlayerDbMocks.getGames.mockResolvedValue([game]);
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument.mockRejectedValue(new Error('rules denied'));

    await expect(loadParentPlayerStatTotals({
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1')).rejects.toThrow(
      'Diamond statistics are temporarily unavailable. Refresh to retry.'
    );

    expect(legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument).toHaveBeenCalledTimes(2);
  });

  it('carries partial nonempty Diamond totals as lower-bound evidence for AI consumers', async () => {
    const game1 = buildDiamondPlayerGame('diamond-game-1', 8);
    const game2 = buildDiamondPlayerGame('diamond-game-2', 9);
    legacyPlayerDbMocks.getGames.mockResolvedValue([game1, game2]);
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument.mockImplementation(async (path: string) => {
      if (path.includes('/diamond-game-2/')) throw new Error('temporary partial read');
      return buildDiamondPlayerPublicStat(game1, { hits: 1 });
    });

    const totals = await loadParentPlayerStatTotals({
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument).toHaveBeenCalledTimes(2);
    expect(totals).toMatchObject({
      totals: { h: 1 },
      diamond: {
        hasDiamond: true,
        pending: true,
        publicStatsStatus: 'partial',
        absenceConfirmed: false
      }
    });
  });

  it('accepts a complete-empty Diamond projection without retrying or inventing pending stats', async () => {
    const game = buildDiamondPlayerGame('diamond-game-1');
    legacyPlayerDbMocks.getGames.mockResolvedValue([game]);
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument.mockResolvedValue({});

    const detail = await loadParentPlayerStatsDetail({
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument).toHaveBeenCalledTimes(1);
    expect(detail.summary).toMatchObject({
      gamesPlayed: 0,
      totals: {},
      statPresentation: { projectionPending: false },
      diamond: { hasDiamond: true, pending: false, publicStatsStatus: 'complete', absenceConfirmed: true }
    });
    expect(detail.gameEventsLoadStatus).toBe('complete');
  });

  it('keeps a partial nonempty result visible and uncached so a later ordinary load expands it', async () => {
    const game1 = buildDiamondPlayerGame('diamond-game-1', 8);
    const game2 = buildDiamondPlayerGame('diamond-game-2', 9);
    const game2Attempts = { count: 0 };
    legacyPlayerDbMocks.getGames.mockResolvedValue([game1, game2]);
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument.mockImplementation(async (path: string) => {
      if (path.includes('/diamond-game-2/')) {
        game2Attempts.count += 1;
        if (game2Attempts.count === 1) throw new Error('temporary partial read');
        return buildDiamondPlayerPublicStat(game2, { hits: 1 });
      }
      return buildDiamondPlayerPublicStat(game1, { hits: 1 });
    });

    const user = {
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any;
    const partial = await loadParentPlayerStatsDetail(user, 'team-1', 'player-1');
    const cacheCalls = appDataCacheMocks.loadCachedAppData.mock.calls;
    const firstCacheOptions = cacheCalls[cacheCalls.length - 1]?.[2];

    expect(partial.summary).toMatchObject({
      totals: { h: 1 },
      diamond: { pending: true, publicStatsStatus: 'partial' }
    });
    expect(firstCacheOptions?.shouldCache(partial)).toBe(false);

    const expanded = await loadParentPlayerStatsDetail(user, 'team-1', 'player-1');
    expect(expanded.summary).toMatchObject({
      totals: { h: 2 },
      diamond: { pending: false, publicStatsStatus: 'complete' }
    });
    expect(game2Attempts.count).toBe(2);
  });

  it('loads Diamond player events only through sanitized replay and validated source play ids', async () => {
    const game = buildDiamondPlayerGame('diamond-game-1');
    legacyPlayerDbMocks.getGames.mockResolvedValue([game]);
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument.mockResolvedValue(
      buildDiamondPlayerPublicStat(game, { hits: 1, sourcePlayIds: ['play-1'] })
    );
    gameReportMocks.loadGameReportPlays.mockResolvedValue({
      game,
      plays: [
        { id: 'other-play', text: 'Other player scored', period: 'Top 1', clock: '', timestamp: new Date('2026-03-08T18:01:00Z') },
        { id: 'play-1', text: 'Sam Player singled', period: 'Bottom 1', clock: '', timestamp: new Date('2026-03-08T18:02:00Z') }
      ],
      playsFresh: true,
      replay: { requestedVisibility: 'public', visibility: 'public', source: 'public-sanitized' }
    });

    const detail = await loadParentPlayerStatsDetail({
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getGameEvents).not.toHaveBeenCalled();
    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledWith('team-1', 'diamond-game-1', { statVisibility: 'public' });
    expect(detail.gameEventsLoadStatus).toBe('complete');
    expect(detail.gameEventRows[0]?.events).toEqual([
      expect.objectContaining({ id: 'play-1', description: 'Sam Player singled' })
    ]);
  });

  it('retries incomplete Diamond replay once and never converts rule denial to authoritative no events', async () => {
    const game = buildDiamondPlayerGame('diamond-game-1');
    legacyPlayerDbMocks.getGames.mockResolvedValue([game]);
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument.mockResolvedValue(
      buildDiamondPlayerPublicStat(game, { hits: 1, sourcePlayIds: ['play-1'] })
    );
    gameReportMocks.loadGameReportPlays.mockResolvedValue({
      game,
      plays: [],
      playsFresh: false,
      replayError: 'Diamond play-by-play could not be refreshed completely. Retry the report.'
    });

    const detail = await loadParentPlayerStatsDetail({
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledTimes(2);
    expect(legacyPlayerDbMocks.getGameEvents).not.toHaveBeenCalled();
    expect(detail.gameEventRows).toEqual([]);
    expect(detail.gameEventsLoadStatus).toBe('unavailable');
    const cacheCalls = appDataCacheMocks.loadCachedAppData.mock.calls;
    expect(cacheCalls[cacheCalls.length - 1]?.[2]?.shouldCache(detail)).toBe(false);
  });

  it('preserves the legacy direct game-event read path unchanged', async () => {
    const game = { id: 'legacy-game-1', status: 'completed', date: '2026-03-01T18:00:00Z', opponent: 'Owls' };
    legacyPlayerDbMocks.getGames.mockResolvedValue([game]);
    legacyPlayerDbMocks.getAggregatedStatsDocumentForPlayer.mockResolvedValue({ stats: { pts: 2 } });
    legacyPlayerDbMocks.getGameEvents.mockResolvedValue([{
      id: 'legacy-event-1',
      playerId: 'player-1',
      statKey: 'pts',
      value: 2,
      description: 'Made basket',
      timestamp: '2026-03-01T18:02:00Z'
    }]);

    const detail = await loadParentPlayerStatsDetail({
      uid: 'parent-1',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getGameEvents).toHaveBeenCalledWith('team-1', 'legacy-game-1', { limit: 100 });
    expect(gameReportMocks.loadGameReportPlays).not.toHaveBeenCalled();
    expect(detail.gameEventsLoadStatus).toBe('not-requested');
    expect(detail.gameEventRows[0]?.events[0]).toEqual(expect.objectContaining({ id: 'legacy-event-1' }));
  });

  it('loads a complete 41-game Diamond manager season in bounded coherent chunks', async () => {
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    const games = Array.from({ length: 41 }, (_, index) => {
      const instanceId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      return {
        id: `diamond-game-${String(index + 1).padStart(2, '0')}`,
        teamId: 'team-1',
        status: 'completed',
        date: new Date(Date.UTC(2026, 0, index + 1, 18)).toISOString(),
        trackingEngine: 'diamond-v2',
        diamondProjectionStatus: 'current',
        diamondProjectionComplete: true,
        diamondProjectionRevision: index + 1,
        diamondScorebookInstanceId: instanceId,
        diamondProjectionCheckpointHash: checkpointHash,
        diamondStatConfigSnapshotHash: configHash,
        diamondProjectionHash: projectionHash,
        rulesProfileId: 'baseball-youth@1'
      };
    });
    const config = {
      id: 'baseball',
      baseType: 'Baseball',
      statDefinitions: [{ id: 'h', label: 'Hits', scope: 'player', visibility: 'public' }]
    };
    legacyPlayerDbMocks.getGames.mockResolvedValue(games);
    legacyPlayerDbMocks.getConfigs.mockResolvedValue([config]);
    legacyPlayerProfileMocks.selectAnalyticsConfig.mockReturnValue(config as any);
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => ({
      status: 'complete',
      reason: null,
      documentsByGameId: new Map(requestedGames.map((game: any) => [game.id, playerIds.map((requestedPlayerId: string) => ({
        id: requestedPlayerId,
        data: {
          trackingEngine: 'diamond-v2',
          authoritative: true,
          complete: true,
          projectionSchemaVersion: 1,
          playerId: requestedPlayerId,
          side: 'home',
          instanceId: game.diamondScorebookInstanceId,
          diamondScorebookInstanceId: game.diamondScorebookInstanceId,
          projectionGeneration: game.diamondScorebookInstanceId,
          sourceRevision: game.diamondProjectionRevision,
          checkpointHash,
          statConfigSnapshotHash: configHash,
          projectionHash,
          stats: { h: 1 },
          observedStats: {},
          derivedStats: {},
          observedDerivedStats: {},
          statCoverage: { h: 'complete' },
          coverage: { batting: 'complete' },
          participated: true
        }
      }))])),
      teamDocumentsByGameId: new Map()
    }));

    const detail = await loadParentPlayerStatsDetail({
      uid: 'coach-1',
      email: 'coach@example.com',
      parentOf: []
    } as any, 'team-1', 'player-1');

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).toHaveBeenCalledTimes(2);
    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.map(([request]) => request.games.length)).toEqual([40, 1]);
    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.every(([request]) => request.playerIds.length === 1)).toBe(true);
    expect(legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument).not.toHaveBeenCalled();
    expect(detail.statRows).toHaveLength(20);
    expect(detail.summary).toMatchObject({
      gamesPlayed: 41,
      totals: { h: 41 },
      hasMoreGames: true,
      diamond: {
        pending: false,
        requestedStatVisibility: 'manager-internal',
        statVisibility: 'manager-internal',
        privateStatsStatus: 'complete',
        privateStatsReason: null,
        publicStatsStatus: 'not-requested'
      }
    });
  });

  it('rejects a repeated partial-empty public fallback after one bounded retry', async () => {
    const checkpointHash = `sha256:${'d'.repeat(64)}`;
    const configHash = `sha256:${'e'.repeat(64)}`;
    const projectionHash = `sha256:${'f'.repeat(64)}`;
    const games = Array.from({ length: 41 }, (_, index) => ({
      id: `diamond-game-${String(index + 1).padStart(2, '0')}`,
      teamId: 'team-1',
      status: 'completed',
      date: new Date(Date.UTC(2026, 0, index + 1, 18)).toISOString(),
      trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current',
      diamondProjectionComplete: true,
      diamondProjectionRevision: index + 1,
      diamondScorebookInstanceId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      rulesProfileId: 'baseball-youth@1'
    }));
    legacyPlayerDbMocks.getGames.mockResolvedValue(games);
    diamondManagerStatsMocks.loadDiamondManagerStats
      .mockResolvedValueOnce({
        status: 'complete',
        reason: null,
        documentsByGameId: new Map(),
        teamDocumentsByGameId: new Map()
      })
      .mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'private-read-unavailable',
        documentsByGameId: new Map(),
        teamDocumentsByGameId: new Map()
      });
    let activePublicReads = 0;
    let maxActivePublicReads = 0;
    legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument.mockImplementation(async () => {
      activePublicReads += 1;
      maxActivePublicReads = Math.max(maxActivePublicReads, activePublicReads);
      await Promise.resolve();
      activePublicReads -= 1;
      throw new Error('public read unavailable');
    });

    await expect(loadParentPlayerStatsDetail({
      uid: 'coach-1',
      email: 'coach@example.com',
      parentOf: []
    } as any, 'team-1', 'player-1')).rejects.toThrow(
      'Diamond statistics are temporarily unavailable. Refresh to retry.'
    );

    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.map(([request]) => request.games.length)).toEqual([40, 1]);
    expect(legacyPlayerDbMocks.getDiamondPublicPlayerStatDocument).toHaveBeenCalledTimes(82);
    expect(maxActivePublicReads).toBeLessThanOrEqual(8);
  });

  it('preserves the bounded 20-game legacy stats read and summary path when Diamond is absent', async () => {
    const games = Array.from({ length: 40 }, (_, index) => ({
      id: `game-${String(index + 1)}`,
      status: 'completed',
      date: new Date(Date.UTC(2026, 7, 1, 18, 0, index)).toISOString(),
      opponent: `Opponent ${String(index + 1)}`
    }));
    legacyPlayerDbMocks.getGames.mockResolvedValue(games);
    legacyPlayerDbMocks.getAggregatedStatsDocumentForPlayer.mockImplementation(async () => ({
      stats: { pts: 1 },
      timeMs: 60_000
    }));

    const detail = await loadParentPlayerStatsDetail({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.getAggregatedStatsDocumentForPlayer).toHaveBeenCalledTimes(20);
    expect(detail.statRows).toHaveLength(20);
    expect(detail.summary).toMatchObject({
      gamesPlayed: 20,
      gamesWithTime: 20,
      totalTimeMs: 1_200_000,
      totals: { pts: 20 },
      averages: { pts: 1 },
      gameLimit: 20,
      hasMoreGames: true
    });
  });
});

describe('loadParentPlayerAthleteProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads athlete profiles only when explicitly requested for the profile section', async () => {
    legacyPlayerDbMocks.listAthleteProfilesForParent.mockResolvedValue([
      {
        id: 'profile-1',
        privacy: 'public',
        seasons: [
          { teamId: 'team-1', playerId: 'player-1' },
          { teamId: 'team-2', playerId: 'player-2' }
        ]
      },
      {
        id: 'profile-2',
        privacy: 'private',
        seasons: [{ teamId: 'team-9', playerId: 'player-9' }]
      }
    ]);

    const athleteProfile = await loadParentPlayerAthleteProfile({
      uid: 'parent-1',
      parentOf: [
        { teamId: 'team-1', teamName: 'Comets', playerId: 'player-1', playerName: 'Sam Player' },
        { teamId: 'team-2', teamName: 'Storm', playerId: 'player-2', playerName: 'Alex Player' }
      ]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.listAthleteProfilesForParent).toHaveBeenCalledTimes(1);
    expect(legacyPlayerDbMocks.listAthleteProfilesForParent).toHaveBeenCalledWith('parent-1');
    expect(athleteProfile).toEqual(expect.objectContaining({
      profile: expect.objectContaining({ id: 'profile-1' }),
      shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
      builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-1&playerId=player-1&profileId=profile-1',
      seasonOptions: [
        expect.objectContaining({ seasonKey: 'team-1::player-1' }),
        expect.objectContaining({ seasonKey: 'team-2::player-2' })
      ]
    }));
  });

  it('hydrates the athlete profile for non-page callers that need the resolved profile record', async () => {
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
        name: 'Sam Player'
      }
    ]);
    legacyPlayerDbMocks.getGames.mockResolvedValue([]);
    legacyPlayerDbMocks.listCertificatesForPlayer.mockResolvedValue([]);
    legacyPlayerDbMocks.getPublicTrackingItems.mockResolvedValue([]);
    legacyPlayerDbMocks.getPlayerTrackingStatuses.mockResolvedValue([]);
    legacyPlayerDbMocks.getPlayerPrivateProfile.mockResolvedValue(null);
    legacyPlayerDbMocks.getRosterFieldDefinitions.mockResolvedValue([]);
    legacyPlayerDbMocks.listAthleteProfilesForParent.mockResolvedValue([
      {
        id: 'profile-1',
        privacy: 'private',
        seasons: [{ teamId: 'team-1', playerId: 'player-1' }]
      }
    ]);

    const detail = await loadParentPlayerDetailWithAthleteProfile({
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'team-1', teamName: 'Comets', playerId: 'player-1', playerName: 'Sam Player' }]
    } as any, 'team-1', 'player-1');

    expect(legacyPlayerDbMocks.listAthleteProfilesForParent).toHaveBeenCalledWith('parent-1');
    expect(detail.athleteProfile).toEqual(expect.objectContaining({
      profile: expect.objectContaining({ id: 'profile-1' }),
      shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
      builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-1&playerId=player-1&profileId=profile-1'
    }));
  });
});
