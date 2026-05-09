import { checkAuth } from './auth.js?v=13';
import { getTeam, getUserProfile, getUnreadChatCounts } from './db.js?v=30';
import { db, collection, getDocs, query, orderBy } from './firebase.js?v=11';
import { renderTeamAdminBanner, getTeamAccessInfo } from './team-admin-banner.js?v=3';
import { renderHeader, renderFooter, escapeHtml } from './utils.js?v=8';

function getTeamIdFromUrl() {
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
    const searchParams = new URLSearchParams(window.location.search);
    return hashParams.get('teamId') || searchParams.get('teamId');
}

async function getTeamMediaFolders(teamId) {
    const foldersRef = collection(db, 'teams', teamId, 'mediaFolders');
    const snapshot = await getDocs(query(foldersRef, orderBy('createdAt', 'asc')));
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

function getFolderItemCount(folder) {
    if (Array.isArray(folder?.items)) return folder.items.length;
    if (Array.isArray(folder?.videos)) return folder.videos.length;
    if (Array.isArray(folder?.mediaLinks)) return folder.mediaLinks.length;
    return Number(folder?.itemCount || folder?.videoCount || 0);
}

function renderEmptyState(accessLevel) {
    const canManageLater = accessLevel === 'full';
    const title = canManageLater ? 'No media folders yet' : 'No team media yet';
    const body = canManageLater
        ? 'This is where coaches and admins will organize team videos, highlight links, and shared folders. Folder and video management will be added in a later workflow.'
        : 'Coaches have not shared team media folders yet. When they do, you will be able to browse them here.';
    const footnote = canManageLater
        ? 'For now, use this page as the read-only team media entry point.'
        : 'This page is read-only for parents and team followers.';

    return `
        <div class="text-center py-14 px-4">
            <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
                <svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"></path>
                </svg>
            </div>
            <h2 class="text-xl font-bold text-gray-900">${title}</h2>
            <p class="mx-auto mt-2 max-w-xl text-gray-600">${body}</p>
            <p class="mt-4 text-sm font-medium text-gray-500">${footnote}</p>
        </div>
    `;
}

function renderFolderCard(folder) {
    const name = folder?.name || folder?.title || 'Untitled folder';
    const description = folder?.description || 'Team media folder';
    const itemCount = getFolderItemCount(folder);
    const visibility = folder?.visibility ? String(folder.visibility) : 'Team access';

    return `
        <article class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:border-primary-200 transition">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <h2 class="truncate text-lg font-bold text-gray-900">${escapeHtml(name)}</h2>
                    <p class="mt-1 text-sm text-gray-600">${escapeHtml(description)}</p>
                </div>
                <div class="rounded-lg bg-primary-50 p-2 text-primary-600">
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"></path>
                    </svg>
                </div>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500">
                <span class="rounded-full bg-gray-100 px-2.5 py-1">${itemCount} ${itemCount === 1 ? 'item' : 'items'}</span>
                <span class="rounded-full bg-gray-100 px-2.5 py-1">${escapeHtml(visibility)}</span>
            </div>
        </article>
    `;
}

function renderFolders(folders) {
    return `
        <div class="mb-5 flex items-center justify-between gap-3">
            <div>
                <h2 class="text-xl font-bold text-gray-900">Folders</h2>
                <p class="text-sm text-gray-500">Read-only view of team-scoped media folders.</p>
            </div>
            <span class="rounded-full bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-700">${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${folders.map(renderFolderCard).join('')}
        </div>
    `;
}

function showError(message) {
    const content = document.getElementById('media-page-content');
    if (!content) return;
    content.innerHTML = `
        <div class="text-center py-12">
            <p class="text-red-600 font-semibold">${escapeHtml(message)}</p>
            <button onclick="location.reload()" class="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">Retry</button>
        </div>
    `;
}

renderFooter(document.getElementById('footer-container'));

checkAuth(async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    renderHeader(document.getElementById('header-container'), user);

    const teamId = getTeamIdFromUrl();
    if (!teamId) {
        alert('No team specified');
        window.location.href = 'dashboard.html';
        return;
    }

    try {
        const team = await getTeam(teamId);
        if (!team) {
            alert('Team not found');
            window.location.href = 'dashboard.html';
            return;
        }

        const profile = await getUserProfile(user.uid);
        const userWithProfile = {
            ...user,
            parentOf: profile?.parentOf || [],
            coachOf: profile?.coachOf || [],
            isAdmin: profile?.isAdmin || false,
            profileEmail: profile?.email || profile?.profileEmail
        };
        const teamWithId = { ...team, id: teamId };
        const accessInfo = getTeamAccessInfo(userWithProfile, teamWithId);

        if (!accessInfo.hasAccess || !['full', 'parent'].includes(accessInfo.accessLevel)) {
            alert('You do not have access to this team media');
            window.location.href = accessInfo.exitUrl || 'dashboard.html';
            return;
        }

        let unreadCount = 0;
        try {
            const counts = await getUnreadChatCounts(user.uid, [teamId]);
            unreadCount = counts[teamId] || 0;
        } catch (error) {
            console.error('Error fetching unread counts:', error);
        }

        renderTeamAdminBanner(document.getElementById('team-banner'), {
            team,
            teamId,
            active: 'media',
            unreadCount,
            accessLevel: accessInfo.accessLevel,
            exitUrl: accessInfo.exitUrl
        });

        const badge = document.getElementById('media-role-badge');
        if (badge) {
            badge.textContent = accessInfo.accessLevel === 'full' ? 'Coach/Admin view' : 'Read-only view';
        }

        const subtitle = document.getElementById('media-page-subtitle');
        if (subtitle) {
            subtitle.textContent = accessInfo.accessLevel === 'full'
                ? 'Review the team media library entry point before folder management is added.'
                : 'Browse media folders shared by coaches and admins.';
        }

        const folders = await getTeamMediaFolders(teamId);
        const content = document.getElementById('media-page-content');
        content.innerHTML = folders.length > 0
            ? renderFolders(folders)
            : renderEmptyState(accessInfo.accessLevel);
    } catch (error) {
        console.error('Error loading team media:', error);
        showError('Failed to load team media. Please try again.');
    }
});
