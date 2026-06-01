// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../lib/types';

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('TeamMedia lazy chat loading', () => {
  it('renders the media route without loading chat service until a post action is requested', async () => {
    vi.doMock('../lib/parentToolsService', () => ({
      addParentTeamMediaLink: vi.fn(),
      bulkDeleteTeamMediaItemsForApp: vi.fn(),
      createTeamMediaAlbumForApp: vi.fn(),
      deleteTeamMediaItemForApp: vi.fn(),
      loadTeamMediaForApp: vi.fn().mockResolvedValue({
        team: { id: 'team-1', name: 'Bears' },
        canManage: false,
        canContribute: false,
        canPostChat: false,
        folders: [{
          id: 'folder-1',
          name: 'Game photos',
          visibility: 'team',
          itemCount: 1,
          items: [{ id: 'photo-1', title: 'Tipoff', type: 'photo', url: 'https://img.example.test/tipoff.jpg', uploadedBy: 'user-1' }]
        }]
      }),
      moveTeamMediaItemForApp: vi.fn(),
      updateTeamMediaItemForApp: vi.fn(),
      uploadParentTeamMediaFile: vi.fn(),
      uploadParentTeamMediaPhoto: vi.fn()
    }));
    vi.doMock('../lib/publicActions', () => ({
      openPublicUrl: vi.fn(),
      sharePublicUrl: vi.fn().mockResolvedValue('shared')
    }));
    vi.doMock('../lib/chatService', () => {
      throw new Error('chat service should not load during initial TeamMedia render');
    });

    const { TeamMedia } = await import('./TeamMedia');
    const auth: AuthState = {
      user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
      } as any,
      profile: {},
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

    render(
      <MemoryRouter initialEntries={["/teams/team-1/media"]}>
        <Routes>
          <Route path="/teams/:teamId/media" element={<TeamMedia auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears media' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Game photos1' })).toBeTruthy();
    expect(screen.getByText('Tipoff')).toBeTruthy();
  });
});
