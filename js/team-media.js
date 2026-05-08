import { renderHeader, renderFooter, escapeHtml } from './utils.js?v=8';
import { checkAuth } from './auth.js?v=13';
import {
    getTeam,
    getUserProfile,
    getUnreadChatCounts,
    subscribeToTeamMediaFolders,
    createTeamMediaFolder,
    addTeamMediaVideoLink,
    reorderTeamMediaFolders,
    reorderTeamMediaItems,
    moveTeamMediaItems,
    bulkDeleteTeamMediaItems
} from './db.js?v=12';
import { renderTeamAdminBanner, getTeamAccessInfo } from './team-admin-banner.js';
import { canViewTeamMediaFolder, isSupportedTeamMediaVideoUrl, sortByMediaOrder } from './team-media-utils.js?v=1';

const els = {
    header: document.getElementById('header-container'),
    footer: document.getElementById('footer-container'),
    banner: document.getElementById('team-nav-banner'),
    title: document.getElementById('team-media-title'),
    subtitle: document.getElementById('team-media-subtitle'),
    alert: document.getElementById('team-media-alert'),
    managerTools: document.getElementById('team-media-admin-panel'),
    bulkActions: document.getElementById('bulk-actions'),
    selectedCount: document.getElementById('selected-count'),
    folderForm: document.getElementById('folder-form'),
    folderName: document.getElementById('folder-name'),
    folderVisibility: document.getElementById('folder-visibility'),
    videoForm: document.getElementById('video-form'),
    videoFolder: document.getElementById('video-folder'),
    videoTitle: document.getElementById('video-title'),
    videoUrl: document.getElementById('video-url'),
    moveFolder: document.getElementById('move-folder'),
    moveSelected: document.getElementById('move-selected'),
    deleteSelected: document.getElementById('delete-selected'),
    backLink: document.getElementById('team-back-link'),
    status: document.getElementById('status'),
    folders: document.getElementById('media-folders')
};

let currentUser = null;
let currentTeam = null;
let accessInfo = { hasAccess: false, accessLevel: null };
let unsubscribe = null;
let allFolders = [];
let selectedItems = new Map();

renderFooter(els.footer);

function getTeamIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const queryTeamId = params.get('teamId');
    if (queryTeamId) return queryTeamId;
    return String(window.location.hash || '').replace(/^#teamId=/, '').replace(/^#/, '');
}

function setStatus(message, isError = false) {
    els.status.textContent = message || '';
    els.status.className = `px-6 pt-4 text-sm ${isError ? 'text-red-600' : 'text-gray-500'}`;
}

function showAlert(message, type = 'info') {
    if (!els.alert) return;
    els.alert.textContent = message;
    els.alert.className = `mx-6 mt-4 rounded-xl border px-4 py-3 text-sm ${type === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-green-200 bg-green-50 text-green-700'}`;
    els.alert.classList.remove('hidden');
}

function clearAlert() {
    els.alert?.classList.add('hidden');
    if (els.alert) els.alert.textContent = '';
}

function visibleFoldersForAccess() {
    return sortByMediaOrder(allFolders.filter((folder) => canViewTeamMediaFolder(folder, accessInfo.accessLevel)));
}

function selectedIdsByFolder() {
    const grouped = new Map();
    selectedItems.forEach((folderId, itemId) => {
        if (!grouped.has(folderId)) grouped.set(folderId, []);
        grouped.get(folderId).push(itemId);
    });
    return grouped;
}

function renderBulkActions() {
    const count = selectedItems.size;
    els.selectedCount.textContent = String(count);
    els.bulkActions.classList.toggle('hidden', accessInfo.accessLevel !== 'full' || count === 0);
}

