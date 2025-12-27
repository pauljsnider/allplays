import { escapeHtml } from './utils.js?v=8';

function icon(name) {
  if (name === 'team') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 1.657-1.567 3-3.5 3S5 12.657 5 11s1.567-3 3.5-3S12 9.343 12 11z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11c0 1.657-1.567 3-3.5 3S12 12.657 12 11s1.567-3 3.5-3S19 9.343 19 11z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 20v-1a5 5 0 015-5h0"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20v-1a5 5 0 00-5-5h0"></path>
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
  if (name === 'stats') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
    </svg>`;
  }
  if (name === 'public') {
    return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
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

function actionCard({ href, label, iconName, active }) {
  const base =
    'flex flex-col items-center justify-center p-3 rounded-lg border transition group/btn';
  const activeCls = active
    ? 'border-primary-300 bg-primary-50'
    : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50';
  const iconCls = active
    ? 'text-primary-600'
    : 'text-gray-600 group-hover/btn:text-primary-600';
  const textCls = active
    ? 'text-primary-700'
    : 'text-gray-600 group-hover/btn:text-primary-700';

  return `
    <a href="${href}" class="${base} ${activeCls}">
      <div class="${iconCls}">${icon(iconName)}</div>
      <span class="text-xs font-medium ${textCls} mt-1">${escapeHtml(label)}</span>
    </a>
  `;
}

export function renderTeamAdminBanner(container, { team, teamId, active = '' } = {}) {
  if (!container) return;
  if (!teamId) {
    container.innerHTML = '';
    return;
  }

  const name = team?.name || 'Team';
  const sport = team?.sport || '';
  const photoUrl = team?.photoUrl || '';

  const hrefs = {
    public: `team.html#teamId=${teamId}`,
    team: `edit-team.html#teamId=${teamId}`,
    roster: `edit-roster.html#teamId=${teamId}`,
    schedule: `edit-schedule.html#teamId=${teamId}`,
    stats: `edit-config.html#teamId=${teamId}`,
    exit: 'dashboard.html'
  };

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
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Manage</div>
            <div class="text-xl font-bold text-gray-900 truncate">${escapeHtml(name)}</div>
            ${sport ? `<div class="text-xs text-gray-500 mt-0.5">${escapeHtml(sport)}</div>` : ''}
          </div>
          <a href="${hrefs.exit}" class="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-primary-700 transition">
            <span class="hidden sm:inline">Exit</span>
            <span class="text-gray-500">${icon('exit')}</span>
          </a>
        </div>
      </div>

      <div class="p-5">
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          ${actionCard({ href: hrefs.public, label: 'Public', iconName: 'public', active: active === 'public' })}
          ${actionCard({ href: hrefs.team, label: 'Team', iconName: 'team', active: active === 'team' })}
          ${actionCard({ href: hrefs.roster, label: 'Roster', iconName: 'roster', active: active === 'roster' })}
          ${actionCard({ href: hrefs.schedule, label: 'Schedule', iconName: 'schedule', active: active === 'schedule' })}
          ${actionCard({ href: hrefs.stats, label: 'Stats', iconName: 'stats', active: active === 'stats' })}
          ${actionCard({ href: hrefs.exit, label: 'Dashboard', iconName: 'exit', active: active === 'exit' })}
        </div>
      </div>
    </div>
  `;
}

