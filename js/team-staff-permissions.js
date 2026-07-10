import { escapeHtml } from './utils.js?v=15';
import { normalizeTeamPermissions } from './team-access.js';

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function uniqueEmails(values) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map(normalizeEmail)
            .filter(Boolean)
    ));
}

function getUniqueLabels(values) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
}

function getPermissionGrantLabels(permission) {
    const normalized = permission || {};
    if (normalized.mode !== 'selected') return [];
    return getUniqueLabels(normalized.memberIds);
}

function getStreamScoreGrantLabels(permissions) {
    const scorekeeperGrants = new Set(getPermissionGrantLabels(permissions.scorekeeping));
    return getPermissionGrantLabels(permissions.streaming).filter((memberId) => scorekeeperGrants.has(memberId));
}

export function buildTeamStaffPermissionsViewModel(team = {}, pendingAdminInvites = []) {
    const adminEmails = uniqueEmails(team.adminEmails);
    const ownerLabel = normalizeEmail(team.ownerEmail) || String(team.ownerId || '').trim();
    const staff = [];
    if (ownerLabel) {
        staff.push({ label: ownerLabel, role: 'Owner' });
    }
    adminEmails.forEach((email) => staff.push({ label: email, role: 'Admin' }));

    const pendingInvites = (Array.isArray(pendingAdminInvites) ? pendingAdminInvites : [])
        .filter((invite) => invite && invite.used !== true)
        .map((invite) => normalizeEmail(invite.email))
        .filter(Boolean);

    const uniquePendingInvites = Array.from(new Set(pendingInvites));
    const permissions = normalizeTeamPermissions(team.teamPermissions || {});
    const legacyVideoGrants = getUniqueLabels([
        ...(Array.isArray(team.streamVolunteerEmails) ? team.streamVolunteerEmails : []),
        ...(Array.isArray(team.mediaContributorEmails) ? team.mediaContributorEmails : []),
        ...(Array.isArray(team.mediaContributorUids) ? team.mediaContributorUids : [])
    ]);
    const volunteerGrants = getUniqueLabels(team.teamPermissions?.volunteer?.memberIds || team.teamPermissions?.volunteering?.memberIds || []);

    return {
        staff,
        pendingInvites: uniquePendingInvites,
        helperPermissions: [
            {
                key: 'scorekeeper',
                title: 'Scorekeeper',
                grants: getPermissionGrantLabels(permissions.scorekeeping),
                emptyText: 'No scorekeeper helpers are assigned yet.'
            },
            {
                key: 'stream-score',
                title: 'Stream & Score',
                grants: getStreamScoreGrantLabels(permissions),
                emptyText: 'No Stream & Score volunteers are assigned yet.'
            },
            {
                key: 'videographer',
                title: 'Videographer',
                grants: getUniqueLabels([...getPermissionGrantLabels(permissions.videography), ...legacyVideoGrants]),
                emptyText: 'No videographer helpers are assigned yet.'
            },
            {
                key: 'volunteer',
                title: 'Volunteer',
                grants: volunteerGrants,
                emptyText: 'No general volunteer permissions are assigned yet.'
            }
        ],
        hasAnyStaff: staff.length > 0 || uniquePendingInvites.length > 0
    };
}

function renderPillList(items, emptyText, toneClasses = 'bg-white border-gray-200 text-gray-700') {
    if (!items.length) {
        return `<div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-500 italic">${escapeHtml(emptyText)}</div>`;
    }

    return `<div class="flex flex-wrap gap-2">${items.map((item) => `
        <span class="inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${toneClasses}">${escapeHtml(item)}</span>
    `).join('')}</div>`;
}

export function renderTeamStaffPermissionsSection(container, { team = {}, pendingAdminInvites = [], canManage = false } = {}) {
    if (!container) return;
    if (!canManage) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    const viewModel = buildTeamStaffPermissionsViewModel(team, pendingAdminInvites);
    const staffItems = viewModel.staff.map((member) => `${member.label} · ${member.role}`);
    const pendingItems = viewModel.pendingInvites.map((email) => `${email} · Pending admin invite`);

    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="bg-white rounded-2xl shadow-md border border-gray-200 p-6 md:p-8">
            <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                <div>
                    <h2 class="text-2xl font-bold text-gray-900">Team Staff &amp; Permissions</h2>
                    <p class="text-sm text-gray-500 mt-1">Full staff admin access is separate from scoped game-day helper permissions for scorekeeping, Stream &amp; Score, video, and volunteers.</p>
                </div>
                <a href="edit-team.html#teamId=${encodeURIComponent(team.id || '')}" class="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 transition">Manage staff</a>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                <div class="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                    <h3 class="text-sm font-bold text-indigo-900 uppercase tracking-wide mb-3">Staff</h3>
                    ${renderPillList([...staffItems, ...pendingItems], 'No owner, admin staff, or pending admin invites found.', 'bg-white border-indigo-200 text-indigo-800')}
                </div>
                <div class="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                    <h3 class="text-sm font-bold text-emerald-900 uppercase tracking-wide mb-2">Admin vs game-day helpers</h3>
                    <p class="text-sm text-emerald-800">Admins can manage the team. Scoped helpers are intended for specific game-day jobs. Stream &amp; Score grants only scorekeeping plus streaming capability, not roster, schedule, RSVP, scoring setup, or full team settings access.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                ${viewModel.helperPermissions.map((permission) => `
                    <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <h3 class="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">${escapeHtml(permission.title)}</h3>
                        ${renderPillList(permission.grants, permission.emptyText)}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}
