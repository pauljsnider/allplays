/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const mocks = vi.hoisted(() => ({
    updateTeamMediaItem: vi.fn(),
    getTeamMediaItemsPage: vi.fn(),
    getTeamMediaFolders: vi.fn(),
    getTeam: vi.fn(),
    checkAuth: vi.fn()
}));

vi.mock('../../js/db.js?v=91', () => {
    return {
        getTeam: mocks.getTeam,
        getTeamMediaFolders: mocks.getTeamMediaFolders,
        getTeamMediaItemsPage: mocks.getTeamMediaItemsPage,
        createTeamMediaFolder: vi.fn(),
        updateTeamMediaFolder: vi.fn(),
        deleteTeamMediaFolder: vi.fn(),
        createTeamMediaLink: vi.fn(),
        uploadTeamMediaFile: vi.fn(),
        uploadTeamMediaPhoto: vi.fn(),
        deleteTeamMediaItem: vi.fn(),
        reorderTeamMediaFolders: vi.fn(),
        reorderTeamMediaItems: vi.fn(),
        moveTeamMediaItems: vi.fn(),
        bulkDeleteTeamMediaItems: vi.fn(),
        setTeamMediaAlbumCover: vi.fn(),
        updateTeamMediaItem: mocks.updateTeamMediaItem
    };
});

vi.mock('../../js/auth.js?v=46', () => {
    return {
        checkAuth: mocks.checkAuth
    };
});

function loadTeamMediaHtml() {
    const teamMediaHtmlPath = path.resolve(repoRoot, 'team-media.html');
    const teamMediaHtml = fs.readFileSync(teamMediaHtmlPath, 'utf8');
    const body = teamMediaHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || teamMediaHtml;
    document.body.innerHTML = body;
}

async function loadModule() {
    const module = await import(path.resolve(repoRoot, 'js/team-media.js'));
    return module;
}