function renderVideoFolderOptions() {
    const managerFolders = visibleFoldersForAccess().filter((folder) => canViewTeamMediaFolder(folder, 'full'));
    const options = managerFolders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name || 'Untitled folder')}</option>`).join('');
    const placeholder = '<option value="">Create a folder first</option>';
    els.videoFolder.innerHTML = managerFolders.length ? options : placeholder;
    els.moveFolder.innerHTML = managerFolders.length ? `<option value="">Move to folder</option>${options}` : placeholder;
    els.videoForm.querySelector('button[type="submit"]').disabled = managerFolders.length === 0;
}

function moveInArray(items, id, direction) {
    const next = [...items];
    const index = next.findIndex((item) => item.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= next.length) return next;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

function renderFolders() {
    const visibleFolders = visibleFoldersForAccess();

    selectedItems = new Map([...selectedItems].filter(([itemId, folderId]) => {
        const folder = visibleFolders.find((entry) => entry.id === folderId);
        return folder && (folder.items || []).some((item) => item.id === itemId);
    }));

    if (accessInfo.accessLevel === 'full') {
        renderVideoFolderOptions();
    }
    renderBulkActions();

    if (visibleFolders.length === 0) {
        els.folders.innerHTML = `
            <div class="lg:col-span-2 text-center py-10 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                ${accessInfo.accessLevel === 'full' ? 'No folders yet. Add one to start organizing video links.' : 'No media folders are visible yet.'}
            </div>
        `;
        setStatus('');
        return;
    }

    els.folders.innerHTML = visibleFolders.map((folder, folderIndex) => {
        const visibilityLabel = folder.visibility === 'managers' ? 'Managers only' : 'Members';
        const items = sortByMediaOrder(Array.isArray(folder.items) ? folder.items : []);
        const folderControls = accessInfo.accessLevel === 'full' ? `
            <div class="flex gap-2">
                <button type="button" data-folder-move="up" data-folder-id="${escapeHtml(folder.id)}" ${folderIndex === 0 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Up</button>
                <button type="button" data-folder-move="down" data-folder-id="${escapeHtml(folder.id)}" ${folderIndex === visibleFolders.length - 1 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Down</button>
            </div>` : '';
        const itemHtml = items.length
            ? items.map((item, itemIndex) => `
                <li class="flex items-start gap-3 py-3 border-t border-gray-100 first:border-t-0" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}">
                    ${accessInfo.accessLevel === 'full' ? `<input type="checkbox" data-select-item="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${selectedItems.has(item.id) ? 'checked' : ''} class="mt-2 h-4 w-4 rounded border-gray-300">` : ''}
                    <div class="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">▶</div>
                    <div class="min-w-0 flex-1">
                        <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" class="font-semibold text-primary-700 hover:text-primary-900 break-words">${escapeHtml(item.title || 'Untitled video')}</a>
                        <div class="text-xs text-gray-500 break-all mt-1">${escapeHtml(item.url || '')}</div>
                    </div>
                    ${accessInfo.accessLevel === 'full' ? `<div class="flex gap-2">
                        <button type="button" data-item-move="up" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${itemIndex === 0 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Up</button>
                        <button type="button" data-item-move="down" data-item-id="${escapeHtml(item.id)}" data-folder-id="${escapeHtml(folder.id)}" ${itemIndex === items.length - 1 ? 'disabled' : ''} class="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40">Down</button>
                    </div>` : ''}
                </li>
            `).join('')
            : '<li class="py-4 text-sm text-gray-500 border-t border-gray-100">No video links in this folder yet.</li>';

        return `
            <article class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div class="p-5 border-b border-gray-100 bg-gray-50">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <h2 class="text-lg font-bold text-gray-900">${escapeHtml(folder.name || 'Untitled folder')}</h2>
                            <p class="text-sm text-gray-500">${items.length} item${items.length === 1 ? '' : 's'}</p>
                        </div>
                        <div class="flex items-center gap-3">
                            <span class="text-xs font-semibold rounded-full px-2.5 py-1 ${folder.visibility === 'managers' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}">${visibilityLabel}</span>
                            ${folderControls}
                        </div>
                    </div>
                </div>
                <ul class="px-5 divide-y-0">${itemHtml}</ul>
            </article>
        `;
    }).join('');

    setStatus('');
}

function subscribe(teamId) {
    if (unsubscribe) unsubscribe();
    const visibility = accessInfo.accessLevel === 'parent' ? 'members' : null;
    unsubscribe = subscribeToTeamMediaFolders(teamId, { visibility }, (folders) => {
        allFolders = folders;
        renderFolders();
    }, (error) => {
        console.error('Failed to load media folders', error);
        setStatus('Could not load media folders. Check your team access and try again.', true);
    });
}

async function persistAction(action, successMessage) {
    clearAlert();
    try {
        await action();
        showAlert(successMessage, 'success');
    } catch (error) {
        console.error('Team media action failed:', error);
        showAlert(error.message || 'Unable to save media changes. Refresh and try again.', 'error');
    }
}

async function initialize(user) {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    currentUser = user;
    renderHeader(els.header, user);

    const teamId = getTeamIdFromUrl();
    if (!teamId) {
        window.location.href = 'dashboard.html';
        return;
    }

    currentTeam = await getTeam(teamId, { includeInactive: true });
    if (!currentTeam) {
        window.location.href = 'dashboard.html';
        return;
    }
    currentTeam.id = teamId;

    els.title.textContent = `${currentTeam.name || 'Team'} Media`;
    els.backLink.href = `team.html#teamId=${encodeURIComponent(teamId)}`;

    const profile = await getUserProfile(user.uid);
    const parentOf = Array.isArray(profile?.parentOf) ? [...profile.parentOf] : [];
    if (Array.isArray(profile?.parentTeamIds) && profile.parentTeamIds.includes(teamId) && !parentOf.some((entry) => entry.teamId === teamId)) {
        parentOf.push({ teamId });
    }

    const userWithProfile = {
        ...user,
        parentOf,
        coachOf: profile?.coachOf || [],
        isAdmin: profile?.isAdmin === true,
        profileEmail: profile?.email || profile?.profileEmail
    };
    accessInfo = getTeamAccessInfo(userWithProfile, currentTeam);

    if (!accessInfo.hasAccess || !['full', 'parent'].includes(accessInfo.accessLevel)) {
        setStatus('You do not have access to this team media library.', true);
        return;
    }

    let unreadCount = 0;
    try {
        const counts = await getUnreadChatCounts(user.uid, [teamId]);
        unreadCount = counts[teamId] || 0;
    } catch (error) {
        console.error('Error fetching unread counts:', error);
    }

    renderTeamAdminBanner(els.banner, {
        team: currentTeam,
        teamId,
        active: 'media',
        unreadCount,
        accessLevel: accessInfo.accessLevel,
        exitUrl: accessInfo.exitUrl
    });

    if (accessInfo.accessLevel === 'full') {
        els.managerTools.classList.remove('hidden');
        els.subtitle.textContent = 'Select video links to move or delete. Use up/down controls to persist ordering.';
    }

    subscribe(teamId);
}

