import { CalendarDays, CalendarPlus, ClipboardCheck, ListChecks, Sparkles, UsersRound } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { AuthState } from '../lib/types';

type ScheduleSubmenuItem = {
  id: string;
  label: string;
  mobileLabel?: string;
  path: string;
  icon: typeof CalendarDays;
};

type ScheduleSubmenuGroup = {
  id: 'family' | 'staff';
  label: string;
  items: ScheduleSubmenuItem[];
};

type ScheduleSubmenuActiveState = {
  scope?: 'family' | 'staff';
  view?: string;
  filter?: string;
  staffSection?: string;
};

export function ScheduleRoleSubmenu({
  auth,
  selectedTeamId = '',
  variant = 'sidebar',
  activeState
}: {
  auth: AuthState;
  selectedTeamId?: string;
  variant?: 'sidebar' | 'page';
  activeState?: ScheduleSubmenuActiveState;
}) {
  const location = useLocation();
  const groups = buildScheduleSubmenuGroups(auth, selectedTeamId);
  if (!groups.length) return null;

  if (variant === 'page') {
    const requestedScope = activeState?.scope || new URLSearchParams(location.search).get('scope');
    const activeGroup = groups.find((group) => group.id === requestedScope) || groups[0]!;
    return (
      <nav
        className="app-card sticky top-[72px] z-30 p-2.5 shadow-sm sm:p-3"
        aria-label="Schedule sections"
        data-testid="schedule-mobile-subnav"
      >
        {groups.length > 1 ? (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" aria-label="Schedule role">
            {groups.map((group) => {
              const active = group.id === activeGroup.id;
              return (
                <Link
                  key={group.id}
                  to={group.items[0]!.path}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-10 items-center justify-center rounded-lg px-3 text-xs font-black transition ${
                    active
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-white hover:text-gray-950'
                  }`}
                >
                  {group.id === 'family' ? 'Family' : 'Team'}
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="px-1 pb-1 text-[10px] font-black uppercase tracking-[0.1em] text-gray-400">
            {activeGroup.label}
          </div>
        )}
        <div className={`${groups.length > 1 ? 'mt-2' : 'mt-1'} grid grid-cols-4 gap-1`} aria-label={`${activeGroup.label} tasks`}>
          {activeGroup.items.map((item) => {
            const Icon = item.icon;
            const active = isScheduleSubmenuItemActive(item.id, location.search, activeState);
            return (
              <Link
                key={item.id}
                to={item.path}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[10px] font-black leading-tight transition sm:text-xs ${
                  active
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
                <span className="max-w-full truncate">{item.mobileLabel || item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <div className="ml-5 mt-1 space-y-3 border-l border-gray-200 py-1 pl-3" data-testid="schedule-role-submenu">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="px-2 text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">{group.label}</div>
          <div className="mt-1 space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isScheduleSubmenuItemActive(item.id, location.search);
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-extrabold transition ${
                    active
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function buildScheduleSubmenuGroups(auth: AuthState, selectedTeamId = ''): ScheduleSubmenuGroup[] {
  const groups: ScheduleSubmenuGroup[] = [];
  const teamQuery = selectedTeamId ? `&teamId=${encodeURIComponent(selectedTeamId)}` : '';
  if (hasFamilyScheduleAccess(auth)) {
    groups.push({
      id: 'family',
      label: 'Family schedule',
      items: [
        { id: 'family-agenda', label: 'Agenda', path: `/schedule?scope=family&view=list&filter=upcoming-all${teamQuery}`, icon: ListChecks },
        { id: 'family-rsvp', label: 'RSVP needed', mobileLabel: 'RSVP', path: `/schedule?scope=family&view=list&filter=availability${teamQuery}`, icon: UsersRound },
        { id: 'family-calendar', label: 'Calendar', path: `/schedule?scope=family&view=calendar${teamQuery}`, icon: CalendarDays },
        { id: 'family-packets', label: 'Practice packets', mobileLabel: 'Packets', path: `/schedule?scope=family&view=packets${teamQuery}`, icon: ClipboardCheck }
      ]
    });
  }
  if (hasStaffScheduleAccess(auth)) {
    groups.push({
      id: 'staff',
      label: 'Team management',
      items: [
        { id: 'staff-schedule', label: 'Team schedule', mobileLabel: 'Schedule', path: `/schedule?scope=staff&view=list&filter=upcoming-all${teamQuery}`, icon: CalendarDays },
        { id: 'staff-add', label: 'Add event', mobileLabel: 'Add', path: `/schedule?scope=staff&staffTools=1&staffSection=add${teamQuery}`, icon: CalendarPlus },
        { id: 'staff-attendance', label: 'Attendance', path: `/schedule?scope=staff&view=list&filter=upcoming-practices&staffSection=attendance${teamQuery}`, icon: ClipboardCheck },
        { id: 'staff-ai', label: 'Manage with AI', mobileLabel: 'AI', path: `/schedule?scope=staff&staffTools=1&staffSection=ai${teamQuery}`, icon: Sparkles }
      ]
    });
  }
  return groups;
}

export function hasFamilyScheduleAccess(auth: AuthState) {
  return Boolean(
    auth.isParent
    || auth.roles?.includes('parent')
    || auth.user?.parentTeamIds?.length
    || auth.user?.parentPlayerKeys?.length
    || auth.user?.parentOf?.length
  );
}

export function hasStaffScheduleAccess(auth: AuthState) {
  return Boolean(
    auth.isCoach
    || auth.isAdmin
    || auth.isPlatformAdmin
    || auth.roles?.some((role) => ['coach', 'admin', 'platformAdmin'].includes(role))
    || auth.user?.coachOf?.length
    || auth.user?.isAdmin
    || auth.user?.isPlatformAdmin
  );
}

function isScheduleSubmenuItemActive(itemId: string, search: string, activeState?: ScheduleSubmenuActiveState) {
  const params = new URLSearchParams(search);
  const scope = activeState?.scope || params.get('scope') || 'family';
  const view = activeState?.view || params.get('view') || 'list';
  const filter = activeState?.filter || params.get('filter') || 'upcoming-all';
  const staffSection = activeState?.staffSection ?? params.get('staffSection') ?? '';
  if (itemId === 'family-agenda') return scope === 'family' && view === 'list' && filter !== 'availability';
  if (itemId === 'family-rsvp') return scope === 'family' && filter === 'availability';
  if (itemId === 'family-calendar') return scope === 'family' && view === 'calendar';
  if (itemId === 'family-packets') return scope === 'family' && view === 'packets';
  if (itemId === 'staff-add') return scope === 'staff' && staffSection === 'add';
  if (itemId === 'staff-attendance') return scope === 'staff' && staffSection === 'attendance';
  if (itemId === 'staff-ai') return scope === 'staff' && staffSection === 'ai';
  return itemId === 'staff-schedule' && scope === 'staff' && !staffSection;
}
