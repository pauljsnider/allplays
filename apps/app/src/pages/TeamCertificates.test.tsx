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

const publicActionMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn()
}));

vi.mock('../lib/certificateDraftService', () => certificateDraftServiceMocks);
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
    certificateDraftServiceMocks.loadCertificateDraftComposer.mockResolvedValue(composerModel);
    certificateDraftServiceMocks.saveCertificateDraftsForApp.mockResolvedValue({
      batchId: 'batch-1',
      certificateIds: ['cert-1'],
      webUrl: 'https://allplays.ai/certificates.html#teamId=team-1&batchId=batch-1'
    });
  });

  afterEach(() => {
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

    expect(await screen.findByRole('heading', { name: 'Awards drafts' })).toBeTruthy();
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

    expect(await screen.findByRole('heading', { name: 'Awards drafts' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create drafts' }));

    expect(await screen.findByText('Unable to create certificate drafts.')).toBeTruthy();
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('opens the awards web studio for AI narratives, publish, and print continuation', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/team-1/certificates']}>
        <Routes>
          <Route path="/teams/:teamId/certificates" element={<TeamCertificates auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Awards drafts' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open website' }));

    await waitFor(() => {
      expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/certificates.html#teamId=team-1');
    });
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
