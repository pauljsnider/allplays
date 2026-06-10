// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playerServiceMocks = vi.hoisted(() => ({
  loadParentPlayerDetail: vi.fn(),
  markParentPlayerIncentivePaid: vi.fn(),
  retireParentPlayerIncentiveRule: vi.fn(),
  saveParentAthleteProfileDraft: vi.fn(),
  saveParentPlayerIncentiveCap: vi.fn(),
  saveParentPlayerIncentiveRule: vi.fn(),
  sendParentCoParentInvite: vi.fn(),
  toggleParentPlayerIncentiveRule: vi.fn(),
  updateParentPlayerEditableProfile: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
  sharePublicUrl: vi.fn()
}));

vi.mock('../lib/playerService', () => playerServiceMocks);
vi.mock('../lib/publicActions', () => publicActionMocks);

import { PlayerDetail } from './PlayerDetail';
import type { AuthState } from '../lib/types';

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    parentOf: [
      { teamId: 'team-current', teamName: 'Current Team', playerId: 'player-current', playerName: 'Sam Player' },
      { teamId: 'team-prior', teamName: 'Prior Team', playerId: 'player-prior', playerName: 'Sam Player' }
    ]
  } as any,
  profile: null,
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

function buildDetailData(overrides: Record<string, any> = {}) {
  return {
    child: {
      teamId: 'team-current',
      teamName: 'Current Team',
      playerId: 'player-current',
      playerName: 'Sam Player'
    },
    player: {
      id: 'player-current',
      teamId: 'team-current',
      teamName: 'Current Team',
      name: 'Sam Player',
      number: '12',
      photoUrl: ''
    },
    team: { id: 'team-current', name: 'Current Team' },
    events: [],
    nextEvent: null,
    actionCounts: {
      rsvpNeeded: 0,
      packetsReady: 0,
      openAssignments: 0
    },
    statRows: [],
    clips: [],
    certificates: [],
    trackingSummary: [],
    privateProfile: null,
    incentives: {
      rules: [],
      currentRules: [],
      statOptions: [],
      maxPerGameCents: null,
      seasonGameEarnings: [],
      totalEarnedCents: 0,
      totalPaidCents: 0,
      unpaidCents: 0
    },
    athleteProfile: {
      profile: null,
      shareUrl: '',
      builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current',
      seasonOptions: [
        {
          seasonKey: 'team-current::player-current',
          teamId: 'team-current',
          teamName: 'Current Team',
          playerId: 'player-current',
          playerName: 'Sam Player'
        },
        {
          seasonKey: 'team-prior::player-prior',
          teamId: 'team-prior',
          teamName: 'Prior Team',
          playerId: 'player-prior',
          playerName: 'Sam Player'
        }
      ]
    },
    ...overrides
  };
}

