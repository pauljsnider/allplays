/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const mocks = vi.hoisted(() => ({
    getTeam: vi.fn(),
    getTeamMediaFolders: vi.fn(),
    getTeamMediaItemsPage: vi.fn(),
    uploadTeamMediaPhoto: vi.fn(),
    uploadTeamMediaFile: vi.fn(),
    checkAuth: vi.fn()
}));

vi.mock('../../js/db.js?v=91', () => ({
    getTeam: mocks.getTeam,
    getTeamMediaFolders: mocks.getTeamMediaFolders,
    getTeamMediaItemsPage: mocks.getTeamMediaItemsPage,
    createTeamMediaFolder: vi.fn(),
    updateTeamMediaFolder: vi.fn(),
    deleteTeamMediaFolder: vi.fn(),
    createTeamMediaLink: vi.fn(),
    uploadTeamMediaFile: mocks.uploadTeamMediaFile,
    uploadTeamMediaPhoto: mocks.uploadTeamMediaPhoto,
    deleteTeamMediaItem: vi.fn(),
    reorderTeamMediaFolders: vi.fn(),
    reorderTeamMediaItems: vi.fn(),
    moveTeamMediaItems: vi.fn(),
    bulkDeleteTeamMediaItems: vi.fn(),
    setTeamMediaAlbumCover: vi.fn(),
    updateTeamMediaItem: vi.fn()
}));

vi.mock('../../js/auth.js?v=47', () => ({
    checkAuth: mocks.checkAuth
}));

function loadTeamMediaHtml() {
    const teamMediaHtml = fs.readFileSync(path.resolve(repoRoot, 'team-media.html'), 'utf8');
    const body = teamMediaHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || teamMediaHtml;
    document.body.innerHTML = body;
}

async function loadTeamMediaModule() {
    await import(path.resolve(repoRoot, 'js/team-media.js'));
    await vi.waitUntil(() => document.getElementById('photo-folder').options.length === 3);
}

function setSelectedFiles(input, files) {
    Object.defineProperty(input, 'files', {
        value: files,
        configurable: true
    });
}

