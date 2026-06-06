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
  getTeam: vi.fn(),
  inviteCoParentToAthlete: vi.fn(),
  listAthleteProfilesForParent: vi.fn(),
  listCertificatesForPlayer: vi.fn(),
  saveAthleteProfile: vi.fn(),
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
vi.mock('./scheduleService', () => ({
  loadParentSchedule: vi.fn()
}));

import { saveParentAthleteProfileDraft } from './playerService';

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
