import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  DollarSign,
  Flag,
  Heart,
  ImagePlus,
  Loader2,
  MessageCircle,
  Newspaper,
  Plus,
  RefreshCw,
  Share2,
  Shield,
  Sparkles,
  Ticket,
  Trophy,
  UserRound,
  UserPlus,
  Users,
  type LucideIcon
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { HomePageSkeleton } from '../components/PageSkeletons';
import { loadParentHomeSummaryBootstrap, loadParentHomeWithSecondaryData } from '../lib/homeService';
import { toAppServiceError, type AppServiceError } from '../lib/appErrors';
import {
  blockFriend,
  commentOnSocialPost,
  createSocialPost,
  hideSocialPost,
  loadSocialHome,
  removeFriend,
  reportSocialPost,
  respondToFriendRequest,
  searchSocialUsers,
  sendFriendRequest,
  reactToSocialPost,
  uploadSocialPostMedia,
  type CreateSocialPostInput
} from '../lib/socialService';
import {
  getEventDetailPath,
  getPlayerDetailPath,
  getTeamHomePath,
  type HomeActionKind,
  type ParentHomeAction,
  type ParentHomeModel,
  type ParentHomePlayer,
  type ParentHomeTeam
} from '../lib/homeLogic';
import {
  formatEventDateLabel,
  formatEventTimeLabel,
  getOpenScheduleAssignments,
  getScheduleTitle,
  normalizeRsvpResponse,
  type ParentScheduleEvent,
  type RsvpResponse
} from '../lib/scheduleLogic';
import { loadOfficialAssignmentsAccess } from '../lib/scheduleService';
import { useAsyncOperation } from '../lib/useAsyncOperation';
import { useRefreshOnResume } from '../lib/useRefreshOnResume';
import {
  emptySocialHome,
  filterSocialFeedItems,
  getSocialPostPresetForType,
  getSocialTypeLabel,
  getSocialVisibilityLabel,
  socialPostPresets,
  socialFeedFilters,
  socialVisibilityOptions,
  type SocialFeedFilter,
  type SocialFeedItem,
  type SocialFriend,
  type SocialHomeModel,
  type SocialPostType,
  type SocialVisibility
} from '../lib/socialLogic';
import type { AuthState } from '../lib/types';

type HomeSectionId = 'today' | 'feed' | 'players' | 'teams' | 'friends';

const homeSections: Array<{ id: HomeSectionId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'feed', label: 'Feed' },
  { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' },
  { id: 'friends', label: 'Friends' }
];

const actionIcons: Record<HomeActionKind, LucideIcon> = {
  rsvp: ClipboardCheck,
  packet: ClipboardCheck,
  assignment: CheckCircle2,
  rideshare: Car,
  fee: DollarSign,
  message: MessageCircle
};

const actionToneClasses: Record<ParentHomeAction['tone'], string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  gray: 'border-gray-200 bg-gray-50 text-gray-700'
};

const rsvpBadgeClasses: Record<RsvpResponse, string> = {
  going: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  maybe: 'border-amber-200 bg-amber-50 text-amber-700',
  not_going: 'border-rose-200 bg-rose-50 text-rose-700',
  not_responded: 'border-primary-200 bg-primary-50 text-primary-700'
};

const emptyHome = (): ParentHomeModel => ({
  players: [],
  teams: [],
  upcomingEvents: [],
  actionItems: [],
  fees: [],
  metrics: {
    players: 0,
    teams: 0,
    rsvpNeeded: 0,
    unreadMessages: 0,
    packetsReady: 0
  }
});

