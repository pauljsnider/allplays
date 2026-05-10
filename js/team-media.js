import { checkAuth } from './auth.js?v=13';
import {
    getTeam,
    getTeamMediaFolders,
    getTeamMediaItems,
    createTeamMediaFolder,
    createTeamMediaLink,
    reorderTeamMediaFolders,
    reorderTeamMediaItems,
    moveTeamMediaItems,
    bulkDeleteTeamMediaItems
} from './db.js?v=12';
import { canManageTeamMedia, isSafeTeamMediaUrl, sortByMediaOrder } from './team-media-utils.js?v=1';

const state = {
    teamId: '',
    team: null,
    user: null,
    canManage: false,
    folders: [],
    items: [],
    selectedIds: new Set()
};

const els = {
    title: document.getElementById('team-media-title'),
    subtitle: document.getElementById('team-media-subtitle'),
    alert: document.getElementById('team-media-alert'),
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
        .filter((item) => isSafeTeamMediaUrl(item.url)));
}

function renderFolderOptions() {
    const options = state.folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name || 'Untitled folder')}</option>`).join('');
    const placeholder = '<option value="">Choose folder</option>';
    els.linkFolder.innerHTML = placeholder + options;
    els.moveFolder.innerHTML = placeholder + options;
}

function renderBulkActions() {
    const count = state.selectedIds.size;
    els.selectedCount.textContent = String(count);
    els.bulkActions.classList.toggle('hidden', !state.canManage || count === 0);
}

function render() {
    els.title.textContent = state.team?.name ? `${state.team.name} Media` : 'Media Library';
    els.subtitle.textContent = state.canManage
        ? 'Select video links to move or delete. Use up/down controls to persist ordering.'
        : 'Organized video links and highlights for this team.';
    els.adminPanel.classList.toggle('hidden', !state.canManage);
    els.backLink.href = state.teamId ? `team.html#teamId=${encodeURIComponent(state.teamId)}` : 'team.html';
    renderFolderOptions();
    renderBulkActions();

    if (state.folders.length === 0) {
        els.foldersList.innerHTML = `<div class="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">${state.canManage ? 'No folders yet. Add one to start organizing video links.' : 'No media folders have been shared yet.'}</div>`;
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
            ? '<div class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">No video links in this folder.</div>'
            : items.map((item, itemIndex) => `
                <div class="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between" data-item-id="${escapeHtml(item.id)}">
                    <div class="flex items-start gap-3">
                        ${state.canManage ? `<input type="checkbox" data-select-item="${escapeHtml(item.id)}" ${state.selectedIds.has(item.id) ? 'checked' : ''} class="mt-1 h-4 w-4 rounded border-gray-300">` : ''}
                        <div>
                            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-primary-700 hover:text-primary-900">${escapeHtml(item.title || 'Untitled video')}</a>
                            <div class="break-all text-xs text-gray-500">${escapeHtml(item.url)}</div>
                        </div>
                    </div>
                    ${state.canManage ? `<div class="flex gap-2">
                        <button type="button" data-item-move="up" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${itemIndex === 0 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Up</button>
                        <button type="button" data-item-move="down" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${itemIndex === items.length - 1 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Down</button>
                    </div>` : ''}
                </div>
            `).join('');

        return `
            <article class="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <header class="flex items-center justify-between gap-3 border-b border-gray-100 p-5">
                    <div>
                        <h2 class="text-xl font-bold">${escapeHtml(folder.name || 'Untitled folder')}</h2>
                        <p class="text-sm text-gray-500">${items.length} item${items.length === 1 ? '' : 's'}</p>
                    </div>
                    ${folderControls}
                </header>
                <div class="space-y-3 p-5">${itemRows}</div>
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
    if (!state.canManage) return;
    const folderButton = event.target.closest('[data-folder-move]');
    if (folderButton) {
        const reordered = moveInArray(state.folders, folderButton.dataset.folderId, folderButton.dataset.folderMove);
        persistAndReload(() => reorderTeamMediaFolders(state.teamId, reordered.map((folder) => folder.id)), 'Folder order saved.');
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
        state.canManage = canManageTeamMedia(user, state.team);
        await loadLibrary();
    } catch (error) {
        console.error('Unable to load team media:', error);
        els.foldersList.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Unable to load team media.</div>';
    }
});
