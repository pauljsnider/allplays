import { checkAuth } from './auth.js?v=37';
import {
    getTeam,
    getTeamMediaFolders,
    getTeamMediaItemsPage,
    createTeamMediaFolder,
    updateTeamMediaFolder,
    deleteTeamMediaFolder,
    createTeamMediaLink,
    uploadTeamMediaFile,
    uploadTeamMediaPhoto,
    deleteTeamMediaItem,
    reorderTeamMediaFolders,
    reorderTeamMediaItems,
    moveTeamMediaItems,
    bulkDeleteTeamMediaItems,
    setTeamMediaAlbumCover,
    updateTeamMediaItem
} from './db.js?v=74';
import {
    canContributeTeamMedia,
    canDeleteTeamMediaItem,
    canManageTeamMedia,
    canReadTeamMediaAlbum,
    getTeamMediaItemUrl,
    getTeamMediaUploaderName,
    isSafeTeamMediaPhoto,
    isSafeTeamMediaUrl,
    isSupportedTeamMediaDocument,
    isSupportedTeamMediaImage,
    isTeamMediaDocument,
    sortByMediaOrder
} from './team-media-utils.js?v=4';

const state = {
    teamId: '',
    team: null,
    user: null,
    canManage: false,
    canContribute: false,
    folders: [],
    items: [],
    itemPageState: new Map(),
    selectedFolderId: '',
    selectedMediaType: 'all',
    selectedIds: new Set(),
    actionInFlight: false
};

const TEAM_MEDIA_PAGE_SIZE = 24;

const els = {
    title: document.getElementById('team-media-title'),
    subtitle: document.getElementById('team-media-subtitle'),
    alert: document.getElementById('team-media-alert'),
    uploadPanel: document.getElementById('team-media-upload-panel'),
    uploadForm: document.getElementById('photo-upload-form'),
    photoFolder: document.getElementById('photo-folder'),
    photoFiles: document.getElementById('photo-files'),
    uploadProgress: document.getElementById('upload-progress'),
    fileUploadForm: document.getElementById('file-upload-form'),
    fileFolder: document.getElementById('file-folder'),
    mediaFiles: document.getElementById('media-files'),
    fileUploadProgress: document.getElementById('file-upload-progress'),
    adminPanel: document.getElementById('team-media-admin-panel'),
    bulkActions: document.getElementById('bulk-actions'),
    selectedCount: document.getElementById('selected-count'),
    foldersList: document.getElementById('folders-list'),
    albumDetail: document.getElementById('album-detail'),
    folderForm: document.getElementById('folder-form'),
    folderName: document.getElementById('folder-name'),
    folderVisibility: document.getElementById('folder-visibility'),
    linkForm: document.getElementById('link-form'),
    linkFolder: document.getElementById('link-folder'),
    linkTitle: document.getElementById('link-title'),
    linkUrl: document.getElementById('link-url'),
    linkSubmit: document.getElementById('link-submit'),
    linkFormHelp: document.getElementById('link-form-help'),
    moveFolder: document.getElementById('move-folder'),
    moveSelected: document.getElementById('move-selected'),
    deleteSelected: document.getElementById('delete-selected'),
    backLink: document.getElementById('team-back-link')
};

function getTeamIdFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const queryTeamId = params.get('teamId');
    if (queryTeamId) return queryTeamId;
    return String(window.location.hash || '').replace(/^#teamId=/, '').replace(/^#/, '');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[char]));
}

function showAlert(message, type = 'info') {
    els.alert.textContent = message;
    els.alert.className = `mb-4 rounded-xl border px-4 py-3 text-sm ${type === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-green-200 bg-green-50 text-green-700'}`;
    els.alert.classList.remove('hidden');
}

function clearAlert() {
    els.alert.classList.add('hidden');
    els.alert.textContent = '';
}

function getSelectedFolder() {
    return state.folders.find((folder) => folder.id === state.selectedFolderId) || state.folders[0] || null;
}

function getItemsForFolder(folderId) {
    return sortByMediaOrder(state.items
        .filter((item) => item.folderId === folderId)
        .filter((item) => isSafeTeamMediaUrl(getTeamMediaItemUrl(item))));
}