export function Home({ auth }: { auth: AuthState }) {
  const [home, setHome] = useState<ParentHomeModel>(() => emptyHome());
  const [social, setSocial] = useState<SocialHomeModel>(() => emptySocialHome());
  const [activeSection, setActiveSection] = useState<HomeSectionId>('today');
  const [officialsAccess, setOfficialsAccess] = useState<{ hasAccess: boolean; teamCount: number } | null>(null);
  const [socialStatus, setSocialStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadedHomeDetailsUserId, setLoadedHomeDetailsUserId] = useState<string | null>(null);
  const [homeLoadError, setHomeLoadError] = useState<AppServiceError | null>(null);
  const { loading, error, clearError, run: runPrimaryLoad } = useAsyncOperation();
  const { loading: socialLoading, run: runSecondaryLoad } = useAsyncOperation();

  const authUserId = auth.user?.uid || null;
  const hasLoadedHomeDetails = Boolean(authUserId) && authUserId === loadedHomeDetailsUserId;

  const refreshHome = async ({ force = false }: { force?: boolean } = {}) => {
    const user = auth.user;
    if (!user) return;
    const hasExistingHome = loadedHomeDetailsUserId === user.uid;
    clearError();
    setHomeLoadError(null);
    setSocialStatus(null);
    return runPrimaryLoad(
      async () => {
        const summary = await loadParentHomeSummaryBootstrap(user, { force });
        setHome(summary.home);
        setHomeLoadError(null);

        void runSecondaryLoad(
          async () => {
            const secondaryHome = await loadParentHomeWithSecondaryData(user, { force, schedule: summary.schedule });
            setHome(secondaryHome);
            setSocial(await loadSocialHome(user, secondaryHome));
            setLoadedHomeDetailsUserId(user.uid);
            setHomeLoadError(null);
          },
          {
            rethrow: false,
            getErrorMessage: (secondaryError) => getHomeSecondaryErrorMessage(toAppServiceError(secondaryError, 'Unable to refresh Home details.')),
            onError: (secondaryError) => {
              const appError = toAppServiceError(secondaryError, 'Unable to refresh Home details.');
              if (!hasExistingHome) {
                setHomeLoadError(appError);
                setLoadedHomeDetailsUserId(null);
                setSocial(emptySocialHome());
                return;
              }
              setSocialStatus({ tone: 'error', message: getHomeSecondaryErrorMessage(appError) });
            }
          }
        );

        return summary;
      },
      {
        getErrorMessage: (loadError) => getHomeLoadErrorMessage(toAppServiceError(loadError, 'Unable to load Home.'), hasExistingHome),
        rethrow: false,
        onError: (loadError) => {
          setHomeLoadError(toAppServiceError(loadError, 'Unable to load Home.'));
          if (!hasExistingHome) {
            setHome(emptyHome());
            setSocial(emptySocialHome());
            setLoadedHomeDetailsUserId(null);
          }
        }
      }
    );
  };

  useEffect(() => {
    refreshHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  useRefreshOnResume(() => { void refreshHome({ force: true }); }, { enabled: Boolean(auth.user?.uid) });

  useEffect(() => {
    let cancelled = false;
    if (!auth.user) {
      setOfficialsAccess(null);
      return;
    }
    loadOfficialAssignmentsAccess(auth.user)
      .then((result) => {
        if (!cancelled) {
          setOfficialsAccess({ hasAccess: result.hasAccess, teamCount: result.teamCount });
        }
      })
      .catch(() => {
        if (!cancelled && typeof window !== 'undefined') {
          setOfficialsAccess({ hasAccess: false, teamCount: 0 });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  useEffect(() => {
    const section = searchParams.get('section') as HomeSectionId | null;
    if (section && homeSections.some((item) => item.id === section)) {
      setActiveSection(section);
    }
    setComposerOpen(searchParams.get('social') === 'create');
  }, [searchParams]);

  const topAction = home.actionItems[0] || null;
  const showBlockingErrorState = !loading && !hasLoadedHomeDetails && Boolean(homeLoadError);
  const displayName = auth.user?.displayName || auth.user?.email || 'ALL PLAYS User';
  const openCount = home.metrics.rsvpNeeded + home.metrics.packetsReady + home.metrics.unreadMessages + home.fees.length + social.metrics.incomingRequests;
  const today = new Date();
  const selectedComposerType = (searchParams.get('type') || 'manual_post') as SocialPostType;

  const openComposer = (type: SocialPostType = 'manual_post') => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', 'feed');
    nextParams.set('social', 'create');
    if (type === 'manual_post') {
      nextParams.delete('type');
    } else {
      nextParams.set('type', type);
    }
    setActiveSection('feed');
    setSearchParams(nextParams, { replace: true });
    setComposerOpen(true);
  };

  const selectSection = (sectionId: HomeSectionId) => {
    setActiveSection(sectionId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', sectionId);
    nextParams.delete('social');
    nextParams.delete('type');
    setSearchParams(nextParams, { replace: true });
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const refreshSocial = async (nextHome = home) => {
    const user = auth.user;
    if (!user) return;
    setSocialStatus(null);
    await runSecondaryLoad(
      async () => {
        setSocial(await loadSocialHome(user, nextHome));
      },
      {
        getErrorMessage: (loadError) => getAsyncErrorMessage(loadError, 'Unable to refresh Feed.'),
        rethrow: false,
        onError: (loadError) => {
          setSocialStatus({ tone: 'error', message: getAsyncErrorMessage(loadError, 'Unable to refresh Feed.') });
        }
      }
    );
  };

  const handleCreatePost = async (input: CreateSocialPostInput) => {
    if (!auth.user) return;
    setSocialStatus(null);
    try {
      await createSocialPost(auth.user, input);
      setComposerOpen(false);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('social');
      nextParams.delete('type');
      setSearchParams(nextParams, { replace: true });
      await refreshSocial();
      setSocialStatus({ tone: 'success', message: 'Posted to your ALL PLAYS feed.' });
    } catch (postError: any) {
      setSocialStatus({ tone: 'error', message: postError?.message || 'Unable to create post.' });
    }
  };

  return (
    <div className="home-page home-page-live home-page-social space-y-3">
      <section className="home-hero app-card overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <div className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-2xl bg-gray-950 text-white shadow-sm">
            <div className="text-[10px] font-black uppercase leading-none tracking-[0.08em] text-gray-300">{today.toLocaleDateString('en-US', { month: 'short' })}</div>
            <div className="mt-0.5 text-xl font-black leading-none">{today.getDate()}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="app-label">Home</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${openCount ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                {openCount ? `${openCount} open` : 'Clear'}
              </span>
            </div>
            <h1 className="mt-0.5 truncate text-xl font-black leading-tight text-gray-950">Today for your players</h1>
            <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">{displayName}</p>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0 sm:!w-auto sm:!px-3 text-xs" onClick={() => refreshHome({ force: true })} disabled={loading} aria-label="Refresh Home" title="Refresh Home">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
        <div className="hidden gap-1.5 overflow-x-auto border-t border-gray-100 px-3 py-2 sm:flex sm:px-4">
          {topAction ? <TopAction action={topAction} /> : (
            <div className="flex min-h-8 flex-none items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-black text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              Clear
            </div>
          )}
          <PulseChip icon={UserRound} label="Players" value={String(home.metrics.players)} />
          <PulseChip icon={Users} label="Teams" value={String(home.metrics.teams)} />
          <PulseChip icon={ClipboardCheck} label="RSVP" value={String(home.metrics.rsvpNeeded)} urgent={home.metrics.rsvpNeeded > 0} />
          <PulseChip icon={ClipboardCheck} label="Packets" value={String(home.metrics.packetsReady)} urgent={home.metrics.packetsReady > 0} />
          <PulseChip icon={MessageCircle} label="Unread" value={String(home.metrics.unreadMessages)} urgent={home.metrics.unreadMessages > 0} />
          <PulseChip icon={Newspaper} label="Feed" value={String(social.metrics.feedItems)} />
          <PulseChip icon={UserPlus} label="Requests" value={String(social.metrics.incomingRequests)} urgent={social.metrics.incomingRequests > 0} />
        </div>
      </section>

      <div className="home-section-nav sticky top-24 z-30 -mx-1 overflow-x-auto bg-gray-50/95 py-2 backdrop-blur">
        <div className="grid min-w-max grid-cols-5 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
          {homeSections.map((section) => {
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`min-h-10 rounded-xl px-3 text-sm font-black transition ${active ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'}`}
                onClick={() => selectSection(section.id)}
                aria-pressed={active}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      {error ? <Status tone="error" message={error} /> : null}
      {socialStatus ? <Status tone={socialStatus.tone} message={socialStatus.message} /> : null}

      {loading ? <HomePageSkeleton /> : null}

      {showBlockingErrorState ? <HomeLoadErrorState error={homeLoadError} onRetry={() => refreshHome({ force: true })} retrying={loading} /> : null}

      {!loading && !showBlockingErrorState && activeSection === 'today' ? <TodaySection home={home} social={social} socialLoading={socialLoading} onOpenComposer={openComposer} officialsAccess={officialsAccess} /> : null}
      {!loading && !showBlockingErrorState && activeSection === 'feed' ? (
        <FeedSection
          social={social}
          loading={socialLoading}
          auth={auth}
          home={home}
          onRefresh={() => refreshSocial()}
          onOpenComposer={openComposer}
          onStatus={setSocialStatus}
        />
      ) : null}
      {!loading && !showBlockingErrorState && activeSection === 'players' ? <PlayersSection players={home.players} /> : null}
      {!loading && !showBlockingErrorState && activeSection === 'teams' ? <TeamsSection teams={home.teams} /> : null}
      {!loading && !showBlockingErrorState && activeSection === 'friends' ? (
        <FriendsSection
          auth={auth}
          home={home}
          social={social}
          loading={socialLoading}
          onRefresh={() => refreshSocial()}
          onStatus={setSocialStatus}
        />
      ) : null}

      {composerOpen ? (
        <SocialComposerModal
          key={selectedComposerType}
          home={home}
          social={social}
          initialType={selectedComposerType}
          onClose={() => {
            setComposerOpen(false);
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete('social');
            nextParams.delete('type');
            setSearchParams(nextParams, { replace: true });
          }}
          onSubmit={handleCreatePost}
        />
      ) : null}
    </div>
  );
}

function TodaySection({
  home,
  social,
  socialLoading,
  onOpenComposer,
  officialsAccess
}: {
  home: ParentHomeModel;
  social: SocialHomeModel;
  socialLoading: boolean;
  onOpenComposer: (type?: SocialPostType) => void;
  officialsAccess: { hasAccess: boolean; teamCount: number } | null;
}) {
  const unreadTeams = home.teams
    .filter((team) => Number(team.unreadCount || 0) > 0)
    .sort((a, b) => Number(b.unreadCount || 0) - Number(a.unreadCount || 0));
  const packetAction = home.actionItems.find((action) => action.kind === 'packet') || null;
  const rsvpAction = home.actionItems.find((action) => action.kind === 'rsvp') || null;
  const nextEvents = home.upcomingEvents.slice(0, 3);
  const topAction = home.actionItems[0] || null;
  const firstUnreadTeam = unreadTeams[0] || null;
  const nextEvent = nextEvents[0] || null;
  const remainingActions = topAction ? home.actionItems.slice(1, 6) : home.actionItems.slice(0, 6);

  return (
    <div className="home-section-content space-y-3">
      <TodayPriorityCard action={topAction} nextEvent={nextEvent} />

      <section className="home-signal-grid grid gap-2 sm:grid-cols-3">
        <SignalCard
          icon={ClipboardCheck}
          label="Availability"
          value={String(home.metrics.rsvpNeeded)}
          detail={home.metrics.rsvpNeeded ? 'Needs a response' : 'Responses done'}
          to={rsvpAction?.to || '/schedule'}
          urgent={home.metrics.rsvpNeeded > 0}
        />
        <SignalCard
          icon={MessageCircle}
          label="Team chats"
          value={String(home.metrics.unreadMessages)}
          detail={firstUnreadTeam ? `${home.metrics.unreadMessages} unread message${home.metrics.unreadMessages === 1 ? '' : 's'} · ${unreadTeams.slice(0, 2).map((team) => team.teamName).join(' · ')}` : 'Caught up'}
          to={firstUnreadTeam ? `/messages/${encodeURIComponent(firstUnreadTeam.teamId)}` : '/messages'}
          urgent={home.metrics.unreadMessages > 0}
        />
        <SignalCard
          icon={ClipboardCheck}
          label="Practice packets"
          value={String(home.metrics.packetsReady)}
          detail={home.metrics.packetsReady ? 'Ready to review' : 'None open'}
          to={packetAction?.to || '/schedule'}
          urgent={home.metrics.packetsReady > 0}
        />
      </section>

      <HomeFeedPreview social={social} loading={socialLoading} onOpenComposer={onOpenComposer} />

      {officialsAccess?.hasAccess ? (
        <Link to="/officials" className="app-card block p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">
              <Flag className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="app-label">Officials</div>
              <h2 className="mt-1 app-section-title">Manage assignments</h2>
              <div className="mt-1 text-sm font-semibold text-gray-600">Review upcoming games, respond to pending slots, and claim open officiating assignments.</div>
              <div className="mt-2 text-xs font-black uppercase tracking-[0.04em] text-primary-700">{officialsAccess.teamCount} linked team{officialsAccess.teamCount === 1 ? '' : 's'}</div>
            </div>
            <ChevronRight className="h-5 w-5 flex-none text-gray-400" aria-hidden="true" />
          </div>
        </Link>
      ) : null}

      <section className="home-upcoming-section space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="app-section-title">Upcoming</h2>
          <Link to="/schedule" className="text-sm font-black text-primary-700">View all</Link>
        </div>
        {home.upcomingEvents.length ? nextEvents.map((event) => (
          <HomeEventCard key={`${event.teamId}-${event.id}-${event.date.toISOString()}`} event={event} />
        )) : (
          <EmptyCard icon={CalendarDays} title="No upcoming events" detail="Your schedule is clear for the current filters." />
        )}
      </section>

      <section className="home-action-section app-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="app-label">To-do list</div>
            <h2 className="mt-1 app-section-title">{topAction ? 'More to do' : 'Needs Attention'}</h2>
          </div>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-black text-gray-600">{home.actionItems.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {remainingActions.length ? remainingActions.map((action) => (
            <ActionRow key={action.id} action={action} />
          )) : (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden="true" />
              <div>
                <div className="text-sm font-black text-emerald-900">All caught up</div>
                <div className="mt-0.5 text-xs font-semibold text-emerald-700">No parent actions need attention right now.</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {home.fees.length ? (
        <section className="app-card p-4">
          <div className="flex items-center gap-2 text-sm font-black text-rose-800">
            <DollarSign className="h-4 w-4" aria-hidden="true" />
            Fees
          </div>
          <div className="mt-3 space-y-2">
            {home.fees.slice(0, 3).map((fee) => (
              <Link key={`${fee.teamId}-${fee.id || fee.title}`} to="/parent-tools/fees" className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-gray-950">{fee.title || 'Team fee'}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-gray-500">{fee.teamName || 'Team'}{fee.playerName ? ` · ${fee.playerName}` : ''}</span>
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TodayPriorityCard({ action, nextEvent }: { action: ParentHomeAction | null; nextEvent: ParentScheduleEvent | null }) {
  if (!action) {
    return (
      <section className="home-priority-card app-card overflow-hidden border-emerald-200">
        <div className="flex items-start gap-3 p-4">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="app-label text-emerald-700">Do first</div>
            <h2 className="mt-1 text-lg font-black leading-tight text-gray-950">All caught up</h2>
            <p className="mt-1 text-sm font-semibold leading-5 text-gray-600">Availability, packets, assignments, fees, and unread chats are clear.</p>
          </div>
        </div>
        <PriorityFooter action={null} nextEvent={nextEvent} />
      </section>
    );
  }

  const Icon = actionIcons[action.kind];
  return (
    <section className="home-priority-card app-card overflow-hidden border-amber-200">
      <div className="flex items-start gap-3 p-4">
        <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl border ${actionToneClasses[action.tone]}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="app-label text-amber-700">Do first</div>
          <h2 className="mt-1 text-lg font-black leading-tight text-gray-950">{action.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-gray-600">{action.detail}</p>
        </div>
      </div>
      <PriorityFooter action={action} nextEvent={nextEvent} />
    </section>
  );
}

function PriorityFooter({ action, nextEvent }: { action: ParentHomeAction | null; nextEvent: ParentScheduleEvent | null }) {
  return (
    <div className="grid gap-2 border-t border-gray-100 bg-gray-50 p-2 sm:grid-cols-2">
      {action ? (
        <Link to={action.to} className="group flex min-h-10 items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 text-xs font-black uppercase tracking-[0.04em] text-amber-800 ring-1 ring-amber-100 transition hover:ring-amber-300">
          Open action
          <ChevronRight className="h-4 w-4 flex-none transition group-hover:text-amber-600" aria-hidden="true" />
        </Link>
      ) : (
        <div className="flex min-h-10 items-center gap-2 rounded-lg bg-emerald-50 px-3 text-xs font-black uppercase tracking-[0.04em] text-emerald-800 ring-1 ring-emerald-100">
          <CheckCircle2 className="h-4 w-4 flex-none" aria-hidden="true" />
          Clear
        </div>
      )}

      {nextEvent ? (
        <Link to={getEventDetailPath(nextEvent)} className="group flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-lg bg-white px-3 ring-1 ring-gray-200 transition hover:ring-primary-200">
          <span className="min-w-0">
            <span className="block truncate text-[10px] font-black uppercase tracking-[0.04em] text-primary-700">Next up</span>
            <span className="block truncate text-xs font-black text-gray-950">{getScheduleTitle(nextEvent)} · {formatEventTimeLabel(nextEvent.date)}</span>
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-gray-400 transition group-hover:text-primary-600" aria-hidden="true" />
        </Link>
      ) : (
        <div className="flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 text-xs font-black text-gray-500 ring-1 ring-gray-200">
          <CalendarDays className="h-4 w-4 flex-none" aria-hidden="true" />
          No upcoming events
        </div>
      )}
    </div>
  );
}

function SignalCard({ icon: Icon, label, value, detail, to, urgent = false }: { icon: LucideIcon; label: string; value: string; detail: string; to: string; urgent?: boolean }) {
  return (
    <Link to={to} className={`home-signal-card group flex items-center gap-3 rounded-xl border bg-white p-3 shadow-sm transition hover:shadow-app ${urgent ? 'border-amber-200 hover:border-amber-300' : 'border-gray-200 hover:border-primary-200'}`}>
      <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ring-1 ${urgent ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-gray-50 text-primary-600 ring-gray-200'}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-xs font-black uppercase tracking-[0.04em] text-gray-500">{label}</div>
          <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-black ${urgent ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>{value}</span>
        </div>
        <div className="mt-0.5 truncate text-sm font-black text-gray-950">{detail}</div>
      </div>
      <ChevronRight className="h-4 w-4 flex-none text-gray-400 transition group-hover:text-primary-600" aria-hidden="true" />
    </Link>
  );
}

function PlayersSection({ players }: { players: ParentHomePlayer[] }) {
  if (!players.length) {
    return <EmptyCard icon={UserRound} title="No players linked yet" detail="Redeem an invite code or request team access." />;
  }

  return (
    <section className="home-section-content app-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="app-label">My players</div>
          <h2 className="mt-1 app-section-title">Player Drill-In</h2>
        </div>
        <UserRound className="h-5 w-5 text-primary-600" aria-hidden="true" />
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {players.map((player) => (
          <PlayerCard key={`${player.teamId}-${player.playerId}`} player={player} />
        ))}
      </div>
    </section>
  );
}

function TeamsSection({ teams }: { teams: ParentHomeTeam[] }) {
  if (!teams.length) {
    return <EmptyCard icon={Users} title="No teams available" detail="Team access appears after a player is linked." />;
  }

  return (
    <section className="home-section-content app-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="app-label">My teams</div>
          <h2 className="mt-1 app-section-title">Teams</h2>
        </div>
        <Users className="h-5 w-5 text-primary-600" aria-hidden="true" />
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {teams.map((team) => (
          <TeamCard key={team.teamId} team={team} />
        ))}
      </div>
    </section>
  );
}

function AccessSection() {
  return (
    <section className="home-section-content grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <AccessCard to="/accept-invite" icon={Shield} title="Accept invite" detail="Redeem a coach invite code." tone="primary" />
      <AccessCard to="/parent-tools/access" icon={Users} title="Request player access" detail="Choose team, player, and relationship." tone="emerald" />
      <AccessCard to="/parent-tools/calendar" icon={CalendarDays} title="Calendar tools" detail="Download or subscribe to schedules." tone="blue" />
      <AccessCard to="/parent-tools/share" icon={Share2} title="Family share" detail="Share a private family page." tone="violet" />
      <AccessCard to="/parent-tools/registrations" icon={Ticket} title="Registrations" detail="Open team registration forms." tone="amber" />
      <AccessCard to="/parent-tools/certificates" icon={Trophy} title="Awards" detail="View published certificates." tone="rose" />
    </section>
  );
}

function AccessCard({ to, icon: Icon, title, detail, tone }: { to: string; icon: LucideIcon; title: string; detail: string; tone: 'primary' | 'emerald' | 'blue' | 'violet' | 'amber' | 'rose' }) {
  const toneClass = {
    primary: 'bg-primary-50 text-primary-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700'
  }[tone];
  return (
    <Link to={to} className="app-card flex items-start gap-3 p-4 transition hover:border-primary-200 hover:shadow-app-lg">
      <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl ${toneClass}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-gray-950">{title}</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-gray-600">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </Link>
  );
}

function HomeFeedPreview({ social, loading, onOpenComposer }: { social: SocialHomeModel; loading: boolean; onOpenComposer: (type?: SocialPostType) => void }) {
  const previewItems = social.feedItems.slice(0, 2);
  return (
    <section className="home-feed-preview app-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <div className="app-label">Community</div>
          <h2 className="mt-1 app-section-title">Team feed</h2>
        </div>
        <button type="button" className="ghost-button !min-h-9 !px-3 text-xs" onClick={() => onOpenComposer('player_moment')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Post
        </button>
      </div>
      <div className="space-y-2 p-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-bold text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
            Loading feed
          </div>
        ) : previewItems.length ? previewItems.map((item) => (
          <SocialFeedMini key={item.id} item={item} />
        )) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-600">
            Post a player moment, team photo, or game recap to start your family feed.
          </div>
        )}
        <Link to="/home?section=feed" className="flex min-h-10 items-center justify-between rounded-xl bg-primary-50 px-3 text-sm font-black text-primary-800">
          Open full feed
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function SocialFeedMini({ item }: { item: SocialFeedItem }) {
  const href = item.route || item.href || '/home?section=feed';
  const isExternal = Boolean(item.href && !item.route);
  const content = (
    <>
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gray-950 text-white">
        <SocialTypeIcon type={item.type} />
      </div>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-gray-950">{item.title}</span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-gray-500">{item.detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </>
  );
  return isExternal ? (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200">
      {content}
    </a>
  ) : (
    <Link to={href} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200">
      {content}
    </Link>
  );
}

function FeedSection({
  social,
  loading,
  auth,
  home,
  onRefresh,
  onOpenComposer,
  onStatus
}: {
  social: SocialHomeModel;
  loading: boolean;
  auth: AuthState;
  home: ParentHomeModel;
  onRefresh: () => Promise<void> | void;
  onOpenComposer: (type?: SocialPostType) => void;
  onStatus: (status: { tone: 'error' | 'success'; message: string } | null) => void;
}) {
  const [filter, setFilter] = useState<SocialFeedFilter>('all');
  const visibleItems = useMemo(() => filterSocialFeedItems(social.feedItems, filter), [social.feedItems, filter]);

  return (
    <section className="home-section-content space-y-3">
      <div className="app-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="app-label">Social</div>
            <h2 className="mt-1 app-section-title">Feed</h2>
            <p className="mt-1 text-xs font-semibold text-gray-500">Team posts, player moments, game recaps, packets, and friend updates.</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={() => onRefresh()} disabled={loading} aria-label="Refresh feed" title="Refresh feed">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" className="primary-button !min-h-9 !px-3 text-xs" onClick={() => onOpenComposer()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Post
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border-b border-gray-100 px-3 py-2">
          <div className="flex min-w-max gap-1">
            {socialFeedFilters.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`min-h-8 rounded-full px-3 text-xs font-black transition ${filter === option.id ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-950'}`}
                onClick={() => setFilter(option.id)}
                aria-pressed={filter === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            {visibleItems.length ? visibleItems.map((item) => (
              <SocialFeedCard
                key={item.id}
                item={item}
                auth={auth}
                onRefresh={onRefresh}
                onStatus={onStatus}
              />
            )) : (
              <EmptyCard icon={Newspaper} title="No posts for this filter" detail={home.teams.length ? 'Try another filter or create a post for your team.' : 'Link a team or player to unlock team feed activity.'} />
            )}
          </div>
          <aside className="space-y-3">
            <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center gap-2 text-sm font-black text-gray-950">
                <UserPlus className="h-4 w-4 text-primary-600" aria-hidden="true" />
                Friends
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <MiniMetric label="Friends" value={social.metrics.friends} />
                <MiniMetric label="Requests" value={social.metrics.incomingRequests} urgent={social.metrics.incomingRequests > 0} />
                <MiniMetric label="Ideas" value={social.metrics.suggestions} />
              </div>
              <Link to="/home?section=friends" className="mt-3 flex min-h-9 items-center justify-between rounded-lg bg-white px-3 text-xs font-black text-primary-700 ring-1 ring-gray-200">
                Manage friends
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </section>
            <section className="rounded-xl border border-primary-100 bg-primary-50 p-3">
              <div className="flex items-center gap-2 text-sm font-black text-primary-900">
                <Sparkles className="h-4 w-4 text-primary-700" aria-hidden="true" />
                Quick shares
              </div>
              <div className="mt-2 grid gap-2">
                {socialPostPresets.slice(0, 4).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="flex min-h-10 items-center justify-between rounded-lg bg-white px-3 text-left text-xs font-black text-primary-900 ring-1 ring-primary-100 transition hover:ring-primary-300"
                    onClick={() => onOpenComposer(preset.type)}
                  >
                    {preset.label}
                    <ChevronRight className="h-4 w-4 flex-none text-primary-500" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function SocialFeedCard({
  item,
  auth,
  onRefresh,
  onStatus
}: {
  item: SocialFeedItem;
  auth: AuthState;
  onRefresh: () => Promise<void> | void;
  onStatus: (status: { tone: 'error' | 'success'; message: string } | null) => void;
}) {
  const [comment, setComment] = useState('');
  const [busyActions, setBusyActions] = useState<Record<string, boolean>>({});
  const [optimisticItem, setOptimisticItem] = useState(item);
  const inFlightActionsRef = useRef(new Set<string>());
  const canPersist = !item.autoGenerated && Boolean(auth.user?.uid);
  const isAuthor = item.authorId === auth.user?.uid;
  const primaryHref = item.route || item.href || '';
  const isExternal = Boolean(item.href && !item.route);

  useEffect(() => {
    setOptimisticItem(item);
  }, [item]);

  const setActionBusy = (actionKey: string, busy: boolean) => {
    setBusyActions((current) => {
      if (busy) {
        return { ...current, [actionKey]: true };
      }
      if (!current[actionKey]) return current;
      const next = { ...current };
      delete next[actionKey];
      return next;
    });
  };

  const runAction = async ({
    actionKey,
    action,
    success,
    optimistic,
    rollback,
    clearComment = false
  }: {
    actionKey: string;
    action: () => Promise<void>;
    success: string;
    optimistic?: () => void;
    rollback?: () => void;
    clearComment?: boolean;
  }) => {
    if (inFlightActionsRef.current.has(actionKey)) return;
    const previousComment = clearComment ? comment : '';
    inFlightActionsRef.current.add(actionKey);
    setActionBusy(actionKey, true);
    onStatus(null);
    optimistic?.();
    if (clearComment) {
      setComment('');
    }
    try {
      await action();
      await onRefresh();
      onStatus({ tone: 'success', message: success });
    } catch (error: any) {
      rollback?.();
      if (clearComment) {
        setComment(previousComment);
      }
      onStatus({ tone: 'error', message: error?.message || 'Unable to update feed.' });
    } finally {
      inFlightActionsRef.current.delete(actionKey);
      setActionBusy(actionKey, false);
    }
  };

  const likeCount = Number(optimisticItem.reactionCounts.like || 0);
  const commentCount = Number(optimisticItem.commentCount || 0);
  const likeBusy = Boolean(busyActions.like);
  const hideBusy = Boolean(busyActions.hide);
  const reportBusy = Boolean(busyActions.report);
  const commentBusy = Boolean(busyActions.comment);

  return (
    <article className="social-feed-card app-card overflow-hidden shadow-sm">
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-gray-950 text-white">
          <SocialTypeIcon type={item.type} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-700">{getSocialTypeLabel(item.type)}</span>
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-primary-700">{getSocialVisibilityLabel(item.visibility)}</span>
            {item.autoGenerated ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-amber-700">Suggested</span> : null}
          </div>
          <h3 className="mt-2 text-base font-black leading-5 text-gray-950">{item.title}</h3>
          <p className="mt-1 text-sm font-semibold leading-5 text-gray-600">{item.detail}</p>
          {item.caption ? <p className="mt-2 rounded-xl bg-gray-50 p-3 text-sm font-semibold leading-5 text-gray-800">{item.caption}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-gray-500">
            <span>{item.authorName}</span>
            {item.teamName ? <span>· {item.teamName}</span> : null}
            {item.playerNames.length ? <span>· {item.playerNames.join(', ')}</span> : null}
            <span>· {formatSocialDate(item.createdAt)}</span>
          </div>
        </div>
      </div>

      {optimisticItem.media.length ? (
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          {optimisticItem.media.slice(0, 4).map((media) => (
            <div key={`${media.url}-${media.name || ''}`} className="overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
              {media.type === 'video' ? (
                <video src={media.url} controls className="h-48 w-full bg-black object-contain" />
              ) : (
                <img src={media.url} alt={media.name || optimisticItem.title} className="h-48 w-full object-cover" loading="lazy" />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="border-t border-gray-100 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {primaryHref ? (
            isExternal ? (
              <a href={primaryHref} target="_blank" rel="noreferrer" className="ghost-button !min-h-9 !px-3 text-xs">
                Open source
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : (
              <Link to={primaryHref} className="ghost-button !min-h-9 !px-3 text-xs">
                Open source
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )
          ) : null}
          <button
            type="button"
            className="ghost-button !min-h-9 !px-3 text-xs"
            disabled={!canPersist || likeBusy}
            onClick={() => runAction({
              actionKey: 'like',
              action: () => reactToSocialPost(item.id, auth.user!, 'like'),
              success: 'Liked the post.',
              optimistic: () => setOptimisticItem((current) => ({
                ...current,
                reactionCounts: {
                  ...current.reactionCounts,
                  like: Number(current.reactionCounts.like || 0) + 1
                }
              })),
              rollback: () => setOptimisticItem((current) => ({
                ...current,
                reactionCounts: {
                  ...current.reactionCounts,
                  like: Math.max(0, Number(current.reactionCounts.like || 0) - 1)
                }
              }))
            })}
            title={item.autoGenerated ? 'Open the source item before reacting.' : 'Like'}
          >
            {likeBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Heart className="h-4 w-4" aria-hidden="true" />}
            {likeCount}
          </button>
          {isAuthor ? (
            <button
              type="button"
              className="ghost-button !min-h-9 !px-3 text-xs text-rose-700"
              disabled={hideBusy}
              onClick={() => runAction({ actionKey: 'hide', action: () => hideSocialPost(item.id, auth.user!), success: 'Post hidden from your feed.' })}
            >
              {hideBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Flag className="h-4 w-4" aria-hidden="true" />}
              Hide
            </button>
          ) : canPersist ? (
            <button
              type="button"
              className="ghost-button !min-h-9 !px-3 text-xs"
              disabled={reportBusy}
              onClick={() => runAction({ actionKey: 'report', action: () => reportSocialPost(item.id, auth.user!), success: 'Post reported for review.' })}
            >
              {reportBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Flag className="h-4 w-4" aria-hidden="true" />}
              Report
            </button>
          ) : null}
        </div>
        {canPersist ? (
          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const submittedComment = comment.trim();
              runAction({
                actionKey: 'comment',
                action: () => commentOnSocialPost(item.id, auth.user!, submittedComment),
                success: 'Comment added.',
                optimistic: () => setOptimisticItem((current) => ({
                  ...current,
                  commentCount: Number(current.commentCount || 0) + 1
                })),
                rollback: () => setOptimisticItem((current) => ({
                  ...current,
                  commentCount: Math.max(0, Number(current.commentCount || 0) - 1)
                })),
                clearComment: true
              });
            }}
          >
            <input
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className="min-h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder={`Comment${commentCount ? ` · ${commentCount}` : ''}`}
            />
            <button type="submit" className="primary-button !min-h-10 !px-3 text-xs" disabled={!comment.trim() || commentBusy}>
              {commentBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Send'}
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function FriendsSection({
  auth,
  home,
  social,
  loading,
  onRefresh,
  onStatus
}: {
  auth: AuthState;
  home: ParentHomeModel;
  social: SocialHomeModel;
  loading: boolean;
  onRefresh: () => Promise<void> | void;
  onStatus: (status: { tone: 'error' | 'success'; message: string } | null) => void;
}) {
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<SocialFriend[]>([]);
  const [searching, setSearching] = useState(false);

  const knownFriend = (friend: SocialFriend) => [...social.friends, ...social.incomingRequests, ...social.outgoingRequests]
    .find((candidate) => candidate.userId === friend.userId) || friend;

  const runFriendAction = async (action: () => Promise<unknown> | void, success: string) => {
    onStatus(null);
    try {
      await action();
      await onRefresh();
      onStatus({ tone: 'success', message: success });
    } catch (error: any) {
      onStatus({ tone: 'error', message: error?.message || 'Unable to update friends.' });
    }
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth.user) return;
    setSearching(true);
    onStatus(null);
    try {
      setResults(await searchSocialUsers(auth.user, queryText, home));
    } catch (error: any) {
      onStatus({ tone: 'error', message: error?.message || 'Unable to search friends.' });
    } finally {
      setSearching(false);
    }
  };

  return (
    <section className="home-section-content space-y-3">
      <div className="app-card overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="app-label">Social</div>
          <h2 className="mt-1 app-section-title">Friends</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Find trusted families, approve requests, and choose who can see player moments.</p>
          <form className="mt-3 flex gap-2" onSubmit={handleSearch}>
            <input
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold outline-none focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
              placeholder="Search name, email, or team"
            />
            <button type="submit" className="primary-button !min-h-11 !px-3 text-xs" disabled={searching || queryText.trim().length < 2}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Search'}
            </button>
          </form>
        </div>

        <div className="grid gap-3 p-3 lg:grid-cols-2">
          {results.length ? (
            <FriendPanel title="Search results" count={results.length}>
              {results.map((friend) => (
                <FriendCard
                  key={`result-${friend.userId}`}
                  friend={knownFriend(friend)}
                  currentUserId={auth.user?.uid || ''}
                  onAdd={() => runFriendAction(() => sendFriendRequest(auth.user!, friend), 'Friend request sent.')}
                  onAccept={() => runFriendAction(() => respondToFriendRequest(friend.id, 'accepted'), 'Friend request accepted.')}
                  onDecline={() => runFriendAction(() => respondToFriendRequest(friend.id, 'declined'), 'Friend request declined.')}
                  onRemove={() => runFriendAction(() => removeFriend(friend.id), 'Friend removed.')}
                  onBlock={() => runFriendAction(() => blockFriend(friend.id, auth.user!.uid), 'Friend blocked.')}
                />
              ))}
            </FriendPanel>
          ) : null}

          {social.incomingRequests.length ? (
            <FriendPanel title="Needs response" count={social.incomingRequests.length} urgent>
              {social.incomingRequests.map((friend) => (
                <FriendCard
                  key={`incoming-${friend.id}`}
                  friend={friend}
                  currentUserId={auth.user?.uid || ''}
                  onAdd={() => runFriendAction(() => sendFriendRequest(auth.user!, friend), 'Friend request sent.')}
                  onAccept={() => runFriendAction(() => respondToFriendRequest(friend.id, 'accepted'), 'Friend request accepted.')}
                  onDecline={() => runFriendAction(() => respondToFriendRequest(friend.id, 'declined'), 'Friend request declined.')}
                  onRemove={() => runFriendAction(() => removeFriend(friend.id), 'Friend removed.')}
                  onBlock={() => runFriendAction(() => blockFriend(friend.id, auth.user!.uid), 'Friend blocked.')}
                />
              ))}
            </FriendPanel>
          ) : null}

          <FriendPanel title="Your friends" count={social.friends.length}>
            {social.friends.length ? social.friends.map((friend) => (
              <FriendCard
                key={`friend-${friend.id}`}
                friend={friend}
                currentUserId={auth.user?.uid || ''}
                onAdd={() => runFriendAction(() => sendFriendRequest(auth.user!, friend), 'Friend request sent.')}
                onAccept={() => runFriendAction(() => respondToFriendRequest(friend.id, 'accepted'), 'Friend request accepted.')}
                onDecline={() => runFriendAction(() => respondToFriendRequest(friend.id, 'declined'), 'Friend request declined.')}
                onRemove={() => runFriendAction(() => removeFriend(friend.id), 'Friend removed.')}
                onBlock={() => runFriendAction(() => blockFriend(friend.id, auth.user!.uid), 'Friend blocked.')}
              />
            )) : <EmptyFriendState title="No friends yet" detail="Search by email or add suggested parents from shared teams." />}
          </FriendPanel>

          <FriendPanel title="Suggested parents" count={social.suggestions.length}>
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
                Loading suggestions
              </div>
            ) : social.suggestions.length ? social.suggestions.map((friend) => (
              <FriendCard
                key={`suggestion-${friend.userId}`}
                friend={friend}
                currentUserId={auth.user?.uid || ''}
                onAdd={() => runFriendAction(() => sendFriendRequest(auth.user!, friend), 'Friend request sent.')}
                onAccept={() => runFriendAction(() => respondToFriendRequest(friend.id, 'accepted'), 'Friend request accepted.')}
                onDecline={() => runFriendAction(() => respondToFriendRequest(friend.id, 'declined'), 'Friend request declined.')}
                onRemove={() => runFriendAction(() => removeFriend(friend.id), 'Friend removed.')}
                onBlock={() => runFriendAction(() => blockFriend(friend.id, auth.user!.uid), 'Friend blocked.')}
              />
            )) : <EmptyFriendState title="No suggestions yet" detail="Suggestions appear when other parents share one of your teams." />}
          </FriendPanel>

          {social.outgoingRequests.length ? (
            <FriendPanel title="Pending sent" count={social.outgoingRequests.length}>
              {social.outgoingRequests.map((friend) => (
                <FriendCard
                  key={`outgoing-${friend.id}`}
                  friend={friend}
                  currentUserId={auth.user?.uid || ''}
                  onAdd={() => runFriendAction(() => sendFriendRequest(auth.user!, friend), 'Friend request sent.')}
                  onAccept={() => runFriendAction(() => respondToFriendRequest(friend.id, 'accepted'), 'Friend request accepted.')}
                  onDecline={() => runFriendAction(() => respondToFriendRequest(friend.id, 'declined'), 'Friend request declined.')}
                  onRemove={() => runFriendAction(() => removeFriend(friend.id), 'Friend removed.')}
                  onBlock={() => runFriendAction(() => blockFriend(friend.id, auth.user!.uid), 'Friend blocked.')}
                />
              ))}
            </FriendPanel>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function FriendPanel({ title, count, urgent = false, children }: { title: string; count: number; urgent?: boolean; children: ReactNode }) {
  return (
    <section className={`rounded-xl border p-3 ${urgent ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={`text-sm font-black ${urgent ? 'text-amber-950' : 'text-gray-950'}`}>{title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${urgent ? 'bg-amber-200 text-amber-950' : 'bg-white text-gray-700'}`}>{count}</span>
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function FriendCard({
  friend,
  currentUserId,
  onAdd,
  onAccept,
  onDecline,
  onRemove,
  onBlock
}: {
  friend: SocialFriend;
  currentUserId: string;
  onAdd: () => Promise<void> | void;
  onAccept: () => Promise<void> | void;
  onDecline: () => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  onBlock: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState('');
  const incoming = friend.status === 'pending' && friend.recipientId === currentUserId;
  const outgoing = friend.status === 'pending' && friend.requesterId === currentUserId;
  const run = async (label: string, action: () => Promise<void> | void) => {
    setBusy(label);
    try {
      await action();
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-start gap-3">
        {friend.photoUrl ? (
          <img src={friend.photoUrl} alt="" className="h-10 w-10 flex-none rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gray-950 text-xs font-black text-white">{getFriendInitials(friend.name)}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-gray-950">{friend.name}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{friend.email || 'ALL PLAYS parent'}</div>
          {friend.sharedTeamNames.length ? <div className="mt-1 truncate text-xs font-bold text-primary-700">{friend.sharedTeamNames.join(' · ')}</div> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {friend.status === 'accepted' ? (
          <>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">Friend</span>
            <button type="button" className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700" disabled={Boolean(busy)} onClick={() => run('remove', onRemove)}>
              {busy === 'remove' ? 'Removing...' : 'Remove'}
            </button>
            <button type="button" className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700" disabled={Boolean(busy)} onClick={() => run('block', onBlock)}>
              {busy === 'block' ? 'Blocking...' : 'Block'}
            </button>
          </>
        ) : incoming ? (
          <>
            <button type="button" className="rounded-full bg-primary-600 px-2.5 py-1 text-xs font-black text-white" disabled={Boolean(busy)} onClick={() => run('accept', onAccept)}>
              {busy === 'accept' ? 'Accepting...' : 'Accept'}
            </button>
            <button type="button" className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700" disabled={Boolean(busy)} onClick={() => run('decline', onDecline)}>
              {busy === 'decline' ? 'Declining...' : 'Decline'}
            </button>
          </>
        ) : outgoing ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700">Request sent</span>
        ) : friend.status === 'blocked' ? (
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700">Blocked</span>
        ) : (
          <button type="button" className="rounded-full bg-primary-600 px-2.5 py-1 text-xs font-black text-white" disabled={Boolean(busy)} onClick={() => run('add', onAdd)}>
            {busy === 'add' ? 'Sending...' : 'Add friend'}
          </button>
        )}
      </div>
    </div>
  );
}

function SocialComposerModal({
  home,
  social,
  initialType,
  onClose,
  onSubmit
}: {
  home: ParentHomeModel;
  social: SocialHomeModel;
  initialType: SocialPostType;
  onClose: () => void;
  onSubmit: (input: CreateSocialPostInput) => Promise<void> | void;
}) {
  const initialPreset = getSocialPostPresetForType(initialType);
  const [presetId, setPresetId] = useState(initialPreset.id);
  const activePreset = socialPostPresets.find((preset) => preset.id === presetId) || initialPreset;
  const type = activePreset.type;
  const [visibility, setVisibility] = useState<SocialVisibility>(activePreset.defaultVisibility);
  const [teamId, setTeamId] = useState(home.teams[0]?.teamId || '');
  const [playerKey, setPlayerKey] = useState(initialPreset.prefersPlayer && home.players[0] ? `${home.players[0].teamId}::${home.players[0].playerId}` : '');
  const [playerTaggingEnabled, setPlayerTaggingEnabled] = useState(initialPreset.prefersPlayer);
  const [caption, setCaption] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(initialType === 'manual_post');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  const supportsOptionalPlayerTagging = type === 'game_recap' || type === 'team_media' || type === 'practice_packet';
  const playerSelectionEnabled = activePreset.prefersPlayer || playerTaggingEnabled;
  const fallbackPlayer = home.players.find((player) => player.teamId === teamId) || home.players[0] || null;
  const selectedPlayer = playerSelectionEnabled
    ? home.players.find((player) => `${player.teamId}::${player.playerId}` === playerKey) || (activePreset.prefersPlayer ? fallbackPlayer : null)
    : null;
  const selectedTeam = playerSelectionEnabled && selectedPlayer
    ? home.teams.find((team) => team.teamId === selectedPlayer.teamId) || home.teams.find((team) => team.teamId === teamId) || home.teams[0] || null
    : home.teams.find((team) => team.teamId === teamId) || home.teams[0] || null;
  const suggestedTitle = getComposerSuggestedTitle(type, selectedTeam, selectedPlayer);
  const visibleUserIds = visibility === 'friends' || visibility === 'friends_and_team'
    ? social.friends.map((friend) => friend.userId)
    : [];
  const subjectLabel = playerSelectionEnabled && selectedPlayer
    ? `${selectedPlayer.playerName} · ${selectedPlayer.teamName}`
    : selectedTeam?.teamName || 'Choose team';

  const selectPreset = (nextPresetId: typeof presetId) => {
    const nextPreset = socialPostPresets.find((preset) => preset.id === nextPresetId);
    if (!nextPreset) return;
    setPresetId(nextPreset.id);
    setVisibility(nextPreset.defaultVisibility);
    setLocalError('');
    setPlayerTaggingEnabled(nextPreset.prefersPlayer);
    if (nextPreset.prefersPlayer) {
      const nextPlayer = home.players.find((player) => `${player.teamId}::${player.playerId}` === playerKey) || home.players[0] || null;
      if (nextPlayer) {
        setPlayerKey(`${nextPlayer.teamId}::${nextPlayer.playerId}`);
        setTeamId(nextPlayer.teamId);
      }
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    setSubmitting(true);
    try {
      if (activePreset.requiresMedia && !mediaFile) {
        throw new Error('Add a photo or video for this share.');
      }
      if (!caption.trim() && !mediaFile) {
        throw new Error('Add a short note or attach a photo/video.');
      }
      const media = mediaFile ? [await uploadSocialPostMedia(selectedTeam?.teamId || teamId, mediaFile)] : [];
      await onSubmit({
        type,
        visibility,
        title: suggestedTitle,
        detail: getComposerDetail(type, selectedTeam, selectedPlayer),
        caption: caption.trim(),
        teamId: selectedTeam?.teamId || teamId || null,
        teamName: selectedTeam?.teamName || null,
        playerIds: selectedPlayer ? [selectedPlayer.playerId] : [],
        playerNames: selectedPlayer ? [selectedPlayer.playerName] : [],
        sourceType: selectedPlayer ? 'player' : selectedTeam ? 'team' : 'manual',
        sourceId: selectedPlayer?.playerId || selectedTeam?.teamId || null,
        route: getComposerRoute(type, selectedTeam, selectedPlayer),
        media,
        visibleUserIds
      });
    } catch (error: any) {
      setLocalError(error?.message || 'Unable to create post.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal overlayClassName="z-[70] flex items-end justify-center bg-gray-950/45 p-3 sm:items-center" ariaLabel="Create social post" onClose={onClose}>
      <form className="social-composer-modal app-card w-full max-w-xl overflow-hidden" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            <div className="app-label">Share</div>
            <h2 className="mt-1 app-section-title">What happened?</h2>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="max-h-[72dvh] space-y-4 overflow-y-auto p-4">
          {localError ? <Status tone="error" message={localError} /> : null}

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white text-primary-700 ring-1 ring-gray-200">
                <SocialTypeIcon type={activePreset.type} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black text-gray-950">{activePreset.label}</div>
                <div className="mt-0.5 text-xs font-semibold leading-5 text-gray-600">{activePreset.detail}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-primary-700 ring-1 ring-primary-100" onClick={() => setTypePickerOpen((value) => !value)}>
                Change share type
              </button>
              <button type="button" className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-gray-700 ring-1 ring-gray-200" onClick={() => setDetailsOpen((value) => !value)}>
                {subjectLabel}
              </button>
              <button type="button" className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-primary-700 ring-1 ring-primary-100" onClick={() => setDetailsOpen((value) => !value)}>
                {getSocialVisibilityLabel(visibility)}
              </button>
            </div>
          </div>

          {typePickerOpen ? (
            <div>
              <div className="mb-2 text-xs font-black uppercase tracking-[0.04em] text-gray-500">Pick one</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {socialPostPresets.map((preset) => {
                  const active = preset.id === activePreset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`min-h-[82px] rounded-xl border p-2 text-left transition ${active ? 'border-primary-300 bg-primary-50 text-primary-950 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-primary-200'}`}
                      onClick={() => selectPreset(preset.id)}
                      aria-pressed={active}
                    >
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
                        <SocialTypeIcon type={preset.type} />
                      </span>
                      <span className="mt-2 block text-xs font-black leading-4">{preset.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {detailsOpen ? (
            <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Audience</span>
                <select value={visibility} onChange={(event) => setVisibility(event.target.value as SocialVisibility)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
                  {socialVisibilityOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Team</span>
                <select value={selectedTeam?.teamId || teamId} onChange={(event) => setTeamId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
                  {home.teams.length ? home.teams.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>) : <option value="">No team linked</option>}
                </select>
              </label>
              {supportsOptionalPlayerTagging ? (
                <div className="block sm:col-span-2">
                  <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Optional</span>
                  <div className="mt-1 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-black text-gray-950">Tag a player</div>
                        <div className="mt-0.5 text-xs font-semibold text-gray-500">Keep this team-first unless you explicitly want to tag one player.</div>
                      </div>
                      <button
                        type="button"
                        className={`rounded-full px-3 py-1.5 text-xs font-black ${playerTaggingEnabled ? 'bg-primary-600 text-white' : 'bg-white text-primary-700 ring-1 ring-primary-100'}`}
                        onClick={() => {
                          if (playerTaggingEnabled) {
                            setPlayerTaggingEnabled(false);
                            return;
                          }
                          const nextPlayer = home.players.find((player) => player.teamId === (selectedTeam?.teamId || teamId)) || home.players[0] || null;
                          if (nextPlayer) {
                            setPlayerKey(`${nextPlayer.teamId}::${nextPlayer.playerId}`);
                            setTeamId(nextPlayer.teamId);
                          }
                          setPlayerTaggingEnabled(true);
                        }}
                      >
                        {playerTaggingEnabled ? 'Remove player tag' : 'Tag a player'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {playerSelectionEnabled ? (
                <label className="block sm:col-span-2">
                  <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Player</span>
                  <select
                    value={playerKey}
                    onChange={(event) => {
                      const nextKey = event.target.value;
                      setPlayerKey(nextKey);
                      const nextPlayer = home.players.find((player) => `${player.teamId}::${player.playerId}` === nextKey);
                      if (nextPlayer?.teamId) setTeamId(nextPlayer.teamId);
                    }}
                    className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  >
                    {activePreset.prefersPlayer ? null : <option value="">Choose player</option>}
                    {home.players.map((player) => <option key={`${player.teamId}-${player.playerId}`} value={`${player.teamId}::${player.playerId}`}>{player.playerName} · {player.teamName}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}

          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Write one short note</span>
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={4} placeholder={activePreset.prompt} className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-base font-semibold leading-6 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
          </label>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {activePreset.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="min-h-8 flex-none rounded-full bg-gray-100 px-3 text-xs font-black text-gray-700 transition hover:bg-primary-50 hover:text-primary-800"
                onClick={() => setCaption(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>

          <label className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 ${mediaFile ? 'border-primary-300 bg-primary-50' : 'border-gray-300 bg-gray-50'}`}>
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white text-primary-700 ring-1 ring-gray-200">
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-gray-950">{mediaFile ? mediaFile.name : activePreset.requiresMedia ? 'Choose photo or video' : 'Add photo or video'}</span>
              <span className="mt-0.5 block text-xs font-semibold text-gray-500">{mediaFile ? 'Ready to share.' : 'Optional unless this is a media post.'}</span>
            </span>
            <input type="file" accept="image/*,video/*" className="sr-only" onChange={(event) => setMediaFile(event.target.files?.[0] || null)} />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <button type="button" className="ghost-button !min-h-10 !px-3 text-sm" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="primary-button !min-h-10 !px-4 text-sm" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
            Post
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MiniMetric({ label, value, urgent = false }: { label: string; value: number; urgent?: boolean }) {
  return (
    <div className={`rounded-xl border px-2 py-2 ${urgent ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className={`text-base font-black ${urgent ? 'text-amber-800' : 'text-gray-950'}`}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{label}</div>
    </div>
  );
}

function EmptyFriendState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-center">
      <UserPlus className="mx-auto h-7 w-7 text-gray-300" aria-hidden="true" />
      <div className="mt-2 text-sm font-black text-gray-900">{title}</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">{detail}</div>
    </div>
  );
}

function SocialTypeIcon({ type }: { type: SocialPostType }) {
  if (type === 'player_moment' || type === 'achievement') return <Trophy className="h-5 w-5" aria-hidden="true" />;
  if (type === 'team_media') return <ImagePlus className="h-5 w-5" aria-hidden="true" />;
  if (type === 'practice_packet') return <ClipboardCheck className="h-5 w-5" aria-hidden="true" />;
  if (type === 'game_recap' || type === 'upcoming_game') return <CalendarDays className="h-5 w-5" aria-hidden="true" />;
  return <Newspaper className="h-5 w-5" aria-hidden="true" />;
}

function getComposerSuggestedTitle(type: SocialPostType, team: ParentHomeTeam | null, player: ParentHomePlayer | null) {
  if (type === 'player_moment') return player ? `${player.playerName} moment` : 'Player moment';
  if (type === 'achievement') return player ? `${player.playerName} achievement` : 'Player achievement';
  if (type === 'game_recap') return team ? `${team.teamName} game recap` : 'Game recap';
  if (type === 'team_media') return team ? `${team.teamName} team photo` : 'Team photo';
  if (type === 'practice_packet') return team ? `${team.teamName} practice packet` : 'Practice packet';
  if (type === 'upcoming_game') return team ? `${team.teamName} upcoming game` : 'Upcoming game';
  return team ? `${team.teamName} update` : 'ALL PLAYS update';
}

function getComposerDetail(type: SocialPostType, team: ParentHomeTeam | null, player: ParentHomePlayer | null) {
  const subject = player?.playerName || team?.teamName || 'ALL PLAYS';
  const teamName = team?.teamName ? ` · ${team.teamName}` : '';
  return `${getSocialTypeLabel(type)} · ${subject}${player ? teamName : ''}`;
}

function getComposerRoute(type: SocialPostType, team: ParentHomeTeam | null, player: ParentHomePlayer | null) {
  if (player) return getPlayerDetailPath(player.teamId, player.playerId);
  if (team && (type === 'team_media' || type === 'manual_post' || type === 'upcoming_game')) return getTeamHomePath(team.teamId);
  if (team && (type === 'game_recap' || type === 'practice_packet')) return `/schedule?teamId=${encodeURIComponent(team.teamId)}`;
  return '/home?section=feed';
}

function getFriendInitials(name: string) {
  return String(name || 'AP').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'AP';
}

function formatSocialDate(date: Date) {
  const now = Date.now();
  const time = date.getTime();
  if (!Number.isFinite(time)) return '';
  const diffMinutes = Math.max(0, Math.round((now - time) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function PulseChip({ icon: Icon, label, value, urgent = false }: { icon: LucideIcon; label: string; value: string; urgent?: boolean }) {
  return (
    <div className={`flex min-h-8 flex-none items-center gap-1.5 rounded-full border px-2.5 text-xs font-black ${urgent ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
      <Icon className={`h-3.5 w-3.5 ${urgent ? 'text-amber-700' : 'text-primary-600'}`} aria-hidden="true" />
      <span>{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${urgent ? 'bg-amber-200/70 text-amber-950' : 'bg-white text-gray-950'}`}>{value}</span>
    </div>
  );
}

function TopAction({ action }: { action: ParentHomeAction }) {
  const Icon = actionIcons[action.kind];
  return (
    <Link to={action.to} className={`flex min-h-8 max-w-[250px] flex-none items-center gap-1.5 rounded-full border px-2.5 text-xs font-black ${actionToneClasses[action.tone]}`}>
      <Icon className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
      <span className="flex-none uppercase tracking-[0.04em] opacity-80">Do</span>
      <span className="truncate text-gray-950">{action.title}</span>
      <ChevronRight className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
    </Link>
  );
}

function ActionRow({ action }: { action: ParentHomeAction }) {
  const Icon = actionIcons[action.kind];
  return (
    <Link to={action.to} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
      <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl border ${actionToneClasses[action.tone]}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-gray-950">{action.title}</div>
        <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{action.detail}</div>
      </div>
      <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </Link>
  );
}

function PlayerCard({ player }: { player: ParentHomePlayer }) {
  const actionCount = player.rsvpNeeded + player.packetsReady + player.openAssignments + (player.unreadCount > 0 ? 1 : 0);
  return (
    <Link to={getPlayerDetailPath(player.teamId, player.playerId)} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
      <PlayerAvatar name={player.playerName} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-black text-gray-950">{player.playerName}</div>
          {actionCount > 0 ? <span className="flex-none rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">{actionCount}</span> : null}
        </div>
        <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{player.teamName || 'Team'}</div>
        <div className="mt-1 truncate text-xs font-bold text-gray-600">{player.nextEvent ? `${formatEventDateLabel(player.nextEvent.date)} · ${getScheduleTitle(player.nextEvent)}` : 'No upcoming events'}</div>
      </div>
      <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </Link>
  );
}

function TeamCard({ team }: { team: ParentHomeTeam }) {
  return (
    <Link to={getTeamHomePath(team.teamId)} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50/40" aria-label={`Open ${team.teamName} in My Teams`}>
      <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
        <Trophy className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-black text-gray-950">{team.teamName}</div>
          {team.unreadCount > 0 ? <span className="flex-none rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-black text-white">{team.unreadCount}</span> : null}
        </div>
        <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">
          {team.players.length ? team.players.map((player) => player.playerName).join(', ') : `${team.role}${team.sport ? ` · ${team.sport}` : ''}`}
        </div>
        <div className="mt-1 truncate text-xs font-bold text-gray-600">{team.nextEvent ? `${formatEventDateLabel(team.nextEvent.date)} · ${getScheduleTitle(team.nextEvent)}` : `${team.role} · ${team.eventCount} events`}</div>
      </div>
      <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </Link>
  );
}

function HomeEventCard({ event }: { event: ParentScheduleEvent }) {
  const rsvp = normalizeRsvpResponse(event.myRsvp);
  const openAssignments = getOpenScheduleAssignments(event.assignments).length;
  return (
    <Link to={getEventDetailPath(event)} className="app-card block p-3 transition hover:border-primary-200 hover:shadow-app-lg">
      <div className="flex items-start gap-3">
        <DateTile date={event.date} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-black uppercase tracking-[0.04em] text-gray-500">{event.teamName}</span>
            <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${event.type === 'practice' ? 'bg-amber-100 text-amber-800' : 'bg-primary-100 text-primary-800'}`}>{event.type}</span>
          </div>
          <h3 className="mt-1 truncate text-base font-black text-gray-950">{getScheduleTitle(event)}</h3>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{formatEventTimeLabel(event.date)} · {event.location || 'TBD'}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${rsvpBadgeClasses[rsvp]}`}>{rsvp === 'not_responded' ? 'RSVP' : rsvp.replace('_', ' ')}</span>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-600">{event.childName}</span>
            {event.practiceHomePacketSummary ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-blue-700">Packet</span> : null}
            {openAssignments ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-emerald-700">{openAssignments} tasks</span> : null}
          </div>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 flex-none text-gray-400" aria-hidden="true" />
      </div>
    </Link>
  );
}

function DateTile({ date }: { date: Date }) {
  return (
    <div className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-xl bg-gray-50 shadow-inner ring-1 ring-gray-200">
      <div className="text-[10px] font-black uppercase leading-none tracking-[0.06em] text-gray-500">{date.toLocaleDateString('en-US', { month: 'short' })}</div>
      <div className="mt-0.5 text-lg font-black leading-none text-gray-950">{date.getDate()}</div>
      <div className="mt-0.5 text-[10px] font-black uppercase leading-none tracking-[0.06em] text-gray-500">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
    </div>
  );
}

function PlayerAvatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P';
  return (
    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-950 text-sm font-black text-white shadow-sm">
      {initials}
    </div>
  );
}

function EmptyCard({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <section className="app-card p-5 text-center">
      <Icon className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-900">{title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div>
    </section>
  );
}

function HomeLoadErrorState({ error, onRetry, retrying }: { error: AppServiceError | null; onRetry: () => void; retrying: boolean }) {
  const copy = getHomeLoadErrorStateCopy(error);
  return (
    <section className="app-card p-5 text-center">
      <AlertCircle className="mx-auto h-8 w-8 text-rose-400" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-900">{copy.title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{copy.detail}</div>
      <button type="button" className="primary-button mx-auto mt-4 !min-h-10 !px-4 text-sm" onClick={onRetry} disabled={retrying} aria-label="Retry loading Home">
        {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
        Retry
      </button>
    </section>
  );
}

function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}

function getAsyncErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function getHomeLoadErrorMessage(error: AppServiceError, hasExistingHome: boolean) {
  if (hasExistingHome) {
    if (error.type === 'network') return 'Unable to refresh Home while offline. Showing the last loaded Home.';
    if (error.type === 'permission') return 'Unable to refresh Home because access was denied. Showing the last loaded Home.';
    if (error.type === 'not_found') return 'Unable to refresh Home because the requested data was not found. Showing the last loaded Home.';
    if (error.type === 'validation') return error.message;
    return 'Unable to refresh Home. Showing the last loaded Home. Try again.';
  }
  if (error.type === 'network') return 'Unable to load Home while offline. Check your connection and try again.';
  if (error.type === 'permission') return 'You do not have permission to load this Home data.';
  if (error.type === 'not_found') return 'Home data was not found. Try again or check the linked team access.';
  if (error.type === 'validation') return error.message;
  return getAsyncErrorMessage(error, 'Unable to load Home. Try again.');
}

function getHomeSecondaryErrorMessage(error: AppServiceError) {
  if (error.type === 'network') return 'Home details could not refresh while offline.';
  if (error.type === 'permission') return 'Home details could not refresh because access was denied.';
  if (error.type === 'not_found') return 'Home details could not refresh because some data was not found.';
  if (error.type === 'validation') return error.message;
  return getAsyncErrorMessage(error, 'Unable to refresh Home details.');
}

function getHomeLoadErrorStateCopy(error: AppServiceError | null) {
  if (error?.type === 'network') {
    return {
      title: 'Home could not connect',
      detail: 'Check your connection and try loading Home again.'
    };
  }
  if (error?.type === 'permission') {
    return {
      title: 'Home access is blocked',
      detail: 'Your account does not have permission to load this Home data.'
    };
  }
  if (error?.type === 'not_found') {
    return {
      title: 'Home data was not found',
      detail: 'The linked Home data is missing. Try again after refreshing your team access.'
    };
  }
  if (error?.type === 'validation') {
    return {
      title: 'Home request needs attention',
      detail: error.message
    };
  }
  return {
    title: 'Home could not load',
    detail: 'Try loading Home again to restore your dashboard.'
  };
}
