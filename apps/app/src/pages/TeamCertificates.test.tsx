// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamCertificates } from './TeamCertificates';
import type { AuthState } from '../lib/types';

const certificateDraftServiceMocks = vi.hoisted(() => ({
  getCertificateStudioUrl: vi.fn((teamId: string, batchId = '') => {
    const url = new URL('certificates.html', 'https://allplays.ai');
    const params = new URLSearchParams({ teamId });
    if (batchId) params.set('batchId', batchId);
    url.hash = params.toString();
    return url.toString();
  }),
  loadCertificateDraftComposer: vi.fn(),
  saveCertificateDraftsForApp: vi.fn()
}));

const certificateAwardServiceMocks = vi.hoisted(() => ({
  buildCertificateAwardDraftsForApp: vi.fn(({ batchId, certificateIds, players, shared }) => players.map((player: any, index: number) => ({
    id: certificateIds[index],
    certificateId: certificateIds[index],
    batchId,
    playerId: player.id,
    recipientName: player.name,
    playerNumber: player.number,
    playerPhotoUrl: player.photoUrl || null,
    awardTitle: shared.awardTitle,
    description: '',
    descriptionSource: 'ai',
    descriptionStatus: 'pending',
    statsWindow: shared.statsWindow,
    includeInExport: true,
    errorMessage: null,
    status: 'draft',
    customDescriptionHint: player.customDescriptionHint || ''
  }))),
  generateCertificateAwardNarrativesForApp: vi.fn(async ({ drafts }) => drafts.map((draft: any) => ({
    ...draft,
    description: `AI narrative for ${draft.recipientName}`,
    descriptionSource: 'ai',
    descriptionStatus: 'ready',
    errorMessage: null
  }))),
  publishCertificateAwardsForApp: vi.fn(async ({ drafts }) => ({
    publishedCertificateIds: drafts.map((draft: any) => draft.certificateId),
    batchIds: Array.from(new Set(drafts.map((draft: any) => draft.batchId))),
    parentVisibility: drafts.map((draft: any) => ({
      teamId: 'team-1',
      playerId: draft.playerId,
      certificateId: draft.certificateId,
      status: 'published'
    }))
  }))
}));

const certificateExportMocks = vi.hoisted(() => ({
  getCertificateFilename: vi.fn(() => 'bears-pat-player-spring-2026.png'),
  renderNodeToPngBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
}));

const publicActionMocks = vi.hoisted(() => ({
  exportCertificatePngFile: vi.fn(async () => 'downloaded'),
  openPublicUrl: vi.fn()
}));

vi.mock('../lib/certificateDraftService', () => certificateDraftServiceMocks);
vi.mock('../lib/certificateAwardService', () => certificateAwardServiceMocks);
vi.mock('../lib/adapters/legacyCertificateExport', () => certificateExportMocks);
vi.mock('../lib/publicActions', () => publicActionMocks);
vi.mock('../lib/adapters/legacyCertificates', () => ({
  renderCertificate: vi.fn(() => {
    const node = document.createElement('div');
    node.textContent = 'Certificate preview';
    return node;
  })
}));

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach'
  } as any,
  profile: null,
  loading: false,
  error: null,
  roles: ['coach'],
  isParent: false,
  isCoach: true,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const composerModel = {
  team: {
    id: 'team-1',
    name: 'Bears',
    photoUrl: 'https://img.example.test/team.png',
    colors: { primary: '#0055aa' }
  },
  players: [
    {
      id: 'player-1',
      name: 'Pat Player',
      number: '12',
      photoUrl: null,
      active: true
    }
  ],
  templates: [
    { id: 'banner', label: 'Banner' }
  ],
  shared: {
    templateId: 'banner',
    teamNameOverride: 'Bears',
    awardTitle: 'Most Improved Player',
    seasonLabel: 'Spring 2026',
    footerUrl: 'www.allplays.ai',
    descriptionTone: 'celebratory and specific',
    colorMode: 'team',
    customColors: {
      borderColor: '#111111',
      accentColor: '#222222',
      textColor: '#333333'
    },
    fonts: {},
    signers: [],
    foregroundImageRef: null,
    backgroundImageRef: null,
    backgroundOpacity: 18,
    watermarkImageRef: null,
    watermarkOpacity: 12,
    statsWindow: 10
  }
};

