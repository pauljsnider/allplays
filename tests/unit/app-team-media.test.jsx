// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const parentToolsServiceMocks = vi.hoisted(() => ({
  addParentTeamMediaLink: vi.fn(),
  bulkDeleteTeamMediaItemsForApp: vi.fn(),
  createTeamMediaAlbumForApp: vi.fn(),
  loadTeamMediaForApp: vi.fn(),
  uploadParentTeamMediaFile: vi.fn(),
  uploadParentTeamMediaPhoto: vi.fn(),
  deleteTeamMediaItemForApp: vi.fn(),
  updateTeamMediaItemForApp: vi.fn(),
  moveTeamMediaItemForApp: vi.fn(),
  setTeamMediaAlbumCoverForApp: vi.fn(),
}));

const publicActionsMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn().mockResolvedValue('shared'),
}));

const chatServiceMocks = vi.hoisted(() => ({
  sendTeamChatMessage: vi.fn(),
}));

vi.mock('../../apps/app/src/lib/parentToolsService.ts', () => parentToolsServiceMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionsMocks);
vi.mock('../../apps/app/src/lib/chatService.ts', async () => {
  const actual = await vi.importActual('../../apps/app/src/lib/chatService.ts');
  return {
    ...actual,
    sendTeamChatMessage: chatServiceMocks.sendTeamChatMessage,
  };
});

import { TeamMedia } from '../../apps/app/src/pages/TeamMedia.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
  user: {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
  },
  profile: {},
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: async () => {},
  signOut: async () => {},
};

const mediaModel = (overrides = {}) => ({
  team: { id: 'team-1', name: 'Bears' },
  canManage: false,
  canContribute: false,
  canPostChat: false,
  folders: [{
    id: 'folder-1',
    name: 'Game media',
    visibility: 'team',
    itemCount: 2,
    items: [
      { id: 'owned-photo', title: 'Tipoff', type: 'photo', url: 'https://example.test/tipoff.jpg', uploadedBy: 'user-1' },
      { id: 'other-file', title: 'Scouting PDF', type: 'file', url: 'https://example.test/scout.pdf', uploadedBy: 'user-2' },
    ],
  }],
  ...overrides,
});

async function renderTeamMedia(model = mediaModel()) {
  if (Array.isArray(model)) {
    model.forEach((entry) => parentToolsServiceMocks.loadTeamMediaForApp.mockResolvedValueOnce(entry));
    parentToolsServiceMocks.loadTeamMediaForApp.mockResolvedValue(model[model.length - 1]);
  } else {
    parentToolsServiceMocks.loadTeamMediaForApp.mockResolvedValue(model);
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/teams/team-1/media"]}>
        <Routes>
          <Route path="/teams/:teamId/media" element={<TeamMedia auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );
  });
  await act(async () => {});

  return { container, root };
}

