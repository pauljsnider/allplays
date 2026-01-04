import { escapeHtml } from './utils.js?v=8';

/**
 * Determine user's access level for a team
 * @param {Object} user - Firebase user object with enriched profile (coachOf, parentOf, isAdmin)
 * @param {Object} team - Team object with ownerId, adminEmails
 * @returns {{ hasAccess: boolean, accessLevel: 'full'|'parent'|null, exitUrl: string }}
 */
export function getTeamAccessInfo(user, team) {
  if (!user || !team) {
    return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
  }

  // Check for full access: owner, admin, coach, or platform admin
  const isOwner = team.ownerId === user.uid;
  const isTeamAdmin = (team.adminEmails || []).includes(user.email);
  const isPlatformAdmin = user.isAdmin === true;
  const isCoach = (user.coachOf || []).includes(team.id);

  if (isOwner || isTeamAdmin || isPlatformAdmin || isCoach) {
    return { hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' };
  }

  // Check for parent access
  const isParent = (user.parentOf || []).some(p => p.teamId === team.id);
  if (isParent) {
    return { hasAccess: true, accessLevel: 'parent', exitUrl: 'parent-dashboard.html' };
  }

  return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
}

function icon(name) {
  if (name === 'view') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
    </svg>`;
  }
  if (name === 'edit') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
    </svg>`;
  }
  if (name === 'roster') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
    </svg>`;
  }
  if (name === 'schedule') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>`;
  }
  if (name === 'gameplan') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
    </svg>`;
  }
  if (name === 'stats') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
    </svg>`;
  }
  if (name === 'chat') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
    </svg>`;
  }
  if (name === 'exit') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v8a2 2 0 002 2h4"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H9"></path>
    </svg>`;
  }
  return '';
}

function actionCard({ href, label, iconName, active, unreadCount = 0 }) {
  const hasUnread = iconName === 'chat' && unreadCount > 0;
  const base =
    'relative flex flex-col items-center justify-center p-3 rounded-lg border transition group/btn';
  const activeCls = active
    ? 'border-primary-300 bg-primary-50'
    : hasUnread
      ? 'border-primary-400 bg-primary-50'
      : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50';
  const iconCls = active || hasUnread
    ? 'text-primary-600'
    : 'text-gray-600 group-hover/btn:text-primary-600';
  const textCls = active || hasUnread
    ? 'text-primary-700'
    : 'text-gray-600 group-hover/btn:text-primary-700';

  const badge = hasUnread
    ? `<span class="absolute -top-1 -right-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">${unreadCount > 99 ? '99+' : unreadCount}</span>`
    : '';

  return `
    <a href="${href}" class="${base} ${activeCls}">
      ${badge}
      <div class="${iconCls}">${icon(iconName)}</div>
      <span class="text-xs font-medium ${textCls} mt-1">${escapeHtml(label)}</span>
    </a>
  `;
}

/**
 * Render team navigation banner
 * @param {HTMLElement} container - Container element to render into
 * @param {Object} options
 * @param {Object} options.team - Team object with name, sport, photoUrl
 * @param {string} options.teamId - Team ID
 * @param {string} options.active - Active nav item: 'view', 'edit', 'roster', 'schedule', 'gameplan', 'stats', 'chat'
 * @param {number} options.unreadCount - Unread chat message count
 * @param {string} options.accessLevel - 'full' for coach/admin, 'parent' for parent-only access
 * @param {string} options.exitUrl - URL for exit button (default: 'dashboard.html')
 */
export function renderTeamAdminBanner(container, { team, teamId, active = '', unreadCount = 0, accessLevel = 'full', exitUrl = 'dashboard.html' } = {}) {
  if (!container) return;
  if (!teamId) {
    container.innerHTML = '';
    return;
  }

  const name = team?.name || 'Team';
  const sport = team?.sport || '';
  const photoUrl = team?.photoUrl || '';
  const isFullAccess = accessLevel === 'full';

  const hrefs = {
    view: `team.html#teamId=${teamId}`,
    edit: `edit-team.html#teamId=${teamId}`,
    roster: `edit-roster.html#teamId=${teamId}`,
    schedule: `edit-schedule.html#teamId=${teamId}`,
    gameplan: `game-plan.html#teamId=${teamId}`,
    stats: `edit-config.html#teamId=${teamId}`,
    chat: `team-chat.html#teamId=${teamId}`,
    exit: exitUrl
  };

  // Build nav cards based on access level
  let navCards = '';
  if (isFullAccess) {
    // Coach/Admin: View, Edit, Roster, Schedule, Game Plan, Stats, Chat
    navCards = `
      ${actionCard({ href: hrefs.view, label: 'View', iconName: 'view', active: active === 'view' })}
      ${actionCard({ href: hrefs.edit, label: 'Edit', iconName: 'edit', active: active === 'edit' })}
      ${actionCard({ href: hrefs.roster, label: 'Roster', iconName: 'roster', active: active === 'roster' })}
      ${actionCard({ href: hrefs.schedule, label: 'Schedule', iconName: 'schedule', active: active === 'schedule' })}
      ${actionCard({ href: hrefs.gameplan, label: 'Game Plan', iconName: 'gameplan', active: active === 'gameplan' })}
      ${actionCard({ href: hrefs.stats, label: 'Stats', iconName: 'stats', active: active === 'stats' })}
      ${actionCard({ href: hrefs.chat, label: 'Chat', iconName: 'chat', active: active === 'chat', unreadCount })}
    `;
  } else {
    // Parent: View, Chat only
    navCards = `
      ${actionCard({ href: hrefs.view, label: 'View', iconName: 'view', active: active === 'view' })}
      ${actionCard({ href: hrefs.chat, label: 'Chat', iconName: 'chat', active: active === 'chat', unreadCount })}
    `;
  }

  // Determine grid columns based on number of items
  const gridCols = isFullAccess
    ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'
    : 'grid-cols-2';

  container.innerHTML = `
    <div class="group bg-white rounded-2xl shadow-md border border-gray-200 overflow-hidden">
      <div class="p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        <div class="flex items-center gap-4">
          ${photoUrl
            ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" class="w-16 h-16 rounded-xl object-cover border-2 border-gray-200 group-hover:border-primary-300 transition shadow-sm">`
            : `<div class="w-16 h-16 rounded-xl bg-gradient-to-br from-primary-100 to-primary-200 flex items-center justify-center border-2 border-gray-200 group-hover:border-primary-300 transition shadow-sm">
                <span class="text-2xl font-bold text-primary-600">${escapeHtml(name.charAt(0))}</span>
              </div>`
          }
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider">${escapeHtml(name)}</div>
            <div class="text-xl font-bold text-gray-900 truncate">${sport ? escapeHtml(sport) : 'Team'}</div>
          </div>
          <a href="${hrefs.exit}" class="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-primary-700 transition">
            <span class="hidden sm:inline">Exit</span>
            <span class="text-gray-500">${icon('exit')}</span>
          </a>
        </div>
      </div>

      <div class="p-5">
        <div class="grid ${gridCols} gap-2">
          ${navCards}
        </div>
      </div>
    </div>
  `;
}

