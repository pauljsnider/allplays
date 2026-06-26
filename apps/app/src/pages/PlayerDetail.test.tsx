// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const playerServiceMocks = vi.hoisted(() => ({
  loadParentPlayerDetail: vi.fn(),
  markParentPlayerIncentivePaid: vi.fn(),
  retireParentPlayerIncentiveRule: vi.fn(),
  saveParentAthleteProfileDraft: vi.fn(),
  savePlayerCustomRosterFieldValues: vi.fn(),
  saveStaffPlayerRosterDetails: vi.fn(),
  saveParentPlayerIncentiveCap: vi.fn(),
  saveParentPlayerIncentiveRule: vi.fn(),
  sendParentCoParentInvite: vi.fn(),
  toggleParentPlayerIncentiveRule: vi.fn(),
  updateParentPlayerEditableProfile: vi.fn(),
  normalizeAthleteProfileHighlightClipUrl: vi.fn((url: string) => String(url || '').trim())
}));

const publicActionMocks = vi.hoisted(() => ({
  sharePublicUrl: vi.fn()
}));

const profilePhotoServiceMocks = vi.hoisted(() => ({
  acquireProfilePhoto: vi.fn(),
  normalizeProfilePhoto: vi.fn(async (file: File) => file)
}));

vi.mock('../lib/playerService', () => playerServiceMocks);
vi.mock('../lib/publicActions', () => publicActionMocks);
vi.mock('../lib/profilePhotoService', () => profilePhotoServiceMocks);

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
    access: {
      isLinkedParent: true,
      isTeamStaff: false,
      canEditRosterDetails: false,
      canEditCustomRosterFields: false
    },
    customRosterFields: [],
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

  it('shows a retryable player detail error state and reloads on retry', async () => {
    playerServiceMocks.loadParentPlayerDetail
      .mockRejectedValueOnce(new Error('Player detail unavailable.'))
      .mockResolvedValueOnce(buildDetailData());

    renderPlayerDetail();

    expect(await screen.findByText('Player detail unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Sam Player')).toBeTruthy();
    expect(playerServiceMocks.loadParentPlayerDetail).toHaveBeenCalledTimes(2);
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

  it('auto-includes the only linked season and saves without season selection input', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        ...buildDetailData().athleteProfile,
        seasonOptions: [buildDetailData().athleteProfile.seasonOptions[0]]
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('Athlete Profile Builder');

    expect(screen.getByText('Included linked season')).toBeTruthy();
    expect(screen.getByText('Current Team')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save Athlete Profile' }));

    await waitFor(() => {
      expect(playerServiceMocks.saveParentAthleteProfileDraft).toHaveBeenCalledWith(expect.objectContaining({
        draft: expect.objectContaining({
          selectedSeasonKeys: ['team-current::player-current']
        })
      }));
    });
  });

  it('defaults first save to the current season and blocks zero-season saves when multiple seasons are available', async () => {
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

    const status = await screen.findByText('Select at least one linked season to build an athlete profile.');
    expect(status.closest('[role="alert"]')?.getAttribute('aria-live')).toBe('assertive');
    expect(playerServiceMocks.saveParentAthleteProfileDraft).not.toHaveBeenCalled();
  });

  it('uses descriptive alt text for the player photo', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      player: {
        ...buildDetailData().player,
        photoUrl: 'https://cdn.example.test/player.jpg'
      }
    }));

    renderPlayerDetail();

    expect(await screen.findByAltText('Sam Player profile photo')).toBeTruthy();
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

    expect(screen.getByText('Included linked season')).toBeTruthy();
    expect(screen.getByText('Current Team')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();

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
          clips: [{ id: 'clip-1', title: 'Step back', url: 'https://example.test/step-back.mp4' }],
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

  it('shows saved athlete clip titles in the profile builder', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player' },
          bio: {},
          privacy: 'public',
          clips: [{ id: 'clip-old', source: 'upload', title: 'Old clip', url: 'https://example.test/old.mp4' }],
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

    expect(await screen.findByText('Old clip')).toBeTruthy();
    expect(screen.getByText('https://example.test/old.mp4')).toBeTruthy();
  });

  it('prevents saving while an athlete headshot is still preparing', async () => {
    const normalizeDeferred = createDeferred<File>();
    const headshotFile = new File(['headshot-bytes'], 'new-headshot.png', { type: 'image/png' });
    profilePhotoServiceMocks.normalizeProfilePhoto.mockImplementationOnce(() => normalizeDeferred.promise);

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('Athlete Profile Builder');

    fireEvent.change(screen.getByLabelText('Browse file'), { target: { files: [headshotFile] } });

    const preparingButton = await screen.findByRole('button', { name: 'Preparing' });
    expect((preparingButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.submit(preparingButton.closest('form') as HTMLFormElement);

    expect(await screen.findByText('Finish preparing the athlete headshot before saving.')).toBeTruthy();
    expect(playerServiceMocks.saveParentAthleteProfileDraft).not.toHaveBeenCalled();

    normalizeDeferred.resolve(headshotFile);
    expect(await screen.findByText('New headshot selected. Save to publish it.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save Athlete Profile' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('switches the athlete profile save CTA with the selected privacy option', async () => {
    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('Athlete Profile Builder');

    expect(screen.getByRole('button', { name: 'Save Athlete Profile' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'public' }));
    expect(screen.getByRole('button', { name: 'Publish Athlete Profile' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'private' }));
    expect(screen.getByRole('button', { name: 'Save Athlete Profile' })).toBeTruthy();
  });

  it('keeps an existing private profile share URL gated until the public privacy change is saved', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';
    const builderUrl = 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1';

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
        shareUrl,
        builderUrl,
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    const getPublicProfileCard = () => screen.getByRole('link', { name: /Public athlete profile/i });
    expect(getPublicProfileCard().getAttribute('href')).toBe('#');
    expect(getPublicProfileCard().getAttribute('aria-disabled')).toBe('true');
    expect(getPublicProfileCard().getAttribute('tabindex')).toBe('-1');
    expect(getPublicProfileCard().className).toContain('pointer-events-none');
    expect(screen.getByText('Publish and save this profile to enable sharing.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Full Builder' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('This saved share link stays private until you publish and save the profile.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'public' }));

    expect(getPublicProfileCard().getAttribute('href')).toBe('#');
    const saveFirstButton = screen.getByRole('button', { name: 'Publish changes before sharing' });
    expect(screen.getByRole('button', { name: 'Publish Athlete Profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect((saveFirstButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Publish and save this profile before the public share link becomes available.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Full Builder' })).toBeNull();
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    expect(getPublicProfileCard().getAttribute('href')).toBe('#');
    expect(getPublicProfileCard().getAttribute('aria-disabled')).toBe('true');
    expect(getPublicProfileCard().getAttribute('tabindex')).toBe('-1');
    expect(getPublicProfileCard().className).toContain('pointer-events-none');
    expect(screen.getByText('Publish and save this profile to enable sharing.')).toBeTruthy();
  });

  it('keeps sharing gated on the persisted public profile when public is only toggled locally', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';

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
        shareUrl,
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    fireEvent.click(screen.getByRole('button', { name: 'public' }));

    const publicProfileCard = screen.getByRole('link', { name: /Public athlete profile/i });
    const publishBeforeSharingButton = screen.getByRole('button', { name: 'Publish changes before sharing' });

    fireEvent.click(publicProfileCard);

    expect(publicProfileCard.getAttribute('href')).toBe('#');
    expect(publicProfileCard.getAttribute('aria-disabled')).toBe('true');
    expect(publicProfileCard.getAttribute('tabindex')).toBe('-1');
    expect(publicProfileCard.getAttribute('target')).toBeNull();
    expect(publicProfileCard.getAttribute('rel')).toBeNull();
    expect(publicProfileCard.className).toContain('pointer-events-none');
    expect(screen.getByText('Publish and save this profile to enable sharing.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish Athlete Profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Full Builder' })).toBeNull();
    expect((publishBeforeSharingButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Publish and save this profile before the public share link becomes available.')).toBeTruthy();
    expect(playerServiceMocks.saveParentAthleteProfileDraft).not.toHaveBeenCalled();
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'private' }));
    fireEvent.click(screen.getByRole('button', { name: 'public' }));

    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('href')).toBe('#');
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('target')).toBeNull();
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('rel')).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Publish and save this profile before the public share link becomes available.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('href')).toBe('#');
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('aria-disabled')).toBe('true');
  });

  it('does not expose the public share action when only the local privacy toggle changes', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';

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
        shareUrl,
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    fireEvent.click(screen.getByRole('button', { name: 'public' }));

    const publicProfileCard = screen.getByRole('link', { name: /Public athlete profile/i });
    fireEvent.click(publicProfileCard);

    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish Athlete Profile' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(publicProfileCard.getAttribute('href')).toBe('#');
    expect(publicProfileCard.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Publish and save this profile before the public share link becomes available.')).toBeTruthy();
    expect(playerServiceMocks.saveParentAthleteProfileDraft).not.toHaveBeenCalled();
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();
  });

  it('requires saving updated public profile content before sharing the public link', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';

    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player', headline: '2028 Guard' },
          bio: {},
          privacy: 'public',
          clips: [],
          seasons: [{ seasonKey: 'team-current::player-current' }]
        },
        shareUrl,
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    const publicProfileCard = screen.getByRole('link', { name: /Public athlete profile/i });
    expect(publicProfileCard.getAttribute('href')).toBe(shareUrl);
    expect(publicProfileCard.getAttribute('aria-disabled')).toBe('false');
    const shareButton = screen.getByRole('button', { name: 'Share Public Profile' });
    expect(shareButton).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: '2028 Playmaker' } });
    fireEvent.click(shareButton);

    await waitFor(() => {
      const saveFirstButton = screen.getByRole('button', { name: 'Publish changes before sharing' });
      expect((saveFirstButton as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
      expect(publicProfileCard.getAttribute('href')).toBe('#');
      expect(publicProfileCard.getAttribute('aria-disabled')).toBe('true');
      expect(publicProfileCard.className).toContain('pointer-events-none');
    });
    expect(screen.getByText('Publish and save this profile to enable sharing.')).toBeTruthy();
    expect(screen.queryByText('Public athlete profile shared.')).toBeNull();
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();
  });

  it('keeps the persisted share card disabled when a private profile is only toggled public locally', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';

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
        shareUrl,
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    fireEvent.click(screen.getByRole('button', { name: 'public' }));

    const publicProfileCard = screen.getByRole('link', { name: /Public athlete profile/i });
    expect(publicProfileCard.getAttribute('href')).toBe('#');
    expect(publicProfileCard.getAttribute('aria-disabled')).toBe('true');
    expect(publicProfileCard.className).toContain('pointer-events-none');
    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();
  });

  it('does not re-enable the share button for an unsaved public toggle on a profile with an existing private share url', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';

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
        shareUrl,
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

    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Publish and save this profile before the public share link becomes available.')).toBeTruthy();
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();
  });

  it('does not show a waiting-for-publish state when saving changes to an already public profile', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';
    const saveDeferred = createDeferred<{ shareUrl: string }>();

    playerServiceMocks.loadParentPlayerDetail
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player', headline: '2028 Guard' },
            bio: {},
            privacy: 'public',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl,
          builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }))
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player', headline: '2028 Playmaker' },
            bio: {},
            privacy: 'public',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl,
          builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }));
    playerServiceMocks.saveParentAthleteProfileDraft.mockImplementationOnce(() => saveDeferred.promise);

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: '2028 Playmaker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish Athlete Profile' }));

    await waitFor(() => {
      expect(playerServiceMocks.saveParentAthleteProfileDraft).toHaveBeenCalled();
    });

    expect(screen.queryByRole('button', { name: 'Waiting for published profile...' })).toBeNull();
    expect(screen.queryByText('Waiting for refresh to confirm the public share link.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);

    saveDeferred.resolve({ shareUrl });
    expect(await screen.findByRole('button', { name: 'Share Public Profile' })).toBeTruthy();
  });

  it('keeps the public athlete profile card disabled until refresh confirms the saved public publish state', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';
    const refreshDeferred = createDeferred<ReturnType<typeof buildDetailData>>();

    playerServiceMocks.loadParentPlayerDetail
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player' },
            bio: {},
            privacy: 'private',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl,
          builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }))
      .mockImplementationOnce(() => refreshDeferred.promise);

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    const getPublicProfileCard = () => screen.getByRole('link', { name: /Public athlete profile/i });
    expect(getPublicProfileCard().getAttribute('href')).toBe('#');
    expect(getPublicProfileCard().getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    fireEvent.click(screen.getByRole('button', { name: 'public' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish Athlete Profile' }));

    await waitFor(() => {
      expect(playerServiceMocks.saveParentAthleteProfileDraft).toHaveBeenCalledWith(expect.objectContaining({
        draft: expect.objectContaining({ privacy: 'public' })
      }));
    });

    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Waiting for published profile...' })).toBeTruthy();
    expect(screen.getByText('Waiting for refresh to confirm the public share link.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Refresh player' }) as HTMLButtonElement).disabled).toBe(true);
    expect(getPublicProfileCard().getAttribute('href')).toBe('#');
    expect(getPublicProfileCard().getAttribute('aria-disabled')).toBe('true');
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();

    refreshDeferred.resolve(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player' },
          bio: {},
          privacy: 'public',
          clips: [],
          seasons: [{ seasonKey: 'team-current::player-current' }]
        },
        shareUrl,
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    expect(await screen.findByRole('button', { name: 'Share Public Profile' })).toBeTruthy();
    await waitFor(() => {
      expect(getPublicProfileCard().getAttribute('href')).toBe(shareUrl);
      expect(getPublicProfileCard().getAttribute('aria-disabled')).toBe('false');
      expect(getPublicProfileCard().getAttribute('tabindex')).toBeNull();
      expect(getPublicProfileCard().className).not.toContain('pointer-events-none');
    });
    expect(screen.getByText('Open the shareable athlete profile.')).toBeTruthy();
  });

  it('keeps sharing disabled when a publish refresh still returns a private profile', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';
    const refreshDeferred = createDeferred<ReturnType<typeof buildDetailData>>();

    playerServiceMocks.loadParentPlayerDetail
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player' },
            bio: {},
            privacy: 'private',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl,
          builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }))
      .mockImplementationOnce(() => refreshDeferred.promise);

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    fireEvent.click(screen.getByRole('button', { name: 'public' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish Athlete Profile' }));

    refreshDeferred.resolve(buildDetailData({
      athleteProfile: {
        profile: {
          id: 'profile-1',
          athlete: { name: 'Sam Player' },
          bio: {},
          privacy: 'private',
          clips: [],
          seasons: [{ seasonKey: 'team-current::player-current' }]
        },
        shareUrl,
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    });
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
  });

  it('keeps a public profile card disabled when the saved share URL is missing', async () => {
    const builderUrl = 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1';

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
        shareUrl: '',
        builderUrl,
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    const publicProfileCard = screen.getByRole('link', { name: /Public athlete profile/i });
    expect(publicProfileCard.getAttribute('href')).toBe('#');
    expect(publicProfileCard.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Publish and save this profile to enable sharing.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Full Builder' }).getAttribute('href')).toBe(builderUrl);
  });

  it('refreshes the athlete profile editor when persisted public sharing becomes available', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';
    const builderUrl = 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1';

    playerServiceMocks.loadParentPlayerDetail
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player' },
            bio: {},
            privacy: 'private',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl: '',
          builderUrl,
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }))
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player' },
            bio: {},
            privacy: 'public',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl,
          builderUrl,
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    expect(screen.getByRole('link', { name: 'Open Full Builder' }).getAttribute('href')).toBe(builderUrl);
    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh player' }));

    expect(await screen.findByRole('button', { name: 'Share Public Profile' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('href')).toBe(shareUrl);
    expect(screen.queryByRole('button', { name: 'Publish changes before sharing' })).toBeNull();
  });

  it('removes stale public share actions after a refresh clears the persisted share URL', async () => {
    const builderUrl = 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1';

    playerServiceMocks.loadParentPlayerDetail
      .mockResolvedValueOnce(buildDetailData({
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
          builderUrl,
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }))
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player' },
            bio: {},
            privacy: 'public',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl: '',
          builderUrl,
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    expect(screen.getByRole('button', { name: 'Share Public Profile' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh player' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    });
    expect(screen.getByRole('link', { name: 'Open Full Builder' }).getAttribute('href')).toBe(builderUrl);
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
  });

  it('removes stale public share actions after a refresh returns a private persisted profile with an old share URL', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';
    const builderUrl = 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1';

    playerServiceMocks.loadParentPlayerDetail
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player' },
            bio: {},
            privacy: 'public',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl,
          builderUrl,
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }))
      .mockResolvedValueOnce(buildDetailData({
        athleteProfile: {
          profile: {
            id: 'profile-1',
            athlete: { name: 'Sam Player' },
            bio: {},
            privacy: 'private',
            clips: [],
            seasons: [{ seasonKey: 'team-current::player-current' }]
          },
          shareUrl,
          builderUrl,
          seasonOptions: buildDetailData().athleteProfile.seasonOptions
        }
      }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    expect(screen.getByRole('button', { name: 'Share Public Profile' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('href')).toBe(shareUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh player' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    });
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Full Builder' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('This saved share link stays private until you publish and save the profile.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('href')).toBe('#');
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('aria-disabled')).toBe('true');
  });

  it('does not re-enable sharing when a private saved profile already has a share url and only local privacy is toggled to public', async () => {
    const shareUrl = 'https://allplays.ai/athlete-profile.html?profileId=profile-1';

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
        shareUrl,
        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-current&playerId=player-current&profileId=profile-1',
        seasonOptions: buildDetailData().athleteProfile.seasonOptions
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athlete Profile' }));
    await screen.findByText('What others see');

    fireEvent.click(screen.getByRole('button', { name: 'public' }));

    expect(screen.queryByRole('button', { name: 'Share Public Profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Preview Public Page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Full Builder' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish changes before sharing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Publish and save this profile before the public share link becomes available.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('href')).toBe('#');
    expect(screen.getByRole('link', { name: /Public athlete profile/i }).getAttribute('aria-disabled')).toBe('true');
    expect(publicActionMocks.sharePublicUrl).not.toHaveBeenCalled();
  });
});


describe('PlayerDetail staff roster editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      access: {
        isLinkedParent: false,
        isTeamStaff: true,
        canEditRosterDetails: true,
        canEditCustomRosterFields: false
      }
    }));
    playerServiceMocks.saveStaffPlayerRosterDetails.mockResolvedValue({ updatedFields: ['number'] });
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders native staff roster editing and saves name and number changes', async () => {
    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    expect(await screen.findByText('Roster Details')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Player name'), { target: { value: 'Samuel Player' } });
    fireEvent.change(screen.getByLabelText('Jersey number'), { target: { value: '44' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Roster Details' }));

    await waitFor(() => {
      expect(playerServiceMocks.saveStaffPlayerRosterDetails).toHaveBeenCalledWith({
        user: auth.user,
        teamId: 'team-current',
        playerId: 'player-current',
        currentPlayer: expect.objectContaining({
          name: 'Sam Player',
          number: '12'
        }),
        name: 'Samuel Player',
        number: '44',
        photoFile: null,
        removePhoto: false
      });
    });
  });

  it('keeps coachOf-only staff out of the roster editor', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      access: {
        isLinkedParent: false,
        isTeamStaff: true,
        canEditRosterDetails: false,
        canEditCustomRosterFields: false
      }
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    await screen.findByText('Player profile');
    expect(screen.queryByText('Roster Details')).toBeNull();
  });
});