function renderPlayerDetail() {
  return render(
    <MemoryRouter initialEntries={['/players/team-current/player-current']}>
      <Routes>
        <Route path="/players/:teamId/:playerId" element={<PlayerDetail auth={auth} />} />
        <Route path="/home" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PlayerDetail athlete profile season selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData());
    playerServiceMocks.saveParentAthleteProfileDraft.mockResolvedValue({
      shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1'
    });
    publicActionMocks.sharePublicUrl.mockResolvedValue('shared');
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('preselects existing saved seasons and passes updated selections on save', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player' },
          bio: {},
          privacy: 'public',
          clips: [],
          seasons: [
            { seasonKey: 'team-current::player-current', teamName: 'Current Team', playerName: 'Sam Player' },
            { seasonKey: 'team-prior::player-prior', teamName: 'Prior Team', playerName: 'Sam Player' }
          ]
        },
        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('Athlete Profile Builder');

    const currentSeason = await screen.findByLabelText('Sam Player Current Team');
    const priorSeason = screen.getByLabelText('Sam Player Prior Team');
    expect((currentSeason as HTMLInputElement).checked).toBe(true);
    expect((priorSeason as HTMLInputElement).checked).toBe(true);

    fireEvent.click(currentSeason);
    fireEvent.click(screen.getByRole('button', { name: 'Publish Athlete Profile' }));

    await waitFor(() => {
      expect(playerServiceMocks.saveParentAthleteProfileDraft).toHaveBeenCalledWith(expect.objectContaining({
        draft: expect.objectContaining({
          selectedSeasonKeys: ['team-prior::player-prior']
        })
      }));
    });
  });

  it('defaults first save to the current season and blocks zero-season saves', async () => {
    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('Athlete Profile Builder');

    const currentSeason = await screen.findByLabelText('Sam Player Current Team');
    const priorSeason = screen.getByLabelText('Sam Player Prior Team');
    expect((currentSeason as HTMLInputElement).checked).toBe(true);
    expect((priorSeason as HTMLInputElement).checked).toBe(false);

    fireEvent.click(currentSeason);
    fireEvent.click(screen.getByRole('button', { name: 'Save Athlete Profile' }));

    expect(await screen.findByText('Select at least one linked season to build an athlete profile.')).toBeTruthy();
    expect(playerServiceMocks.saveParentAthleteProfileDraft).not.toHaveBeenCalled();
  });

  it('preselects saved seasons from older profile shapes without seasonKey', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-legacy',
          athlete: { name: 'Sam Player' },
          bio: {},
          privacy: 'public',
          clips: [],
          seasons: [
            { teamId: 'team-current', playerId: 'player-current', teamName: 'Current Team', playerName: 'Sam Player' },
            { teamId: 'team-prior', playerId: 'player-prior', teamName: 'Prior Team', playerName: 'Sam Player' }
          ]
        },
        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-legacy',
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-legacy',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('Athlete Profile Builder');

    const currentSeason = await screen.findByLabelText('Sam Player Current Team');
    const priorSeason = screen.getByLabelText('Sam Player Prior Team');
    expect((currentSeason as HTMLInputElement).checked).toBe(true);
    expect((priorSeason as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Publish Athlete Profile' }));

    await waitFor(() => {
      expect(playerServiceMocks.saveParentAthleteProfileDraft).toHaveBeenCalledWith(expect.objectContaining({
        draft: expect.objectContaining({
          selectedSeasonKeys: ['team-current::player-current', 'team-prior::player-prior']
        })
      }));
    });
  });

  it('falls back to the current linked season when season options are missing', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player' },
          bio: {},
          privacy: 'public',
          clips: [],
          seasons: [{ teamId: 'team-current', playerId: 'player-current' }]
        },
        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1'
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('Athlete Profile Builder');

    const fallbackSeason = await screen.findByLabelText('Sam Player Current Team');
    expect((fallbackSeason as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Publish Athlete Profile' }));

    await waitFor(() => {
      expect(playerServiceMocks.saveParentAthleteProfileDraft).toHaveBeenCalledWith(expect.objectContaining({
        draft: expect.objectContaining({
          selectedSeasonKeys: ['team-current::player-current']
        })
      }));
    });
  });

  it('shares the published athlete profile through the native share helper', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player' },
          bio: {},
          privacy: 'public',
          clips: [],
          seasons: [{ seasonKey: 'team-current::player-current' }]
        },
        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    fireEvent.click(screen.getByRole('button', { name: 'Share Public Profile' }));

    await waitFor(() => {
      expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith({
        title: 'Sam Player profile',
        text: 'Take a look at this athlete profile on ALL PLAYS.',
        url: 'https://allplays.ai/athlete-profile.html?profileId=profile-1'
      });
    });
  });

  it('shows the publish disclosure before confirming a public profile', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player', headline: '2028 Guard' },
          bio: { position: 'Guard', hometown: 'Kansas City' },
          privacy: 'private',
          clips: [{ id: 'clip-1', title: 'Step back' }],
          seasons: [{ seasonKey: 'team-current::player-current' }]
        },
        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));

    expect(await screen.findByText('What others see')).toBeTruthy();
    expect(screen.getByText('Publishing makes this read-only athlete profile public at the share link.')).toBeTruthy();
    expect(screen.getByText('• 1 season of stats and game clips')).toBeTruthy();
    expect(screen.getByText('• 1 highlight clip')).toBeTruthy();
  });

  it('keeps sharing gated until the public privacy change is saved', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player' },
          bio: {},
          privacy: 'private',
          clips: [],
          seasons: [{ seasonKey: 'team-current::player-current' }]
        },
        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'public' }));

    const saveFirstButton = screen.getByRole('button', { name: 'Save to publish before sharing' });
    expect(screen.getByRole('button', { name: 'Publish Athlete Profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(saveFirstButton).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
  });
});
