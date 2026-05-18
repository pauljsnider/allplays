import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

// Mock Firebase functions
const mockUpdateTeamMediaItem = vi.fn();
const mockGetTeamMediaItems = vi.fn();
const mockGetTeamMediaFolders = vi.fn();
const mockGetTeam = vi.fn();
const mockCheckAuth = vi.fn();

vi.mock('../js/db.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        updateTeamMediaItem: mockUpdateTeamMediaItem,
        getTeamMediaItems: mockGetTeamMediaItems,
        getTeamMediaFolders: mockGetTeamMediaFolders,
        getTeam: mockGetTeam,
    };
});

vi.mock('../js/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        checkAuth: mockCheckAuth,
    };
});

// Mock the window.prompt and window.confirm functions as they are used in the original JS
global.window = {
    prompt: vi.fn(),
    confirm: vi.fn(),
    location: {
        search: '',
        hash: '#teamId=team123'
    },
};
global.document = new JSDOM('<!DOCTYPE html><body><div id="header-container"></div><main id="app"></main></body>').window.document;

// Helper to load and evaluate the script under test
async function loadModule() {
    // Load the actual team-media.html content for robust DOM setup
    const teamMediaHtmlPath = path.resolve(repoRoot, 'team-media.html');
    const teamMediaHtml = fs.readFileSync(teamMediaHtmlPath, 'utf8');

    document.body.innerHTML = teamMediaHtml;

    const module = await import(path.resolve(repoRoot, 'js/team-media.js'));
    return module;
}

describe('team media item renaming', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Load the actual team-media.html content for robust DOM setup
        const teamMediaHtmlPath = path.resolve(repoRoot, 'team-media.html');
        const teamMediaHtml = fs.readFileSync(teamMediaHtmlPath, 'utf8');
        document.body.innerHTML = teamMediaHtml;

        mockGetTeam.mockResolvedValue({ id: 'team123', name: 'Test Team', adminEmails: ['admin@example.com'] });
        mockGetTeamMediaFolders.mockResolvedValue([{ id: 'folderA', name: 'Album A', visibility: 'team' }]);
        mockGetTeamMediaItems.mockResolvedValue([
            { id: 'item1', folderId: 'folderA', title: 'Original Photo', type: 'photo', url: 'photo1.jpg', uploadedBy: 'user123' },
        ]);
        mockCheckAuth.mockImplementation((callback) => callback({ uid: 'user123', email: 'user@example.com' }));
        mockUpdateTeamMediaItem.mockResolvedValue(true); // Ensure successful update
        window.alert = vi.fn(); // Mock alert to prevent test interruption
    });

    it('allows an admin to rename a media item', async () => {
        mockCheckAuth.mockImplementationOnce((callback) => callback({ uid: 'admin456', email: 'admin@example.com' }));

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
        await vi.waitUntil(() => mockUpdateTeamMediaItem.mock.calls.length > 0);
        expect(mockUpdateTeamMediaItem).toHaveBeenCalledWith('team123', 'item1', { title: 'Renamed Photo by Admin' });

        // Expect display mode to be restored with new title
        expect(displayEl.textContent).toBe('Renamed Photo by Admin');
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

        await vi.waitUntil(() => mockUpdateTeamMediaItem.mock.calls.length > 0);
        expect(mockUpdateTeamMediaItem).toHaveBeenCalledWith('team123', 'item1', { title: 'Renamed Photo by Uploader' });

        expect(displayEl.textContent).toBe('Renamed Photo by Uploader');
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
        expect(mockUpdateTeamMediaItem).not.toHaveBeenCalled();
        expect(displayEl.classList.contains('hidden')).toBe(false);
        expect(editContainerEl.classList.contains('hidden')).toBe(true);

        // Test empty title
        renameButton.click(); // Re-enter edit mode
        displayEl.classList.add('hidden'); // Manually hide as blur resets it
        editContainerEl.classList.remove('hidden');
        inputEl.value = '';
        inputEl.dispatchEvent(new Event('blur'));
        expect(mockUpdateTeamMediaItem).not.toHaveBeenCalled(); // Still not called
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

        expect(mockUpdateTeamMediaItem).not.toHaveBeenCalled();
        expect(inputEl.value).toBe('Original Photo'); // Value should revert
        expect(displayEl.classList.contains('hidden')).toBe(false);
        expect(editContainerEl.classList.contains('hidden')).toBe(true);
    });

    it('shows an error if updateTeamMediaItem fails', async () => {
        mockUpdateTeamMediaItem.mockRejectedValueOnce(new Error('Firestore error'));
        const module = await loadModule();
        await module.loadLibrary();

        const albumDetail = document.getElementById('album-detail');
        const renameButton = albumDetail.querySelector('[data-item-rename="item1"]');
        renameButton.click();

        const inputEl = albumDetail.querySelector('[data-item-title-input="item1"]');
        inputEl.value = 'Failing Rename';
        inputEl.dispatchEvent(new Event('blur'));

        await vi.waitUntil(() => mockUpdateTeamMediaItem.mock.calls.length > 0);
        expect(mockUpdateTeamMediaItem).toHaveBeenCalledOnce();

        const alertEl = document.getElementById('team-media-alert');
        expect(alertEl.classList.contains('hidden')).toBe(false);
        expect(alertEl.textContent).toContain('Firestore error');
    });
});