describe('PlayerDetail custom roster fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      access: {
        isLinkedParent: false,
        isTeamStaff: true,
        canEditRosterDetails: true,
        canEditCustomRosterFields: true
      },
      customRosterFields: [
        {
          key: 'nickname',
          label: 'Nickname',
          type: 'text',
          visibility: 'team',
          required: false,
          options: [],
          value: 'Rocket'
        },
        {
          key: 'jerseySize',
          label: 'Jersey Size',
          type: 'menu',
          visibility: 'admins',
          required: false,
          options: [{ value: 'YS', label: 'Youth Small' }, { value: 'YM', label: 'Youth Medium' }],
          value: 'YS'
        },
        {
          key: 'waiver',
          label: 'Waiver On File',
          type: 'checkbox',
          visibility: 'team',
          required: false,
          options: [],
          value: true
        }
      ]
    }));
    playerServiceMocks.savePlayerCustomRosterFieldValues.mockResolvedValue({});
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders editable custom roster fields and saves their values', async () => {
    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    expect(await screen.findByText('Custom roster fields')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Speedy' } });
    fireEvent.change(screen.getByLabelText('Jersey Size'), { target: { value: 'YM' } });
    fireEvent.click(screen.getByLabelText('Waiver On File'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Custom Fields' }));

    await waitFor(() => {
      expect(playerServiceMocks.savePlayerCustomRosterFieldValues).toHaveBeenCalledWith({
        user: auth.user,
        teamId: 'team-current',
        playerId: 'player-current',
        values: {
          nickname: 'Speedy',
          jerseySize: 'YM',
          waiver: false
        }
      });
    });
  });

  it('renders parent-visible custom roster values without edit controls', async () => {
    playerServiceMocks.loadParentPlayerDetail.mockResolvedValue(buildDetailData({
      access: {
        isLinkedParent: true,
        isTeamStaff: false,
        canEditRosterDetails: false,
        canEditCustomRosterFields: false
      },
      customRosterFields: [
        {
          key: 'nickname',
          label: 'Nickname',
          type: 'text',
          visibility: 'team',
          required: false,
          options: [],
          value: 'Rocket'
        }
      ]
    }));

    renderPlayerDetail();

    await screen.findByText('Sam Player');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    expect((await screen.findByDisplayValue('Rocket') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save Custom Fields' })).toBeNull();
  });
});
