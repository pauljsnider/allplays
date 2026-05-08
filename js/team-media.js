import { renderHeader, renderFooter, escapeHtml } from './utils.js?v=8';
import { checkAuth } from './auth.js?v=13';
import {
    getTeam,
    getUserProfile,
    getUnreadChatCounts,
    subscribeToTeamMediaFolders,
    createTeamMediaFolder,
    addTeamMediaVideoLink
} from './db.js?v=31';
import { renderTeamAdminBanner, getTeamAccessInfo } from './team-admin-banner.js';
import { canViewTeamMediaFolder, isSupportedTeamMediaVideoUrl } from './team-media-utils.js?v=1';

const els = {
    header: document.getElementById('header-container'),
    footer: document.getElementById('footer-container'),
    banner: document.getElementById('team-nav-banner'),
    managerTools: document.getElementById('manager-tools'),
    folderForm: document.getElementById('folder-form'),
    folderName: document.getElementById('folder-name'),
    folderVisibility: document.getElementById('folder-visibility'),
    videoForm: document.getElementById('video-form'),
    videoFolder: document.getElementById('video-folder'),
    videoTitle: document.getElementById('video-title'),
    videoUrl: document.getElementById('video-url'),
    status: document.getElementById('status'),
    folders: document.getElementById('media-folders')
};

let currentUser = null;
let currentTeam = null;
let accessInfo = { hasAccess: false, accessLevel: null };
let unsubscribe = null;
let allFolders = [];

renderFooter(els.footer);

function getTeamIdFromUrl() {
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
    const searchParams = new URLSearchParams(window.location.search);
    return hashParams.get('teamId') || searchParams.get('teamId');
}

function setStatus(message, isError = false) {
    els.status.textContent = message || '';
    els.status.className = `px-6 pt-4 text-sm ${isError ? 'text-red-600' : 'text-gray-500'}`;
}

function renderVideoFolderOptions() {
    const managerFolders = allFolders.filter((folder) => canViewTeamMediaFolder(folder, 'full'));
    els.videoFolder.innerHTML = managerFolders.length
        ? managerFolders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name || 'Untitled folder')}</option>`).join('')
        : '<option value="">Create a folder first</option>';
    els.videoForm.querySelector('button[type="submit"]').disabled = managerFolders.length === 0;
}

function renderFolders() {
    const visibleFolders = allFolders.filter((folder) => canViewTeamMediaFolder(folder, accessInfo.accessLevel));

    if (accessInfo.accessLevel === 'full') {
        renderVideoFolderOptions();
    }

    if (visibleFolders.length === 0) {
        els.folders.innerHTML = `
            <div class="lg:col-span-2 text-center py-10 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                No media folders are visible yet.
            </div>
        `;
        setStatus('');
        return;
    }

    els.folders.innerHTML = visibleFolders.map((folder) => {
        const visibilityLabel = folder.visibility === 'managers' ? 'Managers only' : 'Members';
        const items = Array.isArray(folder.items) ? folder.items : [];
        const itemHtml = items.length
            ? items.map((item) => `
                <li class="flex items-start gap-3 py-3 border-t border-gray-100 first:border-t-0">
                    <div class="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">▶</div>
                    <div class="min-w-0 flex-1">
                        <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" class="font-semibold text-primary-700 hover:text-primary-900 break-words">${escapeHtml(item.title || 'Untitled video')}</a>
                        <div class="text-xs text-gray-500 break-all mt-1">${escapeHtml(item.url || '')}</div>
                    </div>
                </li>
            `).join('')
            : '<li class="py-4 text-sm text-gray-500 border-t border-gray-100">No video links in this folder yet.</li>';

        return `
            <article class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div class="p-5 border-b border-gray-100 bg-gray-50">
                    <div class="flex items-start justify-between gap-3">
                        <h2 class="text-lg font-bold text-gray-900">${escapeHtml(folder.name || 'Untitled folder')}</h2>
                        <span class="text-xs font-semibold rounded-full px-2.5 py-1 ${folder.visibility === 'managers' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}">${visibilityLabel}</span>
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

    currentTeam = await getTeam(teamId);
    if (!currentTeam) {
        window.location.href = 'dashboard.html';
        return;
    }
    currentTeam.id = teamId;

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
    }

    subscribe(teamId);
}

els.folderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        await createTeamMediaFolder(currentTeam.id, {
            name: els.folderName.value,
            visibility: els.folderVisibility.value
        }, currentUser);
        els.folderForm.reset();
        setStatus('Folder created.');
    } catch (error) {
        setStatus(error.message || 'Could not create folder.', true);
    }
});

els.videoForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const folderId = els.videoFolder.value;
    if (!folderId) return;
    if (!isSupportedTeamMediaVideoUrl(els.videoUrl.value)) {
        setStatus('Enter a valid YouTube or Vimeo URL.', true);
        return;
    }

    try {
        await addTeamMediaVideoLink(currentTeam.id, folderId, {
            title: els.videoTitle.value,
            url: els.videoUrl.value
        }, currentUser);
        els.videoTitle.value = '';
        els.videoUrl.value = '';
        setStatus('Video link added.');
    } catch (error) {
        setStatus(error.message || 'Could not add video link.', true);
    }
});

checkAuth((user) => {
    initialize(user).catch((error) => {
        console.error('Failed to initialize team media', error);
        setStatus('Could not open team media. Try refreshing.', true);
    });
});