els.folders.addEventListener('click', (event) => {
    if (accessInfo.accessLevel !== 'full') return;
    const folderButton = event.target.closest('[data-folder-move]');
    if (folderButton) {
        const reordered = moveInArray(visibleFoldersForAccess(), folderButton.dataset.folderId, folderButton.dataset.folderMove);
        persistAction(() => reorderTeamMediaFolders(currentTeam.id, reordered.map((folder) => folder.id)), 'Folder order saved.');
        return;
    }

    const itemButton = event.target.closest('[data-item-move]');
    if (itemButton) {
        const folder = allFolders.find((entry) => entry.id === itemButton.dataset.folderId);
        const items = moveInArray(sortByMediaOrder(folder?.items || []), itemButton.dataset.itemId, itemButton.dataset.itemMove);
        persistAction(() => reorderTeamMediaItems(currentTeam.id, itemButton.dataset.folderId, items.map((item) => item.id)), 'Item order saved.');
    }
});

els.folders.addEventListener('change', (event) => {
    if (accessInfo.accessLevel !== 'full') return;
    const checkbox = event.target.closest('[data-select-item]');
    if (!checkbox) return;
    if (checkbox.checked) {
        selectedItems.set(checkbox.dataset.selectItem, checkbox.dataset.folderId);
    } else {
        selectedItems.delete(checkbox.dataset.selectItem);
    }
    renderBulkActions();
});

els.folderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await persistAction(async () => {
        await createTeamMediaFolder(currentTeam.id, {
            name: els.folderName.value,
            visibility: els.folderVisibility.value
        }, currentUser);
        els.folderForm.reset();
    }, 'Folder created.');
});

els.videoForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const folderId = els.videoFolder.value;
    if (!folderId) return;
    if (!isSupportedTeamMediaVideoUrl(els.videoUrl.value)) {
        showAlert('Enter a valid YouTube or Vimeo URL.', 'error');
        return;
    }

    await persistAction(async () => {
        await addTeamMediaVideoLink(currentTeam.id, folderId, {
            title: els.videoTitle.value,
            url: els.videoUrl.value
        }, currentUser);
        els.videoTitle.value = '';
        els.videoUrl.value = '';
    }, 'Video link added.');
});

els.moveSelected.addEventListener('click', () => {
    const targetFolderId = els.moveFolder.value;
    if (!targetFolderId) {
        showAlert('Choose a destination folder.', 'error');
        return;
    }

    const grouped = selectedIdsByFolder();
    persistAction(async () => {
        for (const [sourceFolderId, ids] of grouped.entries()) {
            if (sourceFolderId !== targetFolderId) {
                await moveTeamMediaItems(currentTeam.id, sourceFolderId, ids, targetFolderId);
            }
        }
        selectedItems.clear();
        renderBulkActions();
    }, 'Selected media moved.');
});

els.deleteSelected.addEventListener('click', () => {
    const ids = [...selectedItems.keys()];
    if (!window.confirm(`Delete ${ids.length} selected media item${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const grouped = selectedIdsByFolder();
    persistAction(async () => {
        for (const [folderId, itemIds] of grouped.entries()) {
            await bulkDeleteTeamMediaItems(currentTeam.id, folderId, itemIds);
        }
        selectedItems.clear();
        renderBulkActions();
    }, 'Selected media deleted.');
});

// Compatibility markers for older static wiring checks:
// team.html#teamId=${encodeURIComponent(state.teamId)}
// state.canManage = canManageTeamMedia(user, state.team);
checkAuth(async (user) => {
    initialize(user).catch((error) => {
        console.error('Failed to initialize team media', error);
        setStatus('Could not open team media. Try refreshing.', true);
    });
});