function click(button) {
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function inputValue(input, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function selectValue(select, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function changeFiles(input, files) {
  act(() => {
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: files,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  parentToolsServiceMocks.bulkDeleteTeamMediaItemsForApp.mockResolvedValue(undefined);
  parentToolsServiceMocks.updateTeamMediaItemForApp.mockResolvedValue(undefined);
  parentToolsServiceMocks.moveTeamMediaItemForApp.mockResolvedValue(undefined);
  parentToolsServiceMocks.setTeamMediaAlbumCoverForApp.mockResolvedValue(undefined);
  chatServiceMocks.sendTeamChatMessage.mockResolvedValue({ conversationId: 'team', createdConversation: null, wantsAi: false });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('React app TeamMedia bulk delete flow', () => {
  it('passes full media items to the bulk delete helper so storage objects can be removed', async () => {
    globalThis.confirm = vi.fn(() => true);
    const { container, root } = await renderTeamMedia(mediaModel({ canManage: true }));

    click(container.querySelector('[aria-label="Select Tipoff"]'));
    click(container.querySelector('[aria-label="Select Scouting PDF"]'));
    const deleteSelectedButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Delete selected'));
    await act(async () => {
      deleteSelectedButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parentToolsServiceMocks.bulkDeleteTeamMediaItemsForApp).toHaveBeenCalledWith('team-1', [
      expect.objectContaining({
        id: 'owned-photo',
        type: 'photo',
        url: 'https://example.test/tipoff.jpg',
      }),
      expect.objectContaining({
        id: 'other-file',
        type: 'file',
        url: 'https://example.test/scout.pdf',
      }),
    ]);

    await act(async () => root.unmount());
  });
});

describe('React app TeamMedia rename flow', () => {
  it('shows Rename only for managers or the original uploader', async () => {
    const { container, root } = await renderTeamMedia();

    expect(container.querySelector('[aria-label="Rename Tipoff"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Rename Scouting PDF"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('saves a trimmed rename and updates the rendered card title', async () => {
    const { container, root } = await renderTeamMedia();

    click(container.querySelector('[aria-label="Rename Tipoff"]'));
    inputValue(container.querySelector('[aria-label="Media item title"]'), '  Opening tip  ');
    await act(async () => {
      container.querySelector('button.primary-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parentToolsServiceMocks.updateTeamMediaItemForApp).toHaveBeenCalledWith('team-1', 'owned-photo', 'Opening tip');
    expect(container.textContent).toContain('Opening tip');
    expect(container.textContent).toContain('Media item renamed.');

    await act(async () => root.unmount());
  });

  it('rejects blank rename attempts and keeps the old title visible', async () => {
    const { container, root } = await renderTeamMedia();

    click(container.querySelector('[aria-label="Rename Tipoff"]'));
    inputValue(container.querySelector('[aria-label="Media item title"]'), '   ');
    await act(async () => {
      container.querySelector('button.primary-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parentToolsServiceMocks.updateTeamMediaItemForApp).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Tipoff');
    expect(container.textContent).toContain('Media item title cannot be empty.');

    await act(async () => root.unmount());
  });
});

describe('React app TeamMedia album cover flow', () => {
  it('prefers a persisted album cover over the first media item and only shows Set as cover for managers on photos', async () => {
    const coverModel = mediaModel({
      canManage: true,
      folders: [{
        id: 'folder-1',
        name: 'Game media',
        visibility: 'team',
        itemCount: 2,
        coverPhotoId: 'cover-1',
        coverPhotoUrl: 'https://example.test/cover.jpg',
        coverPhotoTitle: 'Chosen cover',
        items: [
          { id: 'owned-photo', title: 'Tipoff', type: 'photo', url: 'https://example.test/tipoff.jpg', uploadedBy: 'user-1' },
          { id: 'other-file', title: 'Scouting PDF', type: 'file', url: 'https://example.test/scout.pdf', uploadedBy: 'user-2' },
        ],
      }],
    });
    const { container, root } = await renderTeamMedia(coverModel);

    expect(container.querySelector('img[src="https://example.test/cover.jpg"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Set Tipoff as album cover"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Set Scouting PDF as album cover"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('saves a photo as the album cover, refreshes, and shows the updated thumbnail', async () => {
    const initialModel = mediaModel({ canManage: true });
    const refreshedModel = mediaModel({
      canManage: true,
      folders: [{
        ...initialModel.folders[0],
        coverPhotoId: 'owned-photo',
        coverPhotoUrl: 'https://example.test/tipoff.jpg',
        coverPhotoTitle: 'Tipoff',
      }],
    });
    const { container, root } = await renderTeamMedia([initialModel, refreshedModel]);

    await act(async () => {
      container.querySelector('[aria-label="Set Tipoff as album cover"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parentToolsServiceMocks.setTeamMediaAlbumCoverForApp).toHaveBeenCalledWith(
      'team-1',
      'folder-1',
      expect.objectContaining({ id: 'owned-photo', type: 'photo', url: 'https://example.test/tipoff.jpg' })
    );
    expect(container.textContent).toContain('Album cover saved.');
    expect(container.querySelector('img[src="https://example.test/tipoff.jpg"]')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it('keeps the current cover visible and shows the error when saving the album cover fails', async () => {
    parentToolsServiceMocks.setTeamMediaAlbumCoverForApp.mockRejectedValueOnce(new Error('Album cover must use a valid photo URL.'));
    const coverModel = mediaModel({
      canManage: true,
      folders: [{
        id: 'folder-1',
        name: 'Game media',
        visibility: 'team',
        itemCount: 2,
        coverPhotoId: 'cover-1',
        coverPhotoUrl: 'https://example.test/current-cover.jpg',
        coverPhotoTitle: 'Current cover',
        items: [
          { id: 'owned-photo', title: 'Tipoff', type: 'photo', url: 'https://example.test/tipoff.jpg', uploadedBy: 'user-1' },
          { id: 'other-file', title: 'Scouting PDF', type: 'file', url: 'https://example.test/scout.pdf', uploadedBy: 'user-2' },
        ],
      }],
    });
    const { container, root } = await renderTeamMedia(coverModel);

    await act(async () => {
      container.querySelector('[aria-label="Set Tipoff as album cover"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parentToolsServiceMocks.loadTeamMediaForApp).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Album cover must use a valid photo URL.');
    expect(container.querySelector('img[src="https://example.test/current-cover.jpg"]')).not.toBeNull();

    await act(async () => root.unmount());
  });
});


describe('React app TeamMedia upload flow', () => {
  const uploadableModel = () => mediaModel({
    canManage: true,
    canContribute: true,
  });

  it('uploads every selected photo and renders per-file status rows', async () => {
    const pendingResolvers = [];
    parentToolsServiceMocks.uploadParentTeamMediaPhoto.mockImplementation(() => new Promise((resolve) => {
      pendingResolvers.push(resolve);
    }));

    const { container, root } = await renderTeamMedia(uploadableModel());
    const photoInput = container.querySelector('input[accept="image/*"]');
    const files = [
      new File(['first'], 'tipoff.jpg', { type: 'image/jpeg' }),
      new File(['second'], 'bench.png', { type: 'image/png' }),
    ];

    changeFiles(photoInput, files);
    await act(async () => {});

    expect(parentToolsServiceMocks.uploadParentTeamMediaPhoto).toHaveBeenCalledTimes(2);
    expect(parentToolsServiceMocks.uploadParentTeamMediaPhoto).toHaveBeenNthCalledWith(1, 'team-1', 'folder-1', files[0]);
    expect(parentToolsServiceMocks.uploadParentTeamMediaPhoto).toHaveBeenNthCalledWith(2, 'team-1', 'folder-1', files[1]);
    expect(pendingResolvers).toHaveLength(2);

    await act(async () => {
      pendingResolvers.splice(0).forEach((resolve, index) => resolve({
        id: `uploaded-photo-${index + 1}`,
        title: files[index].name,
        type: 'photo',
        url: `https://example.test/${files[index].name}`,
        order: index + 10,
      }));
    });

    expect(container.textContent).toContain('Upload progress');
    expect(container.textContent).toContain('tipoff.jpg');
    expect(container.textContent).toContain('bench.png');
    expect((container.textContent.match(/Uploaded/g) || []).length).toBe(2);
    expect(container.textContent).toContain('2 photos uploaded.');
    expect(parentToolsServiceMocks.loadTeamMediaForApp).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it('uploads every selected file sequentially and keeps the file picker multi-select enabled', async () => {
    const pendingResolvers = [];
    parentToolsServiceMocks.uploadParentTeamMediaFile.mockImplementation(() => new Promise((resolve) => {
      pendingResolvers.push(resolve);
    }));

    const { container, root } = await renderTeamMedia(uploadableModel());
    const fileInput = container.querySelector('input[accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx"]');
    const files = [
      new File(['alpha'], 'report.pdf', { type: 'application/pdf' }),
      new File(['beta'], 'waiver.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    ];

    expect(fileInput.hasAttribute('multiple')).toBe(true);

    changeFiles(fileInput, files);
    await act(async () => {});

    expect(parentToolsServiceMocks.uploadParentTeamMediaFile).toHaveBeenCalledTimes(1);
    expect(parentToolsServiceMocks.uploadParentTeamMediaFile).toHaveBeenNthCalledWith(1, 'team-1', 'folder-1', files[0]);
    expect(container.textContent).toContain('report.pdf');
    expect(container.textContent).toContain('waiver.docx');
    expect(container.textContent).toContain('Uploading');

    await act(async () => {
      pendingResolvers[0](undefined);
    });
    await act(async () => {});

    expect(parentToolsServiceMocks.uploadParentTeamMediaFile).toHaveBeenCalledTimes(2);
    expect(parentToolsServiceMocks.uploadParentTeamMediaFile).toHaveBeenNthCalledWith(2, 'team-1', 'folder-1', files[1]);

    await act(async () => {
      pendingResolvers[1](undefined);
    });
    await act(async () => {});

    expect((container.textContent.match(/Uploaded/g) || []).length).toBe(2);

    await act(async () => root.unmount());
  });

  it('skips invalid files, uploads remaining valid documents, and reports partial failure', async () => {
    parentToolsServiceMocks.uploadParentTeamMediaFile.mockResolvedValue(undefined);

    const { container, root } = await renderTeamMedia(uploadableModel());
    const fileInput = container.querySelector('input[accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx"]');
    const invalidFile = new File(['image'], 'photo.png', { type: 'image/png' });
    const validFile = new File(['alpha'], 'report.pdf', { type: 'application/pdf' });

    changeFiles(fileInput, [invalidFile, validFile]);
    await act(async () => {});

    expect(parentToolsServiceMocks.uploadParentTeamMediaFile).toHaveBeenCalledTimes(1);
    expect(parentToolsServiceMocks.uploadParentTeamMediaFile).toHaveBeenCalledWith('team-1', 'folder-1', validFile);
    expect(container.textContent).toContain('Unsupported file or file exceeds 10 MB.');
    expect(container.textContent).toContain('1 file uploaded; 1 failed.');

    await act(async () => root.unmount());
  });

  it('clears the file picker after failed uploads so the same selection can be retried', async () => {
    parentToolsServiceMocks.uploadParentTeamMediaFile.mockRejectedValue(new Error('storage/retry'));

    const { container, root } = await renderTeamMedia(uploadableModel());
    const fileInput = container.querySelector('input[accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx"]');
    const file = new File(['alpha'], 'report.pdf', { type: 'application/pdf' });

    Object.defineProperty(fileInput, 'value', {
      configurable: true,
      writable: true,
      value: 'C\\fakepath\\report.pdf',
    });
    changeFiles(fileInput, [file]);
    await act(async () => {});

    expect(parentToolsServiceMocks.uploadParentTeamMediaFile).toHaveBeenCalledWith('team-1', 'folder-1', file);
    expect(fileInput.value).toBe('');
    expect(container.textContent).toContain('No files uploaded. Choose supported documents that are 10 MB or smaller.');

    await act(async () => root.unmount());
  });
});

describe('React app TeamMedia team chat posting', () => {
  const postableModel = (overrides = {}) => mediaModel({
    canManage: true,
    canContribute: true,
    canPostChat: true,
    ...overrides,
  });

  it('hides photo chat posting when the viewer can upload media but cannot access team chat', async () => {
    const { container, root } = await renderTeamMedia(postableModel({ canPostChat: false }));

    expect(container.querySelector('[aria-label="Post Tipoff to team chat"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('shows the post action only for photo media when contributors can post to team chat', async () => {
    const managerModel = postableModel({
      folders: [{
        id: 'folder-1',
        name: 'Game media',
        visibility: 'team',
        itemCount: 3,
        items: [
          { id: 'owned-photo', title: 'Tipoff', type: 'photo', url: 'https://example.test/tipoff.jpg', uploadedBy: 'user-1' },
          { id: 'uploaded-image', title: 'Warmups', type: 'image', url: 'https://example.test/warmups.jpg', uploadedBy: 'user-2' },
          { id: 'other-file', title: 'Scouting PDF', type: 'file', url: 'https://example.test/scout.pdf', uploadedBy: 'user-2' },
        ],
      }],
    });
    const { container, root } = await renderTeamMedia(managerModel);

    expect(container.querySelector('[aria-label="Post Tipoff to team chat"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Post Warmups to team chat"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Post Scouting PDF to team chat"]')).toBeNull();

    await act(async () => root.unmount());

    const rendered = await renderTeamMedia(postableModel({ canContribute: false }));
    expect(rendered.container.querySelector('[aria-label="Post Tipoff to team chat"]')).toBeNull();

    await act(async () => rendered.root.unmount());
  });

  it('sends the selected photo URL to the default team conversation with an optional caption', async () => {
    const { container, root } = await renderTeamMedia(postableModel());

    click(container.querySelector('[aria-label="Post Tipoff to team chat"]'));
    inputValue(container.querySelector('[aria-label="Caption for team chat"]'), '  Great start  ');
    await act(async () => {
      const buttons = [...container.querySelectorAll('button')];
      buttons.find((button) => button.textContent.includes('Send to chat')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const sendCall = chatServiceMocks.sendTeamChatMessage.mock.calls[0][0];
    expect(sendCall.teamId).toBe('team-1');
    expect(sendCall.text).toBe('Great start');
    expect(sendCall.selectedConversationId).toBe('team');
    expect(sendCall.selectedRecipientTarget).toBe('full_team');
    expect(sendCall.selectedRecipientIds).toEqual([]);
    expect(sendCall.attachments).toEqual([expect.objectContaining({
      type: 'image',
      url: 'https://example.test/tipoff.jpg',
      name: 'Tipoff',
    })]);
    expect(container.textContent).toContain('Photo posted to team chat.');
    expect(container.querySelector('[aria-label="Caption for team chat"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('disables photo chat posting while the send is in flight and prevents duplicate submits', async () => {
    let resolveSend;
    chatServiceMocks.sendTeamChatMessage.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));

    const { container, root } = await renderTeamMedia(postableModel());

    click(container.querySelector('[aria-label="Post Tipoff to team chat"]'));
    const sendButton = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Send to chat'));

    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(chatServiceMocks.sendTeamChatMessage).toHaveBeenCalledTimes(1);
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.textContent).toContain('Posting');
    expect(container.textContent).toContain('Posting');

    await act(async () => {
      resolveSend({ conversationId: 'team', createdConversation: null, wantsAi: false });
    });
    await act(async () => {});

    expect(container.textContent).toContain('Photo posted to team chat.');
    expect(container.querySelector('[aria-label="Caption for team chat"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('shows a retryable error when chat posting fails without mutating the media item', async () => {
    chatServiceMocks.sendTeamChatMessage.mockRejectedValue(new Error('Chat offline'));

    const { container, root } = await renderTeamMedia(postableModel());

    click(container.querySelector('[aria-label="Post Tipoff to team chat"]'));
    await act(async () => {
      const buttons = [...container.querySelectorAll('button')];
      buttons.find((button) => button.textContent.includes('Send to chat')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Chat offline');
    expect(container.querySelector('[aria-label="Caption for team chat"]')).not.toBeNull();
    expect(container.textContent).toContain('Tipoff');
    expect(parentToolsServiceMocks.updateTeamMediaItemForApp).not.toHaveBeenCalled();
    expect(parentToolsServiceMocks.moveTeamMediaItemForApp).not.toHaveBeenCalled();
    expect(parentToolsServiceMocks.deleteTeamMediaItemForApp).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});

describe('React app TeamMedia move flow', () => {
  const twoAlbumModel = () => mediaModel({
    canManage: true,
    canContribute: true,
    folders: [
      {
        id: 'folder-1',
        name: 'Album A',
        visibility: 'team',
        itemCount: 1,
        itemsLoaded: true,
        items: [{ id: 'owned-photo', title: 'Tipoff', type: 'photo', url: 'https://example.test/tipoff.jpg', uploadedBy: 'user-1' }],
      },
      {
        id: 'folder-2',
        name: 'Album B',
        visibility: 'team',
        itemCount: 0,
        itemsLoaded: true,
        items: [],
      },
    ],
  });

  it('shows Move only to managers when another album exists', async () => {
    const { container, root } = await renderTeamMedia(twoAlbumModel());

    expect(container.querySelector('[aria-label="Move Tipoff to album"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Move Tipoff"]')).not.toBeNull();

    await act(async () => root.unmount());

    const nonManager = twoAlbumModel();
    nonManager.canManage = false;
    const rendered = await renderTeamMedia(nonManager);
    expect(rendered.container.querySelector('[aria-label="Move Tipoff to album"]')).toBeNull();

    await act(async () => rendered.root.unmount());
  });

  it('does not show Move when there is no alternate album', async () => {
    const model = twoAlbumModel();
    model.folders = model.folders.slice(0, 1);
    const { container, root } = await renderTeamMedia(model);

    expect(container.querySelector('[aria-label="Move Tipoff to album"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('disables submit until a different album is selected and refreshes to the destination after move', async () => {
    const initialModel = twoAlbumModel();
    const movedModel = twoAlbumModel();
    movedModel.folders = [
      { ...initialModel.folders[0], itemCount: 0, itemsLoaded: true, items: [] },
      { ...initialModel.folders[1], itemCount: 1, itemsLoaded: true, items: initialModel.folders[0].items },
    ];
    parentToolsServiceMocks.loadTeamMediaForApp
      .mockResolvedValueOnce(initialModel)
      .mockResolvedValueOnce(movedModel);

    const { container, root } = await renderTeamMedia(initialModel);

    const moveButton = container.querySelector('[aria-label="Move Tipoff"]');
    expect(moveButton.disabled).toBe(true);

    selectValue(container.querySelector('[aria-label="Move Tipoff to album"]'), 'folder-2');
    expect(moveButton.disabled).toBe(false);

    await act(async () => {
      moveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parentToolsServiceMocks.moveTeamMediaItemForApp).toHaveBeenCalledWith('team-1', 'owned-photo', 'folder-2');
    expect(parentToolsServiceMocks.loadTeamMediaForApp).toHaveBeenLastCalledWith(auth.user, 'team-1', {
      initialFolderId: 'folder-2',
      folderIds: ['folder-1', 'folder-2'],
    });
    expect(container.textContent).toContain('Media item moved to Album B.');
    expect(container.textContent).toContain('Album B');
    expect(container.textContent).toContain('Tipoff');

    await act(async () => root.unmount());
  });

  it('lazy-loads unopened albums once and reuses the cached album on later switches', async () => {
    const initialModel = mediaModel({
      canManage: true,
      folders: [
        {
          id: 'folder-1',
          name: 'Album A',
          visibility: 'team',
          itemCount: 1,
          itemsLoaded: true,
          items: [{ id: 'owned-photo', title: 'Tipoff', type: 'photo', url: 'https://example.test/tipoff.jpg', uploadedBy: 'user-1' }],
        },
        {
          id: 'folder-2',
          name: 'Album B',
          visibility: 'team',
          itemCount: 1,
          itemsLoaded: false,
          items: [],
        },
      ],
    });
    const hydratedModel = mediaModel({
      canManage: true,
      folders: [
        initialModel.folders[0],
        {
          id: 'folder-2',
          name: 'Album B',
          visibility: 'team',
          itemCount: 1,
          itemsLoaded: true,
          items: [{ id: 'video-1', title: 'Replay', type: 'video_link', url: 'https://example.test/replay', uploadedBy: 'user-1' }],
        },
      ],
    });
    parentToolsServiceMocks.loadTeamMediaForApp
      .mockResolvedValueOnce(initialModel)
      .mockResolvedValueOnce(hydratedModel);

    const { container, root } = await renderTeamMedia(initialModel);

    expect(parentToolsServiceMocks.loadTeamMediaForApp).toHaveBeenNthCalledWith(1, auth.user, 'team-1', {
      initialFolderId: '',
      folderIds: [],
    });

    click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Album B')));
    await act(async () => {});

    expect(parentToolsServiceMocks.loadTeamMediaForApp).toHaveBeenNthCalledWith(2, auth.user, 'team-1', {
      initialFolderId: 'folder-2',
      folderIds: ['folder-2'],
    });
    expect(container.textContent).toContain('Replay');

    click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Album A')));
    click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Album B')));
    await act(async () => {});

    expect(parentToolsServiceMocks.loadTeamMediaForApp).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
  });

  it('refreshes only the active album after a delete', async () => {
    globalThis.confirm = vi.fn(() => true);
    const initialModel = mediaModel({
      canManage: true,
      folders: [
        {
          id: 'folder-1',
          name: 'Album A',
          visibility: 'team',
          itemCount: 1,
          itemsLoaded: true,
          items: [{ id: 'owned-photo', title: 'Tipoff', type: 'photo', url: 'https://example.test/tipoff.jpg', uploadedBy: 'user-1' }],
        },
        {
          id: 'folder-2',
          name: 'Album B',
          visibility: 'team',
          itemCount: 3,
          itemsLoaded: false,
          items: [],
        },
      ],
    });
    const refreshedModel = mediaModel({
      canManage: true,
      folders: [
        {
          id: 'folder-1',
          name: 'Album A',
          visibility: 'team',
          itemCount: 0,
          itemsLoaded: true,
          items: [],
        },
        {
          id: 'folder-2',
          name: 'Album B',
          visibility: 'team',
          itemCount: 3,
          itemsLoaded: false,
          items: [],
        },
      ],
    });
    parentToolsServiceMocks.loadTeamMediaForApp
      .mockResolvedValueOnce(initialModel)
      .mockResolvedValueOnce(refreshedModel);

    const { container, root } = await renderTeamMedia(initialModel);

    await act(async () => {
      container.querySelector('[aria-label="Delete Tipoff"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parentToolsServiceMocks.deleteTeamMediaItemForApp).toHaveBeenCalledWith('team-1', expect.objectContaining({ id: 'owned-photo' }));
    expect(parentToolsServiceMocks.loadTeamMediaForApp).toHaveBeenLastCalledWith(auth.user, 'team-1', {
      initialFolderId: 'folder-1',
      folderIds: ['folder-1'],
    });
    expect(container.textContent).toContain('Media item deleted.');
    expect(container.textContent).toContain('No media in this album.');

    await act(async () => root.unmount());
  });
});