function getFolderPageState(folderId) {
    return state.itemPageState.get(folderId) || { loaded: false, hasMore: false, nextCursor: null };
}

function getStoredMediaCount(folder = {}) {
    const count = Number(folder.itemCount ?? folder.mediaCount ?? folder.totalItems);
    return Number.isFinite(count) && count >= 0 ? count : null;
}

function getFolderItemCount(folder = {}) {
    const loadedCount = getItemsForFolder(folder.id).length;
    const storedCount = getStoredMediaCount(folder);
    return storedCount === null ? loadedCount : Math.max(storedCount, loadedCount);
}

function mergeFolderPageItems(folderId, items = [], append = false) {
    const existingItems = append ? state.items.filter((item) => item.folderId === folderId) : [];
    const seen = new Set();
    const mergedFolderItems = [...existingItems, ...items].filter((item) => {
        const itemId = String(item?.id || '').trim();
        if (!itemId || seen.has(itemId)) return false;
        seen.add(itemId);
        return true;
    });
    state.items = [
        ...state.items.filter((item) => item.folderId !== folderId),
        ...mergedFolderItems
    ];
}

async function loadFolderItemsPage(folderId, { append = false } = {}) {
    const cleanFolderId = String(folderId || '').trim();
    if (!cleanFolderId) return;
    const currentPageState = getFolderPageState(cleanFolderId);
    if (append && !currentPageState.nextCursor) return;

    const page = await getTeamMediaItemsPage(state.teamId, cleanFolderId, {
        pageSize: TEAM_MEDIA_PAGE_SIZE,
        cursor: append ? currentPageState.nextCursor : null
    });
    mergeFolderPageItems(cleanFolderId, Array.isArray(page.items) ? page.items : [], append);
    state.itemPageState.set(cleanFolderId, {
        loaded: true,
        hasMore: page.hasMore === true,
        nextCursor: page.nextCursor || page.lastDoc || null
    });
    state.selectedIds = new Set([...state.selectedIds].filter((id) => state.items.some((item) => item.id === id)));
    render();
}

const MEDIA_TYPE_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'photos', label: 'Photos' },
    { id: 'videos', label: 'Videos' },
    { id: 'files', label: 'Files' }
];

function isVideoMediaItem(item = {}) {
    return String(item.type || '').toLowerCase().replace(/-/g, '_') === 'video_link';
}

function matchesMediaTypeFilter(item, filterId = 'all') {
    if (filterId === 'photos') return isSafeTeamMediaPhoto(item);
    if (filterId === 'videos') return isVideoMediaItem(item);
    if (filterId === 'files') return isTeamMediaDocument(item);
    return true;
}

function getMediaTypeCounts(items = []) {
    return {
        all: items.length,
        photos: items.filter((item) => matchesMediaTypeFilter(item, 'photos')).length,
        videos: items.filter((item) => matchesMediaTypeFilter(item, 'videos')).length,
        files: items.filter((item) => matchesMediaTypeFilter(item, 'files')).length
    };
}

function getFilteredItems(items = []) {
    return items.filter((item) => matchesMediaTypeFilter(item, state.selectedMediaType));
}

function getSelectedMediaTypeLabel() {
    return MEDIA_TYPE_FILTERS.find((filter) => filter.id === state.selectedMediaType)?.label || 'All';
}

function getVisibilityLabel(folder) {
    return folder?.visibility === 'private' ? 'Private · admins only' : 'Team-visible';
}