describe('TeamCertificates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    certificateDraftServiceMocks.loadCertificateDraftComposer.mockResolvedValue(composerModel);
    certificateDraftServiceMocks.saveCertificateDraftsForApp.mockResolvedValue({
      batchId: 'batch-1',
      certificateIds: ['cert-1'],
      webUrl: 'https://allplays.ai/certificates.html#teamId=team-1&batchId=batch-1'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('shows a retry path when the initial certificate load fails', async () => {
    certificateDraftServiceMocks.loadCertificateDraftComposer
      .mockRejectedValueOnce(new Error('Unable to load certificate drafting.'))
      .mockResolvedValueOnce(composerModel);

    render(
      <MemoryRouter initialEntries={['/teams/team-1/certificates']}>
        <Routes>
          <Route path="/teams/:teamId/certificates" element={<TeamCertificates auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Certificate drafting unavailable')).toBeTruthy();
    expect(screen.getByText('Unable to load certificate drafting.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Awards studio' })).toBeTruthy();
    await waitFor(() => {
      expect(certificateDraftServiceMocks.loadCertificateDraftComposer).toHaveBeenCalledTimes(2);
    });
  });

  it('shows a save error when draft creation fails', async () => {
    certificateDraftServiceMocks.saveCertificateDraftsForApp.mockRejectedValueOnce(new Error('Unable to create certificate drafts.'));

    render(
      <MemoryRouter initialEntries={['/teams/team-1/certificates']}>
        <Routes>
          <Route path="/teams/:teamId/certificates" element={<TeamCertificates auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Awards studio' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /create drafts/i }));

    expect(await screen.findByText('Unable to create certificate drafts.')).toBeTruthy();
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('keeps an explicit awards web studio escape hatch', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/team-1/certificates']}>
        <Routes>
          <Route path="/teams/:teamId/certificates" element={<TeamCertificates auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Awards studio' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open website' }));

    await waitFor(() => {
      expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/certificates.html#teamId=team-1');
    });
  });

  it('creates drafts, generates editable narratives, and does not hand off to the website', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/team-1/certificates']}>
        <Routes>
          <Route path="/teams/:teamId/certificates" element={<TeamCertificates auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Awards studio' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /create drafts/i }));

    expect(await screen.findByDisplayValue('AI narrative for Pat Player')).toBeTruthy();
    expect(certificateDraftServiceMocks.saveCertificateDraftsForApp).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      selectedPlayers: [expect.objectContaining({ id: 'player-1' })]
    }));
    expect(certificateAwardServiceMocks.generateCertificateAwardNarrativesForApp).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      drafts: [expect.objectContaining({ certificateId: 'cert-1' })]
    }));
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('requires explicit review confirmation before publishing generated awards', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/team-1/certificates']}>
        <Routes>
          <Route path="/teams/:teamId/certificates" element={<TeamCertificates auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Awards studio' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create drafts/i }));
    expect(await screen.findByDisplayValue('AI narrative for Pat Player')).toBeTruthy();

    const publishButton = screen.getByRole('button', { name: /publish selected/i });
    expect(publishButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText('I reviewed these certificate descriptions and they are ready for parents.'));
    fireEvent.click(screen.getByRole('button', { name: /publish selected/i }));

    await waitFor(() => {
      expect(certificateAwardServiceMocks.publishCertificateAwardsForApp).toHaveBeenCalledWith(expect.objectContaining({
        teamId: 'team-1',
        reviewConfirmed: true,
        drafts: [expect.objectContaining({
          certificateId: 'cert-1',
          description: 'AI narrative for Pat Player'
        })]
      }));
    });
    expect(await screen.findByText('Published 1 certificate for parent viewing.')).toBeTruthy();
  });

  it('shows export failures without changing the drafted award', async () => {
    publicActionMocks.exportCertificatePngFile.mockRejectedValueOnce(new Error('Native certificate share failed.'));

    render(
      <MemoryRouter initialEntries={['/teams/team-1/certificates']}>
        <Routes>
          <Route path="/teams/:teamId/certificates" element={<TeamCertificates auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Awards studio' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create drafts/i }));
    expect(await screen.findByDisplayValue('AI narrative for Pat Player')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /export png/i }));

    expect(await screen.findByText('Native certificate share failed.')).toBeTruthy();
    expect(screen.getByDisplayValue('AI narrative for Pat Player')).toBeTruthy();
  });

  it('ignores stale certificate loads after navigating to a different team', async () => {
    const teamOneLoad = createDeferred<typeof composerModel>();
    const teamTwoLoad = createDeferred<typeof composerModel>();

    certificateDraftServiceMocks.loadCertificateDraftComposer.mockImplementation((requestedTeamId: string) => {
      if (requestedTeamId === 'team-1') return teamOneLoad.promise;
      if (requestedTeamId === 'team-2') return teamTwoLoad.promise;
      throw new Error(`Unexpected team id: ${requestedTeamId}`);
    });

    const router = createMemoryRouter(
      [
        {
          path: '/teams/:teamId/certificates',
          element: <TeamCertificates auth={auth} />
        }
      ],
      { initialEntries: ['/teams/team-1/certificates'] }
    );

    render(<RouterProvider router={router} />);

    await act(async () => {
      await router.navigate('/teams/team-2/certificates');
    });

    teamTwoLoad.resolve({
      ...composerModel,
      team: {
        ...composerModel.team,
        id: 'team-2',
        name: 'Wolves'
      },
      players: [
        {
          id: 'player-2',
          name: 'Wade Wolf',
          number: '7',
          photoUrl: null,
          active: true
        }
      ],
      shared: {
        ...composerModel.shared,
        awardTitle: 'Team Two Award'
      }
    });

    expect(await screen.findByDisplayValue('Team Two Award')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Wade Wolf' })).toBeTruthy();

    teamOneLoad.resolve(composerModel);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Team Two Award')).toBeTruthy();
      expect(screen.getByRole('option', { name: 'Wade Wolf' })).toBeTruthy();
      expect(screen.queryByRole('option', { name: 'Pat Player' })).toBeNull();
    });
  });
});