describe('team media item renaming', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        window.history.replaceState({}, '', '/team-media.html#teamId=team123');
        window.alert = vi.fn();
        window.prompt = vi.fn();
        window.confirm = vi.fn();
        loadTeamMediaHtml();

        mocks.getTeam.mockResolvedValue({ id: 'team123', name: 'Test Team', adminEmails: ['admin@example.com'] });
        mocks.getTeamMediaFolders.mockResolvedValue([{ id: 'folderA', name: 'Album A', visibility: 'team' }]);
        mocks.getTeamMediaItemsPage.mockResolvedValue({
            items: [
                { id: 'item1', folderId: 'folderA', title: 'Original Photo', type: 'photo', downloadUrl: 'https://example.com/photo1.jpg', uploadedBy: 'user123' },
            ],
            hasMore: false,
            nextCursor: null
        });
        mocks.checkAuth.mockImplementation((callback) => callback({ uid: 'user123', email: 'user@example.com' }));
        mocks.updateTeamMediaItem.mockResolvedValue(true);
    });

    it('allows an admin to rename a media item', async () => {
        mocks.checkAuth.mockImplementationOnce((callback) => callback({ uid: 'admin456', email: 'admin@example.com' }));

        const module = await loadModule();
        // Force re-render after auth mock
        await module.loadLibrary();

        const albumDetail = document.getElementById('album-detail');
        expect(albumDetail.innerHTML).toContain('Original Photo');

        const renameButton = albumDetail.querySelector('[data-item-rename="item1"]');
        expect(renameButton).not.toBeNull();

        // Click the rename button
        renameButton.click();

        const displayEl = albumDetail.querySelector('[data-item-title-display="item1"]');
        const editContainerEl = albumDetail.querySelector('[data-item-title-edit="item1"]');
        const inputEl = albumDetail.querySelector('[data-item-title-input="item1"]');

        expect(displayEl.classList.contains('hidden')).toBe(true);
        expect(editContainerEl.classList.contains('hidden')).toBe(false);
        expect(inputEl.value).toBe('Original Photo');

        // Type a new title and blur
        inputEl.value = 'Renamed Photo by Admin';
        inputEl.dispatchEvent(new Event('blur'));

        // Expect updateTeamMediaItem to be called
        await vi.waitUntil(() => mocks.updateTeamMediaItem.mock.calls.length > 0);
        expect(mocks.updateTeamMediaItem).toHaveBeenCalledWith('team123', 'item1', { title: 'Renamed Photo by Admin' });

        // Expect display mode to be restored with new title
        await vi.waitUntil(() => displayEl.textContent === 'Renamed Photo by Admin');
        expect(displayEl.classList.contains('hidden')).toBe(false);
        expect(editContainerEl.classList.contains('hidden')).toBe(true);
    });

    it('allows the uploader to rename a media item', async () => {
        const module = await loadModule();
        await module.loadLibrary();

        const albumDetail = document.getElementById('album-detail');
        expect(albumDetail.innerHTML).toContain('Original Photo');

        const renameButton = albumDetail.querySelector('[data-item-rename="item1"]');
        expect(renameButton).not.toBeNull();

        renameButton.click();

        const displayEl = albumDetail.querySelector('[data-item-title-display="item1"]');
        const editContainerEl = albumDetail.querySelector('[data-item-title-edit="item1"]');
        const inputEl = albumDetail.querySelector('[data-item-title-input="item1"]');

        expect(displayEl.classList.contains('hidden')).toBe(true);
        expect(editContainerEl.classList.contains('hidden')).toBe(false);
        expect(inputEl.value).toBe('Original Photo');

        inputEl.value = 'Renamed Photo by Uploader';
        inputEl.dispatchEvent(new Event('blur'));

        await vi.waitUntil(() => mocks.updateTeamMediaItem.mock.calls.length > 0);
        expect(mocks.updateTeamMediaItem).toHaveBeenCalledWith('team123', 'item1', { title: 'Renamed Photo by Uploader' });

        await vi.waitUntil(() => displayEl.textContent === 'Renamed Photo by Uploader');
        expect(displayEl.classList.contains('hidden')).toBe(false);
        expect(editContainerEl.classList.contains('hidden')).toBe(true);
    });

    it('does not rename if title is empty or unchanged', async () => {
        const module = await loadModule();
        await module.loadLibrary();

        const albumDetail = document.getElementById('album-detail');
        const renameButton = albumDetail.querySelector('[data-item-rename="item1"]');
        renameButton.click();

        const displayEl = albumDetail.querySelector('[data-item-title-display="item1"]');
        const editContainerEl = albumDetail.querySelector('[data-item-title-edit="item1"]');
        const inputEl = albumDetail.querySelector('[data-item-title-input="item1"]');

        // Test unchanged title
        inputEl.value = 'Original Photo';
        inputEl.dispatchEvent(new Event('blur'));
        expect(mocks.updateTeamMediaItem).not.toHaveBeenCalled();
        expect(displayEl.classList.contains('hidden')).toBe(false);
        expect(editContainerEl.classList.contains('hidden')).toBe(true);

        // Test empty title
        renameButton.click(); // Re-enter edit mode
        displayEl.classList.add('hidden'); // Manually hide as blur resets it
        editContainerEl.classList.remove('hidden');
        inputEl.value = '';
        inputEl.dispatchEvent(new Event('blur'));
        expect(mocks.updateTeamMediaItem).not.toHaveBeenCalled(); // Still not called
        expect(displayEl.classList.contains('hidden')).toBe(false); // Should revert
        expect(editContainerEl.classList.contains('hidden')).toBe(true);
    });

    it('cancels rename on Escape key press', async () => {
        const module = await loadModule();
        await module.loadLibrary();

        const albumDetail = document.getElementById('album-detail');
        const renameButton = albumDetail.querySelector('[data-item-rename="item1"]');
        renameButton.click();

        const displayEl = albumDetail.querySelector('[data-item-title-display="item1"]');
        const editContainerEl = albumDetail.querySelector('[data-item-title-edit="item1"]');
        const inputEl = albumDetail.querySelector('[data-item-title-input="item1"]');

        inputEl.value = 'New Title';
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(mocks.updateTeamMediaItem).not.toHaveBeenCalled();
        expect(inputEl.value).toBe('Original Photo'); // Value should revert
        expect(displayEl.classList.contains('hidden')).toBe(false);
        expect(editContainerEl.classList.contains('hidden')).toBe(true);
    });

    it('shows an error if updateTeamMediaItem fails', async () => {
        mocks.updateTeamMediaItem.mockRejectedValueOnce(new Error('Firestore error'));
        const module = await loadModule();
        await module.loadLibrary();

        const albumDetail = document.getElementById('album-detail');
        const renameButton = albumDetail.querySelector('[data-item-rename="item1"]');
        renameButton.click();

        const inputEl = albumDetail.querySelector('[data-item-title-input="item1"]');
        const displayEl = albumDetail.querySelector('[data-item-title-display="item1"]');
        const editContainerEl = albumDetail.querySelector('[data-item-title-edit="item1"]');
        inputEl.value = 'Failing Rename';
        inputEl.dispatchEvent(new Event('blur'));

        await vi.waitUntil(() => mocks.updateTeamMediaItem.mock.calls.length > 0);
        expect(mocks.updateTeamMediaItem).toHaveBeenCalledOnce();

        const alertEl = document.getElementById('team-media-alert');
        await vi.waitUntil(() => !alertEl.classList.contains('hidden'));
        expect(alertEl.classList.contains('hidden')).toBe(false);
        expect(alertEl.textContent).toContain('Firestore error');
        expect(displayEl.textContent).toBe('Original Photo');
        expect(displayEl.classList.contains('hidden')).toBe(false);
        expect(editContainerEl.classList.contains('hidden')).toBe(true);
    });

    it('shows saved video-link items under the Videos filter', async () => {
        mocks.getTeamMediaItemsPage.mockResolvedValue({
            items: [
                { id: 'video1', folderId: 'folderA', title: 'Game Clip', type: 'video-link', url: 'https://youtu.be/abc123', uploadedBy: 'user123' }
            ],
            hasMore: false,
            nextCursor: null
        });

        const module = await loadModule();
        await module.loadLibrary();

        const albumDetail = document.getElementById('album-detail');
        const videosFilter = albumDetail.querySelector('[data-media-type-filter="videos"]');
        expect(videosFilter?.textContent).toContain('Videos 1');

        videosFilter.click();

        expect(albumDetail.innerHTML).toContain('Game Clip');
        expect(albumDetail.textContent).not.toContain('No videos in this album.');
    });

    it('ignores duplicate save attempts while a rename is in flight', async () => {
        let resolveRename;
        mocks.updateTeamMediaItem.mockImplementationOnce(() => new Promise((resolve) => {
            resolveRename = resolve;
        }));

        const module = await loadModule();
        await module.loadLibrary();

        const albumDetail = document.getElementById('album-detail');
        const renameButton = albumDetail.querySelector('[data-item-rename="item1"]');
        renameButton.click();

        const inputEl = albumDetail.querySelector('[data-item-title-input="item1"]');
        inputEl.value = 'One Rename Only';
        inputEl.dispatchEvent(new Event('blur'));
        inputEl.dispatchEvent(new Event('blur'));

        await vi.waitUntil(() => mocks.updateTeamMediaItem.mock.calls.length > 0);
        expect(mocks.updateTeamMediaItem).toHaveBeenCalledOnce();
        resolveRename(true);
    });

    it('appends later album pages with the stored cursor', async () => {
        const nextCursor = { kind: 'team-media-items-page', folderId: 'folderA', phase: 'ordered', lastDoc: { id: 'item1' } };
        mocks.getTeamMediaItemsPage
            .mockResolvedValueOnce({
                items: [
                    { id: 'item1', folderId: 'folderA', title: 'Original Photo', type: 'photo', downloadUrl: 'https://example.com/photo1.jpg', uploadedBy: 'user123' }
                ],
                hasMore: true,
                nextCursor
            })
            .mockResolvedValueOnce({
                items: [
                    { id: 'item2', folderId: 'folderA', title: 'Second Photo', type: 'photo', downloadUrl: 'https://example.com/photo2.jpg', uploadedBy: 'user123' }
                ],
                hasMore: false,
                nextCursor: null
            });

        await loadModule();

        const albumDetail = document.getElementById('album-detail');
        await vi.waitUntil(() => albumDetail.textContent.includes('Original Photo'));

        const loadMoreButton = albumDetail.querySelector('[data-load-more-media]');
        expect(loadMoreButton).not.toBeNull();
        loadMoreButton.click();

        await vi.waitUntil(() => mocks.getTeamMediaItemsPage.mock.calls.length === 2);
        expect(mocks.getTeamMediaItemsPage).toHaveBeenNthCalledWith(2, 'team123', 'folderA', {
            pageSize: 24,
            cursor: nextCursor
        });
        await vi.waitUntil(() => albumDetail.textContent.includes('Second Photo'));
        expect(albumDetail.textContent).toContain('Original Photo');
        expect(albumDetail.querySelector('[data-load-more-media]')).toBeNull();
    });
});