function renderFolderOptions() {
    const hasFolders = state.folders.length > 0;
    const options = state.folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name || 'Untitled album')}</option>`).join('');
    const placeholder = `<option value="">${hasFolders ? 'Choose album' : 'Create an album first'}</option>`;
    els.linkFolder.innerHTML = placeholder + options;
    els.photoFolder.innerHTML = placeholder + options;
    els.fileFolder.innerHTML = placeholder + options;
    els.moveFolder.innerHTML = placeholder + options;
    [els.linkFolder, els.linkTitle, els.linkUrl, els.linkSubmit, els.photoFolder, els.photoFiles, els.fileFolder, els.mediaFiles].forEach((element) => {
        if (!element) return;
        element.disabled = !hasFolders;
        element.classList.toggle('opacity-50', !hasFolders);
        element.classList.toggle('cursor-not-allowed', !hasFolders);
    });
    if (els.linkFormHelp) {
        els.linkFormHelp.textContent = hasFolders
            ? 'Choose an album, then save the video link.'
            : 'Save an album first. Video links need an album destination.';
    }
}

function formatFileSize(size) {
    const bytes = Number(size || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderBulkActions() {
    const count = state.selectedIds.size;
    els.selectedCount.textContent = String(count);
    els.bulkActions.classList.toggle('hidden', !state.canManage || count === 0);
}

function formatMediaDate(value) {
    const raw = value?.toDate ? value.toDate() : value;
    const date = raw instanceof Date ? raw : raw ? new Date(raw) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderAlbumCards() {
    if (state.folders.length === 0) {
        els.foldersList.innerHTML = `<div class="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">${state.canManage ? 'No albums yet. Add one to start organizing media.' : 'No team-visible albums have been shared yet.'}</div>`;
        return;
    }

    els.foldersList.innerHTML = state.folders.map((folder, folderIndex) => {
        const isSelected = getSelectedFolder()?.id === folder.id;
        const itemCount = getFolderItemCount(folder);
        const folderControls = state.canManage ? `
            <div class="flex flex-wrap gap-2">
                <button type="button" data-folder-move="up" data-folder-id="${escapeHtml(folder.id)}" ${folderIndex === 0 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Up</button>
                <button type="button" data-folder-move="down" data-folder-id="${escapeHtml(folder.id)}" ${folderIndex === state.folders.length - 1 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Down</button>
                <button type="button" data-edit-folder="${escapeHtml(folder.id)}" class="rounded-lg border border-primary-200 px-3 py-1 text-xs font-semibold text-primary-700">Edit</button>
                <button type="button" data-delete-folder="${escapeHtml(folder.id)}" class="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700">Delete</button>
            </div>` : '';
        const coverUrl = isSafeTeamMediaUrl(folder.coverPhotoUrl) ? folder.coverPhotoUrl : '';
        return `
            <article class="rounded-2xl border ${isSelected ? 'border-primary-300 ring-2 ring-primary-100' : 'border-gray-200'} bg-white p-5 shadow-sm">
                <button type="button" data-select-folder="${escapeHtml(folder.id)}" class="block w-full text-left">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex items-start gap-4">
                            ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(folder.coverPhotoTitle || folder.name || 'Album cover')}" class="h-16 w-16 rounded-xl object-cover">` : ''}
                            <div>
                                <h2 class="text-xl font-bold">${escapeHtml(folder.name || 'Untitled album')}</h2>
                                <p class="mt-1 text-sm text-gray-500">${itemCount} item${itemCount === 1 ? '' : 's'}</p>
                            </div>
                        </div>
                        <span class="rounded-full ${folder.visibility === 'private' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'} px-3 py-1 text-xs font-semibold">${escapeHtml(getVisibilityLabel(folder))}</span>
                    </div>
                    <p class="mt-4 text-sm font-semibold text-primary-700">${isSelected ? 'Viewing album' : 'View album'}</p>
                </button>
                ${folderControls ? `<div class="mt-4 border-t border-gray-100 pt-4">${folderControls}</div>` : ''}
            </article>`;
    }).join('');
}

function renderAlbumDetail() {
    const folder = getSelectedFolder();
    if (!folder) {
        els.albumDetail.innerHTML = '';
        return;
    }

    const items = getItemsForFolder(folder.id);
    const pageState = getFolderPageState(folder.id);
    const folderItemCount = getFolderItemCount(folder);
    const counts = getMediaTypeCounts(items);
    const filteredItems = getFilteredItems(items);
    const selectedMediaTypeLabel = getSelectedMediaTypeLabel();
    const emptyStateLabel = state.selectedMediaType === 'all' ? 'media' : selectedMediaTypeLabel.toLowerCase();
    const filterTabs = MEDIA_TYPE_FILTERS.map((filter) => {
        const selected = filter.id === state.selectedMediaType;
        return `<button type="button" data-media-type-filter="${escapeHtml(filter.id)}" aria-pressed="${selected ? 'true' : 'false'}" class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'}">${escapeHtml(filter.label)} <span class="rounded-full ${selected ? 'bg-white/20 text-white' : 'bg-white text-gray-600'} px-1.5 py-0.5 text-[10px]">${counts[filter.id]}</span></button>`;
    }).join('');
    const itemRows = filteredItems.length === 0
        ? `<div class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">No ${escapeHtml(emptyStateLabel)} in this album.</div>`
        : `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${filteredItems.map((item, itemIndex) => {
            const itemUrl = getTeamMediaItemUrl(item);
            const isPhoto = isSafeTeamMediaPhoto(item);
            const isFile = isTeamMediaDocument(item);
            const canDeleteItem = canDeleteTeamMediaItem(state.user, state.team, item);
            const canRenameItem = state.canManage || (state.user && state.user.uid === item.uploadedBy);
            const title = item.title || item.fileName || (isPhoto ? 'Untitled photo' : isFile ? 'Untitled file' : 'Untitled video');
            const uploadedBy = getTeamMediaUploaderName(item);
            const uploadedAt = formatMediaDate(item.uploadedAt || item.createdAt);
            const fileDetails = isPhoto || isFile ? [item.mimeType || (isPhoto ? 'image' : 'file'), formatFileSize(item.size)].filter(Boolean).join(' · ') : '';
            const metadata = [uploadedBy ? `Uploaded by ${uploadedBy}` : '', uploadedAt, fileDetails].filter(Boolean).join(' • ');
            return `
                <div class="flex h-full flex-col gap-3 rounded-xl border border-gray-200 p-4" data-item-id="${escapeHtml(item.id)}">
                    ${isPhoto ? `<a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer" class="block overflow-hidden rounded-lg bg-gray-100"><img src="${escapeHtml(itemUrl)}" alt="${escapeHtml(title)}" loading="lazy" class="h-48 w-full object-cover"></a>` : ''}
                    ${isFile ? `<a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer" class="flex h-48 items-center justify-center rounded-lg bg-indigo-50 text-center text-indigo-700"><div><div class="text-4xl">📄</div><div class="mt-2 px-4 text-sm font-semibold">${escapeHtml(title)}</div></div></a>` : ''}
                    <div class="flex items-start gap-3">
                        ${state.canManage ? `<input type="checkbox" data-select-item="${escapeHtml(item.id)}" ${state.selectedIds.has(item.id) ? 'checked' : ''} class="mt-1 h-4 w-4 rounded border-gray-300">` : ''}
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-indigo-700 hover:text-indigo-900 ${canRenameItem ? 'group-hover:hidden' : ''}" data-item-title-display="${escapeHtml(item.id)}">${escapeHtml(title)}</a>
                                ${canRenameItem ? `<button type="button" data-item-rename="${escapeHtml(item.id)}" class="inline-flex items-center justify-center rounded-full text-gray-400 hover:text-indigo-700 p-1 -my-1 -mr-1"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>` : ''}
                            </div>
                            <div class="hidden" data-item-title-edit="${escapeHtml(item.id)}">
                                <input type="text" value="${escapeHtml(title)}" class="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 text-sm py-1 px-2" data-item-title-input="${escapeHtml(item.id)}">
                            </div>
                            <div class="text-xs text-gray-500">${escapeHtml(metadata || 'Media item')}</div>
                            ${!isPhoto && !isFile ? `<div class="break-all text-xs text-gray-500">${escapeHtml(itemUrl)}</div>` : ''}
                        </div>
                    </div>
                    <div class="mt-auto flex flex-wrap gap-2">
                        <a href="${escapeHtml(itemUrl)}" download class="rounded-lg border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Download</a>
                        ${state.canManage && isPhoto ? `<button type="button" data-set-cover="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" class="rounded-lg border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Set cover</button>` : ''}
                        ${state.canManage ? `<button type="button" data-item-move="up" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${itemIndex === 0 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Up</button>
                        <button type="button" data-item-move="down" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${itemIndex === filteredItems.length - 1 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Down</button>` : ''}
                        ${canDeleteItem ? `<button type="button" data-item-delete="${escapeHtml(item.id)}" class="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>` : ''}
                    </div>
                </div>`;
        }).join('')}</div>`;
    const loadMoreRow = pageState.hasMore ? `
        <div class="flex justify-center">
            <button type="button" data-load-more-media="${escapeHtml(folder.id)}" class="rounded-lg border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">Load more</button>
        </div>` : '';

    els.albumDetail.innerHTML = `
        <article class="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
            <header class="border-b border-gray-100 p-5">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 class="text-2xl font-bold">${escapeHtml(folder.name || 'Untitled album')}</h2>
                        <p class="text-sm text-gray-500">${items.length}${folderItemCount > items.length || pageState.hasMore ? ` of ${folderItemCount}` : ''} item${folderItemCount === 1 ? '' : 's'} · ${escapeHtml(getVisibilityLabel(folder))}</p>
                    </div>
                </div>
                <div class="mt-4 flex flex-wrap gap-2" aria-label="Media type filters">${filterTabs}</div>
            </header>
            <div class="space-y-3 p-5">${itemRows}${loadMoreRow}</div>
        </article>`;
}

