import { checkAuth } from './auth.js?v=13';
import {
    getTeam,
    getTeamMediaFolders,
    getTeamMediaItems,
    createTeamMediaFolder,
    createTeamMediaLink,
    uploadTeamMediaPhoto,
    deleteTeamMediaItem,
    reorderTeamMediaFolders,
    reorderTeamMediaItems,
    moveTeamMediaItems,
    bulkDeleteTeamMediaItems,
    setTeamMediaAlbumCover
} from './db.js?v=13';
import { canContributeTeamMedia, canDeleteTeamMediaItem, canManageTeamMedia, getTeamMediaItemUrl, getTeamMediaUploaderName, isSafeTeamMediaPhoto, isSafeTeamMediaUrl, isSupportedTeamMediaImage, sortByMediaOrder } from './team-media-utils.js?v=2';

const state = {
    teamId: '',
    team: null,
    user: null,
    canManage: false,
    canContribute: false,
    folders: [],
    items: [],
    selectedIds: new Set()
};

const els = {
    title: document.getElementById('team-media-title'),
    subtitle: document.getElementById('team-media-subtitle'),
    alert: document.getElementById('team-media-alert'),
    uploadPanel: document.getElementById('team-media-upload-panel'),
    uploadForm: document.getElementById('photo-upload-form'),
    photoFolder: document.getElementById('photo-folder'),
    photoFiles: document.getElementById('photo-files'),
    uploadProgress: document.getElementById('upload-progress'),
    adminPanel: document.getElementById('team-media-admin-panel'),
    bulkActions: document.getElementById('bulk-actions'),
    selectedCount: document.getElementById('selected-count'),
    foldersList: document.getElementById('folders-list'),
    folderForm: document.getElementById('folder-form'),
    folderName: document.getElementById('folder-name'),
    linkForm: document.getElementById('link-form'),
    linkFolder: document.getElementById('link-folder'),
    linkTitle: document.getElementById('link-title'),
    linkUrl: document.getElementById('link-url'),
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

function getItemsForFolder(folderId) {
    return sortByMediaOrder(state.items
        .filter((item) => item.folderId === folderId)
        .filter((item) => isSafeTeamMediaUrl(getTeamMediaItemUrl(item))));
}

function renderFolderOptions() {
    const options = state.folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name || 'Untitled folder')}</option>`).join('');
    const placeholder = '<option value="">Choose folder</option>';
    els.linkFolder.innerHTML = placeholder + options;
    els.photoFolder.innerHTML = placeholder + options;
    els.moveFolder.innerHTML = placeholder + options;
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

function render() {
    els.title.textContent = state.team?.name ? `${state.team.name} Media` : 'Media Library';
    els.subtitle.textContent = state.canManage
        ? 'Select media to move or delete. Use up/down controls to persist ordering.'
        : state.canContribute
            ? 'Upload team photos or browse shared video links and highlights.'
            : 'Organized photos, video links, and highlights for this team.';
    els.uploadPanel.classList.toggle('hidden', !state.canContribute);
    els.adminPanel.classList.toggle('hidden', !state.canManage);
    els.backLink.href = state.teamId ? `team.html#teamId=${encodeURIComponent(state.teamId)}` : 'team.html';
    renderFolderOptions();
    renderBulkActions();

    if (state.folders.length === 0) {
        els.foldersList.innerHTML = `<div class="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">${state.canManage ? 'No folders yet. Add one to start organizing media.' : 'No media folders have been shared yet.'}</div>`;
        return;
    }

    els.foldersList.innerHTML = state.folders.map((folder, folderIndex) => {
        const items = getItemsForFolder(folder.id);
        const folderControls = state.canManage ? `
            <div class="flex gap-2">
                <button type="button" data-folder-move="up" data-folder-id="${escapeHtml(folder.id)}" ${folderIndex === 0 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Up</button>
                <button type="button" data-folder-move="down" data-folder-id="${escapeHtml(folder.id)}" ${folderIndex === state.folders.length - 1 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Down</button>
            </div>` : '';
        const itemRows = items.length === 0
            ? `<div class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">No media in this folder.</div>`
            : `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${items.map((item, itemIndex) => {
                const itemUrl = getTeamMediaItemUrl(item);
                const isPhoto = isSafeTeamMediaPhoto(item);
                const canDeleteItem = canDeleteTeamMediaItem(state.user, state.team, item);
                const title = item.title || item.fileName || (isPhoto ? 'Untitled photo' : 'Untitled video');
                const uploadedBy = getTeamMediaUploaderName(item);
                const uploadedAt = formatMediaDate(item.uploadedAt || item.createdAt);
                const fileDetails = isPhoto ? `${item.mimeType || 'image'}${item.size ? ` · ${Number(item.size || 0).toLocaleString()} bytes` : ''}` : '';
                const metadata = [uploadedBy ? `Uploaded by ${uploadedBy}` : '', uploadedAt, fileDetails].filter(Boolean).join(' • ');
                return `
                    <div class="flex h-full flex-col gap-3 rounded-xl border border-gray-200 p-4" data-item-id="${escapeHtml(item.id)}">
                        ${isPhoto ? `<a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer" class="block overflow-hidden rounded-lg bg-gray-100"><img src="${escapeHtml(itemUrl)}" alt="${escapeHtml(title)}" loading="lazy" class="h-48 w-full object-cover"></a>` : ''}
                        <div class="flex items-start gap-3">
                            ${state.canManage ? `<input type="checkbox" data-select-item="${escapeHtml(item.id)}" ${state.selectedIds.has(item.id) ? 'checked' : ''} class="mt-1 h-4 w-4 rounded border-gray-300">` : ''}
                            <div class="min-w-0 flex-1">
                                <a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-primary-700 hover:text-primary-900">${escapeHtml(title)}</a>
                                <div class="text-xs text-gray-500">${escapeHtml(metadata || 'Media item')}</div>
                                ${!isPhoto ? `<div class="break-all text-xs text-gray-500">${escapeHtml(itemUrl)}</div>` : ''}
                            </div>
                        </div>
                        <div class="mt-auto flex flex-wrap gap-2">
                            <a href="${escapeHtml(itemUrl)}" download class="rounded-lg border border-primary-200 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50">Download</a>
                            ${state.canManage && isPhoto ? `<button type="button" data-set-cover="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" class="rounded-lg border border-primary-200 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50">Set cover</button>` : ''}
                            ${state.canManage ? `<button type="button" data-item-move="up" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${itemIndex === 0 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Up</button>
                            <button type="button" data-item-move="down" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${itemIndex === items.length - 1 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Down</button>` : ''}
                            ${canDeleteItem ? `<button type="button" data-item-delete="${escapeHtml(item.id)}" class="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>` : ''}
                        </div>
                    </div>`;
            }).join('')}</div>`;

        const coverUrl = isSafeTeamMediaUrl(folder.coverPhotoUrl) ? folder.coverPhotoUrl : '';
        return `
            <article class="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <header class="flex items-center justify-between gap-3 border-b border-gray-100 p-5">
                    <div class="flex items-center gap-4">
                        ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(folder.coverPhotoTitle || folder.name || 'Album cover')}" class="h-16 w-16 rounded-xl object-cover">` : ''}
                        <div>
                            <h2 class="text-xl font-bold">${escapeHtml(folder.name || 'Untitled folder')}</h2>
                            <p class="text-sm text-gray-500">${items.length} item${items.length === 1 ? '' : 's'}</p>
                        </div>
                    </div>
                    ${folderControls}
                </header>
                <div class="p-5">${itemRows}</div>
            </article>`;
    }).join('');
}

async function loadLibrary() {
    state.folders = await getTeamMediaFolders(state.teamId);
    state.items = await getTeamMediaItems(state.teamId);
    state.selectedIds = new Set([...state.selectedIds].filter((id) => state.items.some((item) => item.id === id)));
    render();
}

async function persistAndReload(action, successMessage) {
    clearAlert();
    try {
        await action();
        await loadLibrary();
        showAlert(successMessage, 'success');
    } catch (error) {
        console.error('Team media action failed:', error);
        showAlert(error.message || 'Unable to save media changes. Refresh and try again.', 'error');
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

els.foldersList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-item-delete]');
    if (deleteButton) {
        const item = state.items.find((candidate) => candidate.id === deleteButton.dataset.itemDelete);
        if (!canDeleteTeamMediaItem(state.user, state.team, item)) return;
        if (!window.confirm('Delete this media item? This cannot be undone.')) return;
        persistAndReload(() => deleteTeamMediaItem(state.teamId, item), 'Media item deleted.');
        return;
    }

    if (!state.canManage) return;
    const folderButton = event.target.closest('[data-folder-move]');
    if (folderButton) {
        const reordered = moveInArray(state.folders, folderButton.dataset.folderId, folderButton.dataset.folderMove);
        persistAndReload(() => reorderTeamMediaFolders(state.teamId, reordered.map((folder) => folder.id)), 'Folder order saved.');
        return;
    }

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

els.foldersList.addEventListener('change', (event) => {
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
        await createTeamMediaFolder(state.teamId, els.folderName.value);
        els.folderName.value = '';
    }, 'Folder added.');
});

els.linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    persistAndReload(async () => {
        await createTeamMediaLink(state.teamId, els.linkFolder.value, {
            title: els.linkTitle.value,
            url: els.linkUrl.value
        });
        els.linkTitle.value = '';
        els.linkUrl.value = '';
    }, 'Video link added.');
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

    els.uploadProgress.innerHTML = files.map((file, index) => `
        <div data-upload-row="${index}" class="rounded-lg border border-gray-200 p-3">
            <div class="flex justify-between gap-3"><span>${escapeHtml(file.name)}</span><span data-upload-status="${index}">Waiting</span></div>
            <div class="mt-2 h-2 rounded-full bg-gray-100"><div data-upload-bar="${index}" class="h-2 rounded-full bg-primary-600" style="width:0%"></div></div>
        </div>`).join('');

    let uploadedCount = 0;
    let failedCount = 0;
    for (const [index, file] of files.entries()) {
        const status = els.uploadProgress.querySelector(`[data-upload-status="${index}"]`);
        const bar = els.uploadProgress.querySelector(`[data-upload-bar="${index}"]`);
        try {
            if (!isSupportedTeamMediaImage(file)) throw new Error('Unsupported file type. Choose an image.');
            status.textContent = 'Uploading';
            await uploadTeamMediaPhoto(state.teamId, els.photoFolder.value, file, {
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

    await loadLibrary();
    if (uploadedCount > 0) els.photoFiles.value = '';
    showAlert(`${uploadedCount} photo${uploadedCount === 1 ? '' : 's'} uploaded${failedCount ? `, ${failedCount} failed` : ''}.`, failedCount ? 'error' : 'success');
});

els.moveSelected.addEventListener('click', () => {
    const ids = [...state.selectedIds];
    persistAndReload(async () => {
        await moveTeamMediaItems(state.teamId, ids, els.moveFolder.value);
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
