import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  CreditCard,
  Dumbbell,
  FilePlus2,
  Home,
  ImagePlus,
  KeyRound,
  MessageCircle,
  Newspaper,
  Plus,
  Search,
  Share2,
  Shield,
  Sparkles,
  Ticket,
  UserCircle,
  UserPlus,
  Users,
  UsersRound,
  X
} from 'lucide-react';
import { useShellLayout } from '../lib/useShellLayout';
import { recordUxTiming } from '../lib/uxTiming';
import { openPublicUrl } from '../lib/publicActions';
import { APP_BACK_DISMISS_EVENT } from '../lib/nativeBackButton';
import type { NotificationInboxItem } from '../lib/notificationInboxService';
import type { AuthState, NavItem } from '../lib/types';
import { RoleBadge } from './Badges';

const AppSearchDialog = lazy(() => import('./AppSearchDialog').then((module) => ({ default: module.AppSearchDialog })));
const NotificationInboxSheet = lazy(() => import('./NotificationInboxSheet').then((module) => ({ default: module.NotificationInboxSheet })));

const navItems: NavItem[] = [
  { label: 'Home', path: '/home', icon: Home },
  { label: 'Schedule', path: '/schedule', icon: CalendarDays },
  { label: 'Messages', path: '/messages', icon: MessageCircle },
  { label: 'My Teams', path: '/teams', icon: Users },
  { label: 'Profile', path: '/profile', icon: UserCircle }
];

type AddWorkflow = {
  id: string;
  label: string;
  detail: string;
  section: 'Team' | 'Player' | 'Schedule' | 'Social' | 'Team Ops';
  icon: typeof Plus;
  kind: 'native' | 'website';
  href: string;
  badge?: string;
};

interface AppShellProps {
  auth: AuthState;
  children: ReactNode;
}