function render() {
    els.title.textContent = state.team?.name ? `${state.team.name} Media` : 'Media Library';
    els.subtitle.textContent = state.canManage
        ? 'Manage albums, visibility, ordering, photos, files, and video links.'
        : state.canContribute
            ? 'Upload team photos and files or browse shared video links and highlights.'
            : 'Team-visible albums with organized photos, files, video links, and highlights.';
    els.uploadPanel.classList.toggle('hidden', !state.canContribute);
    els.adminPanel.classList.toggle('hidden', !state.canManage);
    els.backLink.href = state.teamId ? `team.html#teamId=${encodeURIComponent(state.teamId)}` : 'team.html';
    renderFolderOptions();
    renderBulkActions();
    renderAlbumCards();
    renderAlbumDetail();
}

function isPermissionDenied(error) {
    return error?.code === 'permission-denied' ||
        String(error?.message || '').toLowerCase().includes('permission');
}

function getMediaPermissionMessage() {
    return 'Team media permissions are not enabled for this Firebase project yet. Deploy the latest Firestore rules before adding albums or media.';
}

export async function loadLibrary() {
    try {
        state.folders = await getTeamMediaFolders(state.teamId, { includePrivate: state.canManage });
        if (!state.canManage) {
            state.folders = state.folders.filter((folder) => canReadTeamMediaAlbum(folder, false));
        }
        if (!state.folders.some((folder) => folder.id === state.selectedFolderId)) {
            state.selectedFolderId = state.folders[0]?.id || '';
        }
        state.items = [];
        state.itemPageState = new Map();
        state.selectedIds.clear();
        if (state.selectedFolderId) {
            await loadFolderItemsPage(state.selectedFolderId);
            return;
        }
        render();
    } catch (error) {
        if (!isPermissionDenied(error)) {
            throw error;
        }
        console.warn('Unable to load team media library; showing empty state:', error);
        state.folders = [];
        state.items = [];
        state.itemPageState = new Map();
        state.selectedIds.clear();
        render();
        if (state.canManage) {
            els.adminPanel.classList.add('hidden');
            showAlert(getMediaPermissionMessage(), 'error');
            els.foldersList.innerHTML = `<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">${escapeHtml(getMediaPermissionMessage())}</div>`;
        }
    }
}

