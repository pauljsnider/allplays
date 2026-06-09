// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamMedia } from './TeamMedia';
import type { AuthState } from '../lib/types';

const parentToolsServiceMocks = vi.hoisted(() => ({
  addParentTeamMediaLink: vi.fn(),
  bulkDeleteTeamMediaItemsForApp: vi.fn(),
  createTeamMediaAlbumForApp: vi.fn(),
  deleteTeamMediaItemForApp: vi.fn(),
  loadTeamMediaForApp: vi.fn(),
  moveTeamMediaItemForApp: vi.fn(),
  setTeamMediaAlbumCoverForApp: vi.fn(),
  updateTeamMediaItemForApp: vi.fn(),
  uploadParentTeamMediaFile: vi.fn(),
  uploadParentTeamMediaPhoto: vi.fn()
}));

const chatServiceMocks = vi.hoisted(() => ({
  sendTeamChatMessage: vi.fn()
}));

vi.mock('../lib/parentToolsService', () => parentToolsServiceMocks);
vi.mock('../lib/publicActions', () => ({
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn().mockResolvedValue('shared')
}));
vi.mock('../lib/chatService', () => chatServiceMocks);
vi.mock('../lib/chatLogic', () => ({
  DEFAULT_TEAM_CONVERSATION_ID: 'team-chat'
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

function createModel(overrides: Record<string, any> = {}) {
  return {
    team: { id: 'team-1', name: 'Bears' },
    canManage: true,
    canContribute: false,
    canPostChat: false,
    folders: [
      {
        id: 'album-1',
        name: 'Game day',
        visibility: 'team',
        itemCount: 3,
        items: [
          { id: 'photo-1', title: 'Photo one', type: 'photo', url: 'https://example.com/photo-1.jpg', uploadedBy: 'coach-1' },
          { id: 'photo-2', title: 'Photo two', type: 'photo', url: 'https://example.com/photo-2.jpg', uploadedBy: 'coach-1' },
          { id: 'file-1', title: 'Roster PDF', type: 'file', url: 'https://example.com/roster.pdf', uploadedBy: 'coach-1' }
        ]
      }
    ],
    ...overrides
  };
}

function renderTeamMedia(customAuth: AuthState = auth) {
  return render(
    <MemoryRouter initialEntries={['/teams/team-1/media']}>
      <Routes>
        <Route path="/teams/:teamId/media" element={<TeamMedia auth={customAuth} />} />
        <Route path="/teams/:teamId" element={<div>Team detail</div>} />
        <Route path="/teams" element={<div>Teams</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TeamMedia bulk delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parentToolsServiceMocks.addParentTeamMediaLink.mockReset();
    parentToolsServiceMocks.bulkDeleteTeamMediaItemsForApp.mockReset();
    parentToolsServiceMocks.createTeamMediaAlbumForApp.mockReset();
    parentToolsServiceMocks.deleteTeamMediaItemForApp.mockReset();
    parentToolsServiceMocks.loadTeamMediaForApp.mockReset();
    parentToolsServiceMocks.moveTeamMediaItemForApp.mockReset();
    parentToolsServiceMocks.setTeamMediaAlbumCoverForApp.mockReset();
    parentToolsServiceMocks.updateTeamMediaItemForApp.mockReset();
    parentToolsServiceMocks.uploadParentTeamMediaFile.mockReset();
    parentToolsServiceMocks.uploadParentTeamMediaPhoto.mockReset();
    chatServiceMocks.sendTeamChatMessage.mockReset();
    chatServiceMocks.sendTeamChatMessage.mockResolvedValue({ conversationId: 'team-chat', createdConversation: null, wantsAi: false });
    vi.stubGlobal('confirm', vi.fn(() => true));
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lets a manager select items, bulk delete them, and refresh the same filtered view', async () => {
    parentToolsServiceMocks.loadTeamMediaForApp
      .mockResolvedValueOnce(createModel())
      .mockResolvedValueOnce(createModel({
        folders: [
          {
            id: 'album-1',
            name: 'Game day',
            visibility: 'team',
            itemCount: 1,
            items: [
              { id: 'file-1', title: 'Roster PDF', type: 'file', url: 'https://example.com/roster.pdf', uploadedBy: 'coach-1' }
            ]
          }
        ]
      }));
    parentToolsServiceMocks.bulkDeleteTeamMediaItemsForApp.mockResolvedValue(undefined);

    renderTeamMedia();

    await screen.findByText('Bears media');
    fireEvent.click(screen.getByRole('button', { name: 'Photos2' }));
    fireEvent.click(screen.getByLabelText('Select Photo one'));
    fireEvent.click(screen.getByLabelText('Select Photo two'));

    expect(screen.getByText('2 selected in this view')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

    expect(parentToolsServiceMocks.bulkDeleteTeamMediaItemsForApp).toHaveBeenCalledWith('team-1', [
      expect.objectContaining({ id: 'photo-1', type: 'photo', url: 'https://example.com/photo-1.jpg' }),
      expect.objectContaining({ id: 'photo-2', type: 'photo', url: 'https://example.com/photo-2.jpg' })
    ]);
    expect(await screen.findByText('2 media items deleted.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Photos0' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('No photos in this album.')).toBeTruthy();
    expect(screen.getByText('0 selected in this view')).toBeTruthy();
  });

  it('hides selection controls from non-managers', async () => {
    parentToolsServiceMocks.loadTeamMediaForApp.mockResolvedValueOnce(createModel({ canManage: false }));

    renderTeamMedia();

    await screen.findByText('Bears media');
    expect(screen.queryByText('Bulk actions')).toBeNull();
    expect(screen.queryByLabelText('Select Photo one')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();
  });

  it('keeps the current selection when bulk delete fails', async () => {
    parentToolsServiceMocks.loadTeamMediaForApp.mockResolvedValueOnce(createModel());
    parentToolsServiceMocks.bulkDeleteTeamMediaItemsForApp.mockRejectedValue(new Error('Delete failed.'));

    renderTeamMedia();

    await screen.findByText('Bears media');
    const selectPhotoOne = screen.getByLabelText('Select Photo one') as HTMLInputElement;
    fireEvent.click(selectPhotoOne);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

    expect(await screen.findByText('Delete failed.')).toBeTruthy();
    expect(selectPhotoOne.checked).toBe(true);
    expect(screen.getByText('1 selected in this view')).toBeTruthy();
  });

  it('posts a photo to the default team conversation', async () => {
    parentToolsServiceMocks.loadTeamMediaForApp.mockResolvedValueOnce(createModel({
      canContribute: true,
      canPostChat: true
    }));

    renderTeamMedia();

    await screen.findByText('Bears media');
    fireEvent.click(screen.getByLabelText('Post Photo one to team chat'));
    fireEvent.change(screen.getByLabelText('Caption for team chat'), { target: { value: '  Great start  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }));

    expect(chatServiceMocks.sendTeamChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      text: 'Great start',
      selectedConversationId: 'team-chat',
      selectedRecipientTarget: 'full_team',
      selectedRecipientIds: [],
      attachments: [expect.objectContaining({
        type: 'image',
        url: 'https://example.com/photo-1.jpg',
        name: 'Photo one'
      })]
    }));
    expect(await screen.findByText('Photo posted to team chat.')).toBeTruthy();
  });
});