export function AppShell({ auth, children }: AppShellProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState<NotificationInboxItem[]>([]);
  const [inboxState, setInboxState] = useState<'loading' | 'ready' | 'error'>('loading');
  const { isDesktopWeb } = useShellLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const routeStartedAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const isAiRoute = location.pathname === '/ai';
  const isMobileChatDetail = !isDesktopWeb && location.pathname.startsWith('/messages/') && location.pathname !== '/messages';
  const isDesktopMessages = isDesktopWeb && (location.pathname.startsWith('/messages') || isAiRoute);
  // Inlined from notificationInboxService.countUnread so this boot-path component
  // does not statically import the module (which pulls the vendored Firestore SDK
  // into the entry chunk). The module is dynamically imported on subscribe below.
  const unreadCount = inboxItems.filter((item) => !item.readAt).length;

  useEffect(() => {
    const startedAt = routeStartedAtRef.current;
    const frame = window.requestAnimationFrame(() => {
      recordUxTiming('route paint', startedAt, { route: `${location.pathname}${location.search}` || '/' });
      routeStartedAtRef.current = performance.now();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = (event.key || '').toLowerCase();
      const isModK = (key === 'k' || event.code === 'KeyK') && (event.metaKey || event.ctrlKey);
      if (!isModK || isTypingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(true);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(() => {
    const onNativeBackDismiss = (event: Event) => {
      if (searchOpen) {
        setSearchOpen(false);
        event.preventDefault();
        return;
      }
      if (addTeamOpen) {
        setAddTeamOpen(false);
        event.preventDefault();
      }
      if (inboxOpen) {
        setInboxOpen(false);
        event.preventDefault();
      }
    };

    window.addEventListener(APP_BACK_DISMISS_EVENT, onNativeBackDismiss);
    return () => window.removeEventListener(APP_BACK_DISMISS_EVENT, onNativeBackDismiss);
  }, [addTeamOpen, inboxOpen, searchOpen]);

  useEffect(() => {
    const uid = auth.user?.uid;
    if (!uid) return;
    setInboxState('loading');
    let active = true;
    let unsubscribe = () => {};
    // Lazy-import the inbox service (and its Firestore dependency) so it stays out
    // of the entry chunk and loads after first paint.
    void import('../lib/notificationInboxService')
      .then((mod) => {
        if (!active) return;
        unsubscribe = mod.subscribeToNotificationInbox(
          uid,
          (items) => {
            setInboxItems(items);
            setInboxState('ready');
          },
          () => {
            setInboxState('error');
          }
        );
      })
      .catch(() => {
        if (active) setInboxState('error');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth.user?.uid]);

  const handleMarkNotificationRead = async (uid: string, itemId: string) => {
    const mod = await import('../lib/notificationInboxService');
    await mod.markNotificationRead(uid, itemId);
  };

  const addWorkflows = buildAddWorkflows();

  const handleAddWorkflow = async (workflow: AddWorkflow) => {
    setAddTeamOpen(false);
    if (workflow.kind === 'website') {
      await openPublicUrl(workflow.href);
      return;
    }
    navigate(workflow.href);
  };

  return (
    <div className={isDesktopWeb ? `desktop-app-page ${isDesktopMessages ? 'desktop-app-page-messages' : ''}` : `app-page ${isMobileChatDetail ? 'app-page-chat-detail' : ''} ${isAiRoute ? 'app-page-ai' : ''}`}>
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
                  aria-label="Private AI"
                  title="Private AI"
                >
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                  AI
                </button>
                <button
                  type="button"
                  className="ghost-button !h-10 !min-h-10 relative"
                  onClick={() => setInboxOpen(true)}
                  aria-label="Notifications"
                  title="Notifications"
                  data-testid="app-shell-notifications-trigger"
                >
                  <Bell className="h-5 w-5" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span
                      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-black text-white"
                      aria-label={`${unreadCount} unread`}
                      data-testid="notification-unread-badge"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-button !h-10 !min-h-10"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search"
                  title="Search (Ctrl+K / Cmd+K)"
                  data-testid="app-shell-search-trigger"
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
                  Add
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
                  <span className="block truncate text-base font-black leading-tight text-gray-950">ALL PLAYS</span>
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
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                  <span className="sr-only">Private AI</span>
                </button>
                <button
                  type="button"
                  className="ghost-button !h-10 !min-h-10 !w-10 !p-0 relative"
                  onClick={() => setInboxOpen(true)}
                  aria-label="Notifications"
                  title="Notifications"
                  data-testid="app-shell-notifications-trigger"
                >
                  <Bell className="h-5 w-5" aria-hidden="true" />
                  <span className="sr-only">Notifications</span>
                  {unreadCount > 0 && (
                    <span
                      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-black text-white"
                      aria-label={`${unreadCount} unread`}
                      data-testid="notification-unread-badge"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-button !h-10 !min-h-10 !w-10 !p-0"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search"
                  title="Search (Ctrl+K / Cmd+K)"
                  data-testid="app-shell-search-trigger"
                >
                  <Search className="h-5 w-5" aria-hidden="true" />
                  <span className="sr-only">Search</span>
                </button>
                <button
                  type="button"
                  className="primary-button !h-10 !min-h-10 !w-10 !p-0 sm:!w-auto sm:!px-3"
                  onClick={() => setAddTeamOpen(true)}
                  aria-label="Add"
                  title="Add"
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                  <span className="hidden sm:inline">Add</span>
                </button>
              </div>
            </div>
          </header> : null}

          <main className={
            isMobileChatDetail
              ? 'mx-auto w-full max-w-5xl px-0 py-0'
              : isAiRoute
                ? 'mx-auto w-full max-w-5xl px-2 py-2 sm:py-4'
                : 'mx-auto w-full max-w-5xl px-4 py-4 sm:py-6'
          }>{children}</main>

          <nav
            className={`safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-2 pt-2 backdrop-blur ${isMobileChatDetail ? 'app-bottom-nav-chat-detail' : ''}`}
            aria-label="Primary navigation"
          >
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

      {inboxOpen ? (
        <Suspense fallback={null}>
          <NotificationInboxSheet
            items={inboxItems}
            inboxState={inboxState}
            uid={auth.user?.uid ?? ''}
            onClose={() => setInboxOpen(false)}
            onMarkRead={handleMarkNotificationRead}
          />
        </Suspense>
      ) : null}

      {searchOpen ? (
        <Suspense fallback={null}>
          <AppSearchDialog auth={auth} open={searchOpen} onClose={() => setSearchOpen(false)} />
        </Suspense>
      ) : null}

      {addTeamOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-gray-950/40 p-3 backdrop-blur-sm sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Add workflow">
          <div className="add-workflow-panel w-full max-w-3xl rounded-2xl bg-white shadow-app-lg">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <div className="app-label">Create or add</div>
                <h2 className="text-lg font-black text-gray-950">Add to ALL PLAYS</h2>
                <p className="mt-1 text-sm font-semibold text-gray-500">Start common team, player, schedule, and family workflows.</p>
              </div>
              <button
                type="button"
                className="ghost-button !h-10 !min-h-10 !w-10 !p-0"
                onClick={() => setAddTeamOpen(false)}
                aria-label="Close add workflow"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="add-workflow-content p-4">
              <div className="add-workflow-feature rounded-xl border border-primary-100 bg-primary-50 p-3">
                <div className="flex items-center gap-2 text-sm font-black text-primary-800">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                  Uses existing app and website workflows
                </div>
                <p className="mt-1 text-sm font-semibold leading-6 text-primary-900/80">
                  Native routes open in the app. Full coach/admin workflows open the current ALL PLAYS website until those screens are migrated.
                </p>
              </div>
              {(['Team', 'Player', 'Schedule', 'Social', 'Team Ops'] as AddWorkflow['section'][]).map((section) => (
                <section key={section} className="add-workflow-section">
                  <div className="add-workflow-section-title">{section}</div>
                  <div className="add-workflow-grid">
                    {addWorkflows.filter((workflow) => workflow.section === section).map((workflow) => {
                      const Icon = workflow.icon;
                      return (
                        <button
                          key={workflow.id}
                          type="button"
                          className="add-workflow-card"
                          onClick={() => void handleAddWorkflow(workflow)}
                        >
                          <span className="add-workflow-icon">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="add-workflow-label">{workflow.label}</span>
                            <span className="add-workflow-detail">{workflow.detail}</span>
                          </span>
                          <span className={`add-workflow-badge ${workflow.kind === 'website' ? 'add-workflow-badge-website' : ''}`}>
                            {workflow.badge || (workflow.kind === 'website' ? 'Site' : 'App')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              <div className="mt-3 flex flex-wrap gap-2">
                {auth.roles.map((role) => <RoleBadge key={role} role={role} />)}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildAddWorkflows(): AddWorkflow[] {
  return [
    {
      id: 'create-team',
      label: 'Create team',
      detail: 'New team, import shell, staff access',
      section: 'Team',
      icon: Users,
      kind: 'website',
      href: legacyUrl('dashboard.html'),
      badge: 'Coach/Admin'
    },
    {
      id: 'join-code',
      label: 'Join with code',
      detail: 'Accept team, parent, or staff invite',
      section: 'Team',
      icon: KeyRound,
      kind: 'native',
      href: '/accept-invite'
    },
    {
      id: 'request-access',
      label: 'Find team',
      detail: 'Browse public teams or request access',
      section: 'Team',
      icon: Search,
      kind: 'website',
      href: legacyUrl('teams.html')
    },
    {
      id: 'add-player',
      label: 'Add player',
      detail: 'Roster, parent invite, fields, import',
      section: 'Player',
      icon: UserPlus,
      kind: 'website',
      href: legacyUrl('edit-roster.html'),
      badge: 'Coach/Admin'
    },
    {
      id: 'invite-family',
      label: 'Invite family',
      detail: 'Co-parent and caregiver access',
      section: 'Player',
      icon: UserPlus,
      kind: 'native',
      href: '/parent-tools/access'
    },
    {
      id: 'profile-builder',
      label: 'Player profile',
      detail: 'Headshot, highlights, share settings',
      section: 'Player',
      icon: FilePlus2,
      kind: 'native',
      href: '/home',
      badge: 'Select player'
    },
    {
      id: 'add-event',
      label: 'Game or practice',
      detail: 'Schedule, reminders, officials, recurring',
      section: 'Schedule',
      icon: CalendarPlus,
      kind: 'website',
      href: legacyUrl('edit-schedule.html'),
      badge: 'Coach/Admin'
    },
    {
      id: 'practice-packet',
      label: 'Practice packet',
      detail: 'Drills, attendance, notes, home work',
      section: 'Schedule',
      icon: Dumbbell,
      kind: 'website',
      href: legacyUrl('drills.html'),
      badge: 'Coach/Admin'
    },
    {
      id: 'calendar-sync',
      label: 'Calendar sync',
      detail: 'Download or subscribe to schedules',
      section: 'Schedule',
      icon: CalendarDays,
      kind: 'native',
      href: '/parent-tools/calendar'
    },
    {
      id: 'social-post',
      label: 'Post moment',
      detail: 'Photo, game recap, player stat, or update',
      section: 'Social',
      icon: Newspaper,
      kind: 'native',
      href: '/home?section=feed&social=create'
    },
    {
      id: 'find-friends',
      label: 'Find friends',
      detail: 'Search adults, requests, suggestions',
      section: 'Social',
      icon: UsersRound,
      kind: 'native',
      href: '/home?section=friends'
    },
    {
      id: 'share-recap',
      label: 'Share game recap',
      detail: 'Start from schedule or match report',
      section: 'Social',
      icon: Share2,
      kind: 'native',
      href: '/home?section=feed&social=create&type=game_recap'
    },
    {
      id: 'team-media',
      label: 'Photos/video',
      detail: 'Albums, uploads, links, moderation',
      section: 'Team Ops',
      icon: ImagePlus,
      kind: 'native',
      href: '/teams'
    },
    {
      id: 'registration',
      label: 'Registration',
      detail: 'Forms, waivers, fees, waitlist',
      section: 'Team Ops',
      icon: Ticket,
      kind: 'native',
      href: '/parent-tools/registrations'
    },
    {
      id: 'fees',
      label: 'Fees',
      detail: 'Create fees, checkout, balances',
      section: 'Team Ops',
      icon: CreditCard,
      kind: 'website',
      href: legacyUrl('team-fees.html'),
      badge: 'Coach/Admin'
    },
    {
      id: 'awards',
      label: 'Awards',
      detail: 'Select a team to draft certificates and preview them',
      section: 'Team Ops',
      icon: ClipboardList,
      kind: 'native',
      href: '/teams',
      badge: 'Coach/Admin'
    }
  ];
}

function legacyUrl(path: string) {
  return new URL(path, 'https://allplays.ai').toString();
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}