async function persistAndReload(action, successMessage) {
    if (state.actionInFlight) return;
    state.actionInFlight = true;
    clearAlert();
    try {
        await action();
        await loadLibrary();
        showAlert(successMessage, 'success');
        return true;
    } catch (error) {
        console.error('Team media action failed:', error);
        showAlert(isPermissionDenied(error) ? getMediaPermissionMessage() : (error.message || 'Unable to save media changes. Refresh and try again.'), 'error');
        return false;
    } finally {
        state.actionInFlight = false;
    }
}

function moveInArray(items, id, direction) {
    const next = [...items];
    const index = next.findIndex((item) => item.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= next.length) return next;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

async function uploadSelectedFiles({ files, folderId, progressEl, validateFile, uploadFile, nounSingular, nounPlural, unsupportedMessage }) {
    progressEl.innerHTML = files.map((file, index) => `
        <div data-upload-row="${index}" class="rounded-lg border border-gray-200 p-3">
            <div class="flex justify-between gap-3"><span>${escapeHtml(file.name)}</span><span data-upload-status="${index}">Waiting</span></div>
            <div class="mt-2 h-2 rounded-full bg-gray-100"><div data-upload-bar="${index}" class="h-2 rounded-full bg-indigo-600" style="width:0%"></div></div>
        </div>`).join('');

    let uploadedCount = 0;
    let failedCount = 0;
    for (const [index, file] of files.entries()) {
        const status = progressEl.querySelector(`[data-upload-status="${index}"]`);
        const bar = progressEl.querySelector(`[data-upload-bar="${index}"]`);
        try {
            if (!validateFile(file)) throw new Error(unsupportedMessage);
            status.textContent = 'Uploading';
            await uploadFile(state.teamId, folderId, file, {
                onProgress: ({ percent }) => {
                    bar.style.width = `${percent}%`;
                    status.textContent = `${percent}%`;
                }
            });
            uploadedCount += 1;
            bar.style.width = '100%';
            status.textContent = 'Uploaded';
        } catch (error) {
            failedCount += 1;
            status.textContent = error.message || 'Failed. Try again.';
            status.classList.add('text-red-700');
        }
    }

    if (uploadedCount > 0) state.selectedFolderId = folderId;
    await loadLibrary();
    showAlert(`${uploadedCount} ${uploadedCount === 1 ? nounSingular : nounPlural} uploaded${failedCount ? `, ${failedCount} failed` : ''}.`, failedCount ? 'error' : 'success');
    return { uploadedCount, failedCount };
}

els.foldersList.addEventListener('click', async (event) => {
    const selectedButton = event.target.closest('[data-select-folder]');
    if (selectedButton) {
        state.selectedFolderId = selectedButton.dataset.selectFolder;
        state.selectedIds.clear();
        if (!getFolderPageState(state.selectedFolderId).loaded) {
            render();
            await loadFolderItemsPage(state.selectedFolderId);
            return;
        }
        render();
        return;
    }

    if (!state.canManage) return;
    const folderButton = event.target.closest('[data-folder-move]');
    if (folderButton) {
        const reordered = moveInArray(state.folders, folderButton.dataset.folderId, folderButton.dataset.folderMove);
        persistAndReload(() => reorderTeamMediaFolders(state.teamId, reordered.map((folder) => folder.id)), 'Album order saved.');
        return;
    }

    const editButton = event.target.closest('[data-edit-folder]');
    if (editButton) {
        const folder = state.folders.find((entry) => entry.id === editButton.dataset.editFolder);
        if (!folder) return;
        const name = window.prompt('Album name', folder.name || '');
        if (name === null) return;
        const visibility = window.confirm('Make this album team-visible? Choose Cancel for admin-only/private.') ? 'team' : 'private';
        persistAndReload(() => updateTeamMediaFolder(state.teamId, folder.id, { name, visibility }), 'Album updated.');
        return;
    }

    const deleteButton = event.target.closest('[data-delete-folder]');
    if (deleteButton) {
        const folder = state.folders.find((entry) => entry.id === deleteButton.dataset.deleteFolder);
        if (!folder) return;
        if (!window.confirm(`Delete ${folder.name || 'this album'} and its media links? This cannot be undone.`)) return;
        persistAndReload(async () => {
            await deleteTeamMediaFolder(state.teamId, folder.id);
            state.selectedIds.clear();
            if (state.selectedFolderId === folder.id) state.selectedFolderId = '';
        }, 'Album deleted.');
    }
});

els.albumDetail.addEventListener('click', async (event) => {
    const filterButton = event.target.closest('[data-media-type-filter]');
    if (filterButton) {
        state.selectedMediaType = filterButton.dataset.mediaTypeFilter || 'all';
        state.selectedIds.clear();
        render();
        return;
    }

    const loadMoreButton = event.target.closest('[data-load-more-media]');
    if (loadMoreButton) {
        await loadFolderItemsPage(loadMoreButton.dataset.loadMoreMedia, { append: true });
        return;
    }

    const deleteButton = event.target.closest('[data-item-delete]');
    if (deleteButton) {
        const item = state.items.find((candidate) => candidate.id === deleteButton.dataset.itemDelete);
        if (!canDeleteTeamMediaItem(state.user, state.team, item)) return;
        if (!window.confirm('Delete this media item? This cannot be undone.')) return;
        if (state.actionInFlight) return;
        state.actionInFlight = true;
        clearAlert();
        try {
            await deleteTeamMediaItem(state.teamId, item);
            state.items = state.items.filter((candidate) => candidate.id !== item.id);
            state.selectedIds.delete(item.id);
            render();
            showAlert('Media item deleted.', 'success');
        } catch (error) {
            console.error('Team media action failed:', error);
            showAlert(isPermissionDenied(error) ? getMediaPermissionMessage() : (error.message || 'Unable to save media changes. Refresh and try again.'), 'error');
        } finally {
            state.actionInFlight = false;
        }
        return;
    }

    const renameButton = event.target.closest('[data-item-rename]');
    if (renameButton) {
        const itemId = renameButton.dataset.itemRename;
        const item = state.items.find((candidate) => candidate.id === itemId);
        if (!item) return;
        const canRenameItem = state.canManage || (state.user && state.user.uid === item.uploadedBy);
        if (!canRenameItem) return;

        const displayEl = els.albumDetail.querySelector(`[data-item-title-display="${itemId}"]`);
        const editContainerEl = els.albumDetail.querySelector(`[data-item-title-edit="${itemId}"]`);
        const inputEl = els.albumDetail.querySelector(`[data-item-title-input="${itemId}"]`);

        if (!displayEl || !editContainerEl || !inputEl) return;

        const originalTitle = item.title || item.fileName || '';
        let isRenaming = false;
        const closeEditor = (nextTitle = originalTitle) => {
            inputEl.onblur = null;
            inputEl.onkeydown = null;
            inputEl.value = nextTitle;
            displayEl.classList.remove('hidden');
            editContainerEl.classList.add('hidden');
        };

        displayEl.classList.add('hidden');
        editContainerEl.classList.remove('hidden');
        inputEl.value = originalTitle;
        inputEl.focus();

        const saveTitle = async () => {
            if (isRenaming) return;
            const newTitle = String(inputEl.value || '').trim();

            if (newTitle === originalTitle || newTitle === '') {
                closeEditor(originalTitle);
                return;
            }

            isRenaming = true;
            const renamed = await persistAndReload(async () => {
                await updateTeamMediaItem(state.teamId, itemId, { title: newTitle });
            }, 'Media item renamed.');
            isRenaming = false;

            if (renamed) {
                displayEl.textContent = newTitle;
                closeEditor(newTitle);
            } else {
                closeEditor(originalTitle);
            }
        };

        inputEl.onblur = saveTitle;
        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                inputEl.blur(); // Trigger blur to save
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeEditor(originalTitle);
            }
        };
        return;
    }

    if (!state.canManage) return;
    const coverButton = event.target.closest('[data-set-cover]');
    if (coverButton) {
        const item = state.items.find((candidate) => candidate.id === coverButton.dataset.setCover);
        persistAndReload(() => setTeamMediaAlbumCover(state.teamId, coverButton.dataset.folderId, item), 'Album cover saved.');
        return;
    }

    const itemButton = event.target.closest('[data-item-move]');
    if (itemButton) {
        const items = getItemsForFolder(itemButton.dataset.folderId);
        const reordered = moveInArray(items, itemButton.dataset.itemId, itemButton.dataset.itemMove);
        persistAndReload(() => reorderTeamMediaItems(state.teamId, reordered.map((item) => item.id)), 'Item order saved.');
    }
});