function submitForm(form) {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('legacy team media upload forms', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        window.history.replaceState({}, '', '/team-media.html#teamId=team123');
        window.alert = vi.fn();
        window.prompt = vi.fn();
        window.confirm = vi.fn();
        loadTeamMediaHtml();

        mocks.checkAuth.mockImplementation((callback) => callback({
            uid: 'uploader123',
            email: 'media@example.com',
            teamMediaUploadTeamIds: ['team123']
        }));
        mocks.getTeam.mockResolvedValue({
            id: 'team123',
            name: 'Test Team',
            ownerId: 'owner123',
            adminEmails: []
        });
        mocks.getTeamMediaFolders.mockResolvedValue([
            { id: 'folderA', name: 'Album A', visibility: 'team' },
            { id: 'folderB', name: 'Album B', visibility: 'team' }
        ]);
        mocks.getTeamMediaItemsPage.mockResolvedValue({
            items: [],
            hasMore: false,
            nextCursor: null
        });
        mocks.uploadTeamMediaPhoto.mockImplementation(async (_teamId, _folderId, _file, options = {}) => {
            options.onProgress?.({ percent: 45 });
            return { id: 'photo-upload' };
        });
        mocks.uploadTeamMediaFile.mockImplementation(async (_teamId, _folderId, _file, options = {}) => {
            options.onProgress?.({ percent: 60 });
            return { id: 'file-upload' };
        });
    });

    it('submits selected legacy photo uploads, refreshes the library, and clears the file input', async () => {
        await loadTeamMediaModule();

        const fileInput = document.getElementById('photo-files');
        const firstPhoto = new File(['photo-one'], 'photo-one.jpg', { type: 'image/jpeg' });
        const secondPhoto = new File(['photo-two'], 'photo-two.png', { type: 'image/png' });
        document.getElementById('photo-folder').value = 'folderA';
        setSelectedFiles(fileInput, [firstPhoto, secondPhoto]);

        submitForm(document.getElementById('photo-upload-form'));

        await vi.waitUntil(() => mocks.uploadTeamMediaPhoto.mock.calls.length === 2);
        expect(mocks.uploadTeamMediaPhoto).toHaveBeenNthCalledWith(
            1,
            'team123',
            'folderA',
            firstPhoto,
            expect.objectContaining({ onProgress: expect.any(Function) })
        );
        expect(mocks.uploadTeamMediaPhoto).toHaveBeenNthCalledWith(
            2,
            'team123',
            'folderA',
            secondPhoto,
            expect.objectContaining({ onProgress: expect.any(Function) })
        );
        await vi.waitUntil(() => document.getElementById('team-media-alert').textContent.includes('2 photos uploaded.'));

        const progressRows = document.querySelectorAll('#upload-progress [data-upload-row]');
        expect(progressRows).toHaveLength(2);
        expect(document.querySelector('[data-upload-status="0"]').textContent).toBe('Uploaded');
        expect(document.querySelector('[data-upload-status="1"]').textContent).toBe('Uploaded');
        expect(document.getElementById('team-media-alert').className).toContain('bg-green-50');
        expect(mocks.getTeamMediaFolders).toHaveBeenCalledTimes(2);
        expect(fileInput.value).toBe('');
    });

    it('keeps unsupported legacy file uploads out of storage while preserving the selected folder', async () => {
        await loadTeamMediaModule();

        const fileInput = document.getElementById('media-files');
        const unsupportedFile = new File(['bad'], 'playbook.exe', { type: 'application/x-msdownload' });
        const pdfFile = new File(['pdf'], 'playbook.pdf', { type: 'application/pdf' });
        document.getElementById('file-folder').value = 'folderA';
        setSelectedFiles(fileInput, [unsupportedFile, pdfFile]);

        submitForm(document.getElementById('file-upload-form'));

        await vi.waitUntil(() => mocks.uploadTeamMediaFile.mock.calls.length === 1);
        expect(mocks.uploadTeamMediaFile).toHaveBeenCalledWith(
            'team123',
            'folderA',
            pdfFile,
            expect.objectContaining({ onProgress: expect.any(Function) })
        );
        expect(mocks.uploadTeamMediaFile.mock.calls.map((call) => call[2])).toEqual([pdfFile]);
        expect(mocks.uploadTeamMediaFile.mock.calls.map((call) => call[2])).not.toContain(unsupportedFile);
        await vi.waitUntil(() => document.getElementById('team-media-alert').textContent.includes('1 file uploaded, 1 failed.'));

        expect(document.querySelector('#file-upload-progress [data-upload-status="0"]').textContent)
            .toBe('Choose a supported document file that is 10 MB or smaller.');
        expect(document.querySelector('#file-upload-progress [data-upload-status="1"]').textContent).toBe('Uploaded');
        expect(document.getElementById('team-media-alert').className).toContain('bg-red-50');
        expect(document.getElementById('file-folder').value).toBe('folderA');
        expect(fileInput.value).toBe('');
    });

    it('preserves chosen upload albums when album detail filters re-render the page before submit', async () => {
        await loadTeamMediaModule();

        const photoInput = document.getElementById('photo-files');
        const fileInput = document.getElementById('media-files');
        const photo = new File(['photo'], 'team-photo.jpg', { type: 'image/jpeg' });
        const pdfFile = new File(['pdf'], 'playbook.pdf', { type: 'application/pdf' });
        document.getElementById('photo-folder').value = 'folderB';
        document.getElementById('file-folder').value = 'folderB';
        setSelectedFiles(photoInput, [photo]);
        setSelectedFiles(fileInput, [pdfFile]);

        document.querySelector('[data-media-type-filter="photos"]').click();

        expect(document.getElementById('photo-folder').value).toBe('folderB');
        expect(document.getElementById('file-folder').value).toBe('folderB');

        submitForm(document.getElementById('photo-upload-form'));
        await vi.waitUntil(() => mocks.uploadTeamMediaPhoto.mock.calls.length === 1);
        expect(mocks.uploadTeamMediaPhoto).toHaveBeenCalledWith(
            'team123',
            'folderB',
            photo,
            expect.objectContaining({ onProgress: expect.any(Function) })
        );

        submitForm(document.getElementById('file-upload-form'));
        await vi.waitUntil(() => mocks.uploadTeamMediaFile.mock.calls.length === 1);
        expect(mocks.uploadTeamMediaFile).toHaveBeenCalledWith(
            'team123',
            'folderB',
            pdfFile,
            expect.objectContaining({ onProgress: expect.any(Function) })
        );
    });
});
