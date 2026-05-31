// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const parentToolsServiceMocks = vi.hoisted(() => ({
  addParentTeamMediaLink: vi.fn(),
  createTeamMediaAlbumForApp: vi.fn(),
  loadTeamMediaForApp: vi.fn(),
  uploadParentTeamMediaFile: vi.fn(),
  uploadParentTeamMediaPhoto: vi.fn(),
  deleteTeamMediaItemForApp: vi.fn(),
  updateTeamMediaItemForApp: vi.fn(),
  moveTeamMediaItemForApp: vi.fn(),
}));

const publicActionsMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn().mockResolvedValue('shared'),
}));

vi.mock('../../apps/app/src/lib/parentToolsService.ts', () => parentToolsServiceMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionsMocks);

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
  parentToolsServiceMocks.loadTeamMediaForApp.mockResolvedValue(model);
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
  parentToolsServiceMocks.updateTeamMediaItemForApp.mockResolvedValue(undefined);
  parentToolsServiceMocks.moveTeamMediaItemForApp.mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
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


describe('React app TeamMedia upload flow', () => {
  const uploadableModel = () => mediaModel({
    canManage: true,
    canContribute: true,
  });

  it('uploads every selected photo and renders per-file status rows', async () => {
    parentToolsServiceMocks.uploadParentTeamMediaPhoto.mockResolvedValue(undefined);

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
    expect(container.textContent).toContain('Upload progress');
    expect(container.textContent).toContain('tipoff.jpg');
    expect(container.textContent).toContain('bench.png');
    expect(container.textContent).toContain('2 photos uploaded.');

    await act(async () => root.unmount());
  });

  it('uploads every selected file concurrently and keeps the file picker multi-select enabled', async () => {
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

    expect(parentToolsServiceMocks.uploadParentTeamMediaFile).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('report.pdf');
    expect(container.textContent).toContain('waiver.docx');
    expect(container.textContent).toContain('Uploading');

    await act(async () => {
      pendingResolvers.forEach((resolve) => resolve(undefined));
    });
    await act(async () => {});

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
        items: [{ id: 'owned-photo', title: 'Tipoff', type: 'photo', url: 'https://example.test/tipoff.jpg', uploadedBy: 'user-1' }],
      },
      {
        id: 'folder-2',
        name: 'Album B',
        visibility: 'team',
        itemCount: 0,
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
      { ...initialModel.folders[0], itemCount: 0, items: [] },
      { ...initialModel.folders[1], itemCount: 1, items: initialModel.folders[0].items },
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
    expect(container.textContent).toContain('Media item moved to Album B.');
    expect(container.textContent).toContain('Album B');
    expect(container.textContent).toContain('Tipoff');

    await act(async () => root.unmount());
  });
});
