import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  CalendarDays,
  ChevronRight,
  Home,
  MessageCircle,
  Plus,
  Search,
  Shield,
  UserCircle,
  Users,
  X
} from 'lucide-react';
import { capabilities } from '../data/capabilities';
import { useShellLayout } from '../lib/useShellLayout';
import type { AuthState, NavItem } from '../lib/types';
import { CategoryBadge, RoleBadge, StatusBadge } from './Badges';

const navItems: NavItem[] = [
  { label: 'Home', path: '/home', icon: Home },
  { label: 'Schedule', path: '/schedule', icon: CalendarDays },
  { label: 'Messages', path: '/messages', icon: MessageCircle },
  { label: 'My Teams', path: '/teams', icon: Users },
  { label: 'Profile', path: '/profile', icon: UserCircle }
];

interface AppShellProps {
  auth: AuthState;
  children: ReactNode;
}

export function AppShell({ auth, children }: AppShellProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { isDesktopWeb } = useShellLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const isAiRoute = location.pathname === '/ai';
  const isMobileChatDetail = !isDesktopWeb && ((location.pathname.startsWith('/messages/') && location.pathname !== '/messages') || isAiRoute);
  const isDesktopMessages = isDesktopWeb && (location.pathname.startsWith('/messages') || isAiRoute);

  const filteredCapabilities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return capabilities.slice(0, 10);
    }

    return capabilities
      .filter((capability) => {
        const searchable = [
          capability.title,
          capability.summary,
          capability.legacyPath,
          capability.category,
          capability.features.join(' ')
        ].join(' ').toLowerCase();

        return searchable.includes(normalizedQuery);
      })
      .slice(0, 20);
  }, [query]);

  const goToCapability = (route: string) => {
    setSearchOpen(false);
    setQuery('');
    navigate(route);
  };

  return (
    <div className={isDesktopWeb ? `desktop-app-page ${isDesktopMessages ? 'desktop-app-page-messages' : ''}` : `app-page ${isMobileChatDetail ? 'app-page-chat-detail' : ''}`}>
      {isDesktopWeb ? (
        <>
          <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => navigate('/home')}
                aria-label="Go to home"
              >
                <img src="./logo_small.png" alt="" className="h-10 w-10 flex-none rounded-xl shadow-sm" />
                <span className="min-w-0">
                  <span className="block truncate text-base font-black leading-tight text-gray-950">ALL PLAYS</span>
                  <span className="block truncate text-xs font-bold text-gray-500">
                    {auth.roles.length ? auth.roles.join(' + ') : 'Signed out preview'}
                  </span>
                </span>
              </button>
              <div className="flex flex-none items-center gap-2">
                <button
                  type="button"
                  className={`ghost-button !h-10 !min-h-10 ${isAiRoute ? '!border-primary-200 !bg-primary-50 !text-primary-700' : ''}`}
                  onClick={() => navigate('/ai')}
                  title="Private AI"
                >
                  <Bot className="h-5 w-5" aria-hidden="true" />
                  AI
                </button>
                <button
                  type="button"
                  className="ghost-button !h-10 !min-h-10"
                  onClick={() => setSearchOpen(true)}
                >
                  <Search className="h-5 w-5" aria-hidden="true" />
                  Search
                </button>
                <button
                  type="button"
                  className="primary-button !h-10 !min-h-10"
                  onClick={() => setAddTeamOpen(true)}
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                  Add Team
                </button>
              </div>
            </div>
          </header>

          <div className={`mx-auto grid max-w-7xl grid-cols-[236px_minmax(0,1fr)] gap-6 px-6 py-6 ${isDesktopMessages ? 'desktop-shell-grid-messages' : ''}`}>
            <aside className="sticky top-[84px] h-[calc(100vh-108px)] self-start rounded-2xl border border-gray-200 bg-white p-3 shadow-app">
              <nav className="space-y-1" aria-label="Primary navigation">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path || (item.path !== '/home' && location.pathname.startsWith(item.path + '/'));

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-black transition ${
                        isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'
                      }`}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </nav>
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="app-label">Account</div>
                <div className="mt-1 truncate text-sm font-black text-gray-950">{auth.user?.displayName || auth.user?.email || 'ALL PLAYS User'}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {auth.roles.map((role) => <RoleBadge key={role} role={role} />)}
                </div>
              </div>
            </aside>
            <main className={`min-w-0 ${isDesktopMessages ? 'desktop-main-messages' : 'pb-8'}`}>{children}</main>
          </div>
        </>
      ) : (
        <>
          {!isMobileChatDetail ? <header className="safe-top sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 pb-3">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => navigate('/home')}
                aria-label="Go to home"
              >
                <img src="./logo_small.png" alt="" className="h-10 w-10 flex-none rounded-xl shadow-sm" />
                <span className="min-w-0">
                  <span className="block truncate text-base font-black leading-tight text-gray-950">ALL PLAYS APP</span>
                  <span className="block truncate text-xs font-bold text-gray-500">
                    {auth.roles.length ? auth.roles.join(' + ') : 'Signed out preview'}
                  </span>
                </span>
              </button>
              <div className="flex flex-none items-center gap-2">
                <button
                  type="button"
                  className={`ghost-button !h-10 !min-h-10 !w-10 !p-0 ${isAiRoute ? '!border-primary-200 !bg-primary-50 !text-primary-700' : ''}`}
                  onClick={() => navigate('/ai')}
                  aria-label="Private AI"
                  title="Private AI"
                >
                  <Bot className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ghost-button !h-10 !min-h-10 !w-10 !p-0"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search"
                  title="Search"
                >
                  <Search className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="primary-button !h-10 !min-h-10 !w-10 !p-0 sm:!w-auto sm:!px-3"
                  onClick={() => setAddTeamOpen(true)}
                  aria-label="Add team"
                  title="Add team"
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                  <span className="hidden sm:inline">Add Team</span>
                </button>
              </div>
            </div>
          </header> : null}

          <main className={isMobileChatDetail ? 'mx-auto w-full max-w-5xl px-0 py-0' : 'mx-auto w-full max-w-5xl px-4 py-4 sm:py-6'}>{children}</main>

          <nav className={`safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-2 pt-2 backdrop-blur ${isMobileChatDetail ? 'app-bottom-nav-chat-detail' : ''}`} aria-label="Primary navigation">
            <div className="mx-auto grid max-w-5xl grid-cols-5 gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path || (item.path !== '/home' && location.pathname.startsWith(item.path + '/'));

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-extrabold transition ${
                      isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                    }`}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <span className="max-w-full truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </nav>
        </>
      )}

      {searchOpen ? (
        <div className="fixed inset-0 z-50 bg-gray-950/40 px-3 py-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Search features">
          <div className="mx-auto flex max-h-[92vh] max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-app-lg">
            <div className="flex items-center gap-2 border-b border-gray-200 p-3">
              <Search className="h-5 w-5 flex-none text-gray-400" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-base font-semibold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                placeholder="Search pages, teams, schedule, chat..."
              />
              <button
                type="button"
                className="ghost-button !h-11 !min-h-11 !w-11 !p-0"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto p-3">
              <div className="mb-2 px-1 text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">
                Current site capability map
              </div>
              <div className="space-y-2">
                {filteredCapabilities.map((capability) => (
                  <button
                    key={capability.id}
                    type="button"
                    className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left transition hover:border-primary-200 hover:bg-primary-50/50"
                    onClick={() => goToCapability(capability.route)}
                  >
                    <span className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black text-gray-950">{capability.title}</span>
                        <span className="mt-1 block line-clamp-2 text-xs font-semibold leading-5 text-gray-600">{capability.summary}</span>
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          <CategoryBadge category={capability.category} />
                          <StatusBadge status={capability.status} />
                        </span>
                      </span>
                      <ChevronRight className="mt-1 h-5 w-5 flex-none text-gray-400" aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {addTeamOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-gray-950/40 p-3 backdrop-blur-sm sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Add team">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-app-lg">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <div className="app-label">Team setup</div>
                <h2 className="text-lg font-black text-gray-950">Add Team</h2>
              </div>
              <button
                type="button"
                className="ghost-button !h-10 !min-h-10 !w-10 !p-0"
                onClick={() => setAddTeamOpen(false)}
                aria-label="Close add team"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="rounded-xl border border-primary-100 bg-primary-50 p-3">
                <div className="flex items-center gap-2 text-sm font-black text-primary-800">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                  Uses the same team setup contract
                </div>
                <p className="mt-1 text-sm font-semibold leading-6 text-primary-900/80">
                  This is stubbed for navigation first. The production flow should reuse create team, invites, registration import, and staff permissions from the current website modules.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {['Create team', 'Join with code', 'Import roster'].map((label) => (
                  <button key={label} type="button" className="secondary-button justify-center" onClick={() => goToCapability('/capabilities/dashboard')}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {auth.roles.map((role) => (
                  <RoleBadge key={role} role={role} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