els.albumDetail.addEventListener('change', (event) => {
    if (!state.canManage) return;
    const checkbox = event.target.closest('[data-select-item]');
    if (!checkbox) return;
    if (checkbox.checked) {
        state.selectedIds.add(checkbox.dataset.selectItem);
    } else {
        state.selectedIds.delete(checkbox.dataset.selectItem);
    }
    renderBulkActions();
});

els.folderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    persistAndReload(async () => {
        const folderId = await createTeamMediaFolder(state.teamId, {
            name: els.folderName.value,
            visibility: els.folderVisibility.value
        });
        state.selectedFolderId = folderId;
        els.folderName.value = '';
        els.folderVisibility.value = 'team';
    }, 'Album added.');
});

els.linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    persistAndReload(async () => {
        await createTeamMediaLink(state.teamId, els.linkFolder.value, {
            title: els.linkTitle.value,
            url: els.linkUrl.value
        });
        state.selectedFolderId = els.linkFolder.value;
        els.linkTitle.value = '';
        els.linkUrl.value = '';
    }, 'Video link saved.');
});

els.uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();
    const files = Array.from(els.photoFiles.files || []);
    if (!state.canContribute) return;
    if (!els.photoFolder.value) {
        showAlert('Choose an album before uploading photos.', 'error');
        return;
    }
    if (files.length === 0) {
        showAlert('Choose at least one image to upload.', 'error');
        return;
    }

    const { uploadedCount } = await uploadSelectedFiles({
        files,
        folderId: els.photoFolder.value,
        progressEl: els.uploadProgress,
        validateFile: isSupportedTeamMediaImage,
        uploadFile: uploadTeamMediaPhoto,
        nounSingular: 'photo',
        nounPlural: 'photos',
        unsupportedMessage: 'Choose an image file that is 10 MB or smaller.'
    });
    if (uploadedCount > 0) els.photoFiles.value = '';
});

els.fileUploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();
    const files = Array.from(els.mediaFiles.files || []);
    if (!state.canContribute) return;
    if (!els.fileFolder.value) {
        showAlert('Choose an album before uploading files.', 'error');
        return;
    }
    if (files.length === 0) {
        showAlert('Choose at least one file to upload.', 'error');
        return;
    }

    const { uploadedCount } = await uploadSelectedFiles({
        files,
        folderId: els.fileFolder.value,
        progressEl: els.fileUploadProgress,
        validateFile: isSupportedTeamMediaDocument,
        uploadFile: uploadTeamMediaFile,
        nounSingular: 'file',
        nounPlural: 'files',
        unsupportedMessage: 'Choose a supported document file that is 10 MB or smaller.'
    });
    if (uploadedCount > 0) els.mediaFiles.value = '';
});

els.moveSelected.addEventListener('click', () => {
    const ids = [...state.selectedIds];
    persistAndReload(async () => {
        await moveTeamMediaItems(state.teamId, ids, els.moveFolder.value);
        state.selectedFolderId = els.moveFolder.value;
        state.selectedIds.clear();
    }, 'Selected media moved.');
});

els.deleteSelected.addEventListener('click', () => {
    const ids = [...state.selectedIds];
    if (!window.confirm(`Delete ${ids.length} selected media item${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    persistAndReload(async () => {
        await bulkDeleteTeamMediaItems(state.teamId, ids);
        state.selectedIds.clear();
    }, 'Selected media deleted.');
});

checkAuth(async (user) => {
    state.user = user;
    state.teamId = getTeamIdFromLocation();
    if (!state.teamId) {
        els.foldersList.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Missing team id.</div>';
        return;
    }

    try {
        state.team = await getTeam(state.teamId, { includeInactive: true });
        state.team.id = state.team.id || state.teamId;
        state.canManage = canManageTeamMedia(user, state.team);
        state.canContribute = canContributeTeamMedia(user, state.team);
        await loadLibrary();
    } catch (error) {
        console.error('Unable to load team media:', error);
        els.foldersList.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Unable to load team media.</div>';
    }
});

// Initial load
// The loadLibrary function is called once after authentication
// is confirmed in the checkAuth callback, which is the entry point.
// No need to call it here.
