import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Award,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Code2,
  Copy,
  DollarSign,
  Dumbbell,
  ExternalLink,
  ImageIcon,
  LinkIcon,
  Loader2,
  MessageCircle,
  Radio,
  Save,
  Settings,
  Shield,
  SlidersHorizontal,
  Ticket,
  Trophy,
  UserRound,
  Users,
  Zap
} from 'lucide-react';
import { AvatarImage } from '../components/AvatarImage';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { TeamDetailPageSkeleton } from '../components/PageSkeletons';
import { DetailLoadErrorState } from '../components/DetailLoadErrorState';
import { copyPublicText, openPublicUrl, sharePublicUrl } from '../lib/publicActions';
import { isRetryableAppServiceError, toAppServiceError, type AppServiceError } from '../lib/appErrors';
import { useAppAsyncOperation } from '../lib/useAsyncOperation';
import { getEventDetailPath } from '../lib/homeLogic';
import { buildPrivateTeamCalendarFeedUrl, getAppleCalendarFeedUrl, getGoogleCalendarFeedUrl } from '../lib/parentToolsService';
import { createStaffRsvpReminderPreviewLoader, loadParentSchedule, sendStaffRsvpReminder, type StaffRsvpReminderSendResult } from '../lib/scheduleService';
import type { ParentScheduleEvent, StaffRsvpReminderPreview } from '../lib/scheduleLogic';
import { buildPublicTeamGamesIcsUrl, canExposePublicFanFeed, createStatTrackerConfigForApp, grantScorekeeperAccessForApp, grantTeamMediaManagerAccessForApp, grantVideographerAccessForApp, inviteTeamAdminForApp, loadParentTeamDetail, loadParentTeamDetailBootstrap, loadTeamDetailInsights, loadTeamDetailSponsors, loadTeamRosterParentInvites, loadTeamStaffPermissions, loadTeamTrackingAdmin, revokeScorekeeperAccessForApp, revokeTeamAdminAccessForApp, revokeTeamMediaManagerAccessForApp, revokeVideographerAccessForApp, saveTeamScheduleNotificationsForApp, updateStatTrackerConfigForApp, type InviteTeamAdminForAppResult, type TeamDetailEvent, type TeamDetailModel, type TeamRosterParentInviteSummary, type TeamScorekeeperGrantTarget, type TeamTrackingAdminItem } from '../lib/teamDetailService';
import { buildStatTrackerConfigPayload, createBlankStatTrackerConfigColumnDraft, createEmptyStatTrackerConfigDraft, createStatTrackerConfigDraft, createStatTrackerConfigDraftFromPreset, getStatTrackerConfigPresetCatalog, validateStatTrackerConfigDraft, type StatTrackerConfigDraft } from '../lib/statTrackerConfigEditor';
import { useViewLoadTimer } from '../lib/viewLoadTiming';
import { buildTeamDetailNavigation, type TeamNavigationItem, type TeamNavigationSection } from '../lib/teamNavigation';
import type { AuthState } from '../lib/types';
import { InviteResultCard } from './parent-tools/shared';
import { loadInsightsTab } from './team-detail/insightsTabLoader';
import { loadRosterTab } from './team-detail/rosterTabLoader';

type TeamTab = 'overview' | 'schedule' | 'roster' | 'insights' | 'more';

const initialStandingsRowLimit = 5;

const tabs: Array<{ id: TeamTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: Trophy },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'more', label: 'More', icon: Ticket }
];

function getTeamTabFromSearch(search: string): TeamTab {
  const nextTab = new URLSearchParams(search).get('tab');
  if (nextTab === 'schedule' || nextTab === 'roster' || nextTab === 'insights' || nextTab === 'more') {
    return nextTab;
  }
  return 'overview';
}

function resetTeamTabScrollPosition() {
  try {
    window.scrollTo({ top: 0, behavior: 'auto' });
  } catch {
    // jsdom does not implement scrollTo; real browsers and WebViews do.
  }
}

function scheduleTeamTabScrollPositionReset() {
  if (typeof window.requestAnimationFrame !== 'function') {
    resetTeamTabScrollPosition();
    return () => {};
  }

  let resetFrame: number | null = null;
  const restorationFrame = window.requestAnimationFrame(() => {
    resetFrame = window.requestAnimationFrame(resetTeamTabScrollPosition);
  });

  return () => {
    window.cancelAnimationFrame(restorationFrame);
    if (resetFrame !== null) {
      window.cancelAnimationFrame(resetFrame);
    }
  };
}

export function TeamDetail({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const authUserId = auth.user?.uid || '';
  const [model, setModel] = useState<TeamDetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppServiceError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [rosterTabRetryVersion, setRosterTabRetryVersion] = useState(0);
  const LazyRosterTab = useMemo(() => {
    void rosterTabRetryVersion;
    return lazy(loadRosterTab);
  }, [rosterTabRetryVersion]);
  const [insightsTabRetryVersion, setInsightsTabRetryVersion] = useState(0);
  const LazyInsightsTab = useMemo(() => {
    void insightsTabRetryVersion;
    return lazy(loadInsightsTab);
  }, [insightsTabRetryVersion]);
  const activeTab = getTeamTabFromSearch(location.search);
  const [staffPermissionsLoading, setStaffPermissionsLoading] = useState(false);
  const [staffPermissionsError, setStaffPermissionsError] = useState('');
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [insightsLoaded, setInsightsLoaded] = useState(false);
  const [insightsReloadVersion, setInsightsReloadVersion] = useState(0);
  const [sponsorsLoading, setSponsorsLoading] = useState(false);
  const [sponsorsError, setSponsorsError] = useState('');
  const [sponsorsLoaded, setSponsorsLoaded] = useState(false);
  const [rosterInviteLoading, setRosterInviteLoading] = useState(false);
  const [rosterInviteError, setRosterInviteError] = useState('');
  const [rosterInviteAttempted, setRosterInviteAttempted] = useState(false);
  const [rosterInviteSummaries, setRosterInviteSummaries] = useState<Record<string, TeamRosterParentInviteSummary>>({});
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [trackingAttempted, setTrackingAttempted] = useState(false);
  const [trackingItems, setTrackingItems] = useState<TeamTrackingAdminItem[]>([]);
  const [detailCollectionsLoaded, setDetailCollectionsLoaded] = useState(false);
  const [detailCollectionsLoading, setDetailCollectionsLoading] = useState(false);
  const [detailCollectionsError, setDetailCollectionsError] = useState('');
  const [detailCollectionsReloadVersion, setDetailCollectionsReloadVersion] = useState(0);
  const [authoritativeUpcomingCount, setAuthoritativeUpcomingCount] = useState<number | null>(null);
  const authUserRef = useRef(auth.user);
  const activeTabRef = useRef(activeTab);
  const detailCollectionsLoadingRef = useRef(detailCollectionsLoading);
  const staffPermissionsLoadingRef = useRef(staffPermissionsLoading);
  const insightsLoadingRef = useRef(insightsLoading);
  const sponsorsLoadingRef = useRef(sponsorsLoading);
  const hasTeamModel = Boolean(model);
  const canManageTeam = Boolean(model?.canManageTeam);
  const hasStaffPermissions = Boolean(model?.staffPermissions);

  useEffect(() => {
    setAuthoritativeUpcomingCount(null);
  }, [teamId]);

  useEffect(() => {
    authUserRef.current = auth.user;
    activeTabRef.current = activeTab;
    detailCollectionsLoadingRef.current = detailCollectionsLoading;
    staffPermissionsLoadingRef.current = staffPermissionsLoading;
    insightsLoadingRef.current = insightsLoading;
    sponsorsLoadingRef.current = sponsorsLoading;
  });

  function navigateToTab(nextTab: TeamTab) {
    if (nextTab === activeTab) return;

    // Reset while the current (possibly tall) tab still owns the document
    // height. WebKit can otherwise preserve the old scroll range when a
    // smooth reset races the shorter tab's render.
    resetTeamTabScrollPosition();

    const nextParams = new URLSearchParams(location.search);
    if (nextTab === 'overview') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', nextTab);
    }

    const nextSearch = nextParams.toString();
    if (nextTab === 'insights' && insightsError && !insightsLoadingRef.current) {
      setInsightsReloadVersion((version) => version + 1);
    }
    navigate({
      pathname: location.pathname,
      search: nextSearch ? `?${nextSearch}` : ''
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!teamId) return;
      setLoading(true);
      setError(null);
      try {
        const shouldHydrateOverviewCollections = activeTabRef.current === 'overview' || activeTabRef.current === 'insights';
        const nextModel = shouldHydrateOverviewCollections
          ? await loadParentTeamDetail(teamId, authUserRef.current, { includeDeferredData: false })
          : await loadParentTeamDetailBootstrap(teamId, authUserRef.current);
        if (!cancelled) {
          setModel(nextModel);
          setDetailCollectionsLoaded(shouldHydrateOverviewCollections);
          setDetailCollectionsLoading(false);
          setDetailCollectionsError('');
          setDetailCollectionsReloadVersion(0);
          setStaffPermissionsError('');
          setStaffPermissionsLoading(false);
          setInsightsLoading(false);
          setInsightsError('');
          setInsightsLoaded(false);
          setInsightsReloadVersion(0);
          setSponsorsLoading(false);
          setSponsorsError('');
          setSponsorsLoaded(false);
          setRosterInviteLoading(false);
          setRosterInviteError('');
          setRosterInviteAttempted(false);
          setRosterInviteSummaries({});
          setTrackingLoading(false);
          setTrackingError('');
          setTrackingAttempted(false);
          setTrackingItems([]);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setError(toAppServiceError(loadError, 'Unable to load this team.'));
          setModel(null);
          setDetailCollectionsLoaded(false);
          setDetailCollectionsLoading(false);
          setDetailCollectionsError('');
          setDetailCollectionsReloadVersion(0);
          setStaffPermissionsError('');
          setStaffPermissionsLoading(false);
          setInsightsLoading(false);
          setInsightsError('');
          setInsightsLoaded(false);
          setSponsorsLoading(false);
          setSponsorsError('');
          setSponsorsLoaded(false);
          setRosterInviteLoading(false);
          setRosterInviteError('');
          setRosterInviteAttempted(false);
          setRosterInviteSummaries({});
          setTrackingLoading(false);
          setTrackingError('');
          setTrackingAttempted(false);
          setTrackingItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [authUserId, teamId, reloadVersion]);

  useEffect(() => {
    let cancelled = false;
    async function loadDeferredTeamCollections() {
      if (!teamId || !hasTeamModel || detailCollectionsLoaded || detailCollectionsLoadingRef.current || detailCollectionsError || activeTab !== 'more') return;
      setDetailCollectionsLoading(true);
      setDetailCollectionsError('');
      try {
        const nextModel = await loadParentTeamDetail(teamId, authUserRef.current, { includeDeferredData: false });
        if (!cancelled) {
          setModel((currentModel) => currentModel ? {
            ...nextModel,
            leaderboards: currentModel.leaderboards,
            trackingSummaries: currentModel.trackingSummaries,
            sponsors: currentModel.sponsors,
            staffPermissions: currentModel.staffPermissions || nextModel.staffPermissions
          } : nextModel);
          setDetailCollectionsLoaded(true);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setDetailCollectionsError(loadError?.message || 'Unable to load team schedule and settings.');
        }
      } finally {
        if (!cancelled) setDetailCollectionsLoading(false);
      }
    }

    void loadDeferredTeamCollections();
    return () => {
      cancelled = true;
    };
  }, [activeTab, authUserId, detailCollectionsError, detailCollectionsLoaded, detailCollectionsReloadVersion, hasTeamModel, teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadStaffPermissionsForMoreTab() {
      if (!teamId || activeTab !== 'more' || !canManageTeam || hasStaffPermissions || staffPermissionsLoadingRef.current) return;
      setStaffPermissionsLoading(true);
      setStaffPermissionsError('');
      try {
        const staffPermissions = await loadTeamStaffPermissions(teamId, authUserRef.current);
        if (!cancelled) {
          setModel((currentModel) => currentModel ? { ...currentModel, staffPermissions } : currentModel);
        }
      } catch (loadError: any) {
        if (!cancelled) setStaffPermissionsError(loadError?.message || 'Unable to load team staff permissions.');
      } finally {
        if (!cancelled) setStaffPermissionsLoading(false);
      }
    }

    void loadStaffPermissionsForMoreTab();
    return () => {
      cancelled = true;
    };
  }, [activeTab, authUserId, canManageTeam, hasStaffPermissions, teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadInsightsForTab() {
      if (!teamId || !hasTeamModel || insightsLoaded || insightsLoadingRef.current) return;
      setInsightsLoading(true);
      setInsightsError('');
      try {
        const insights = await loadTeamDetailInsights(teamId, authUserRef.current);
        if (!cancelled) {
          setModel((currentModel) => currentModel ? { ...currentModel, ...insights } : currentModel);
          setInsightsLoaded(true);
        }
      } catch (loadError: any) {
        if (!cancelled) setInsightsError(loadError?.message || 'Unable to load team insights.');
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    }

    void loadInsightsForTab();
    return () => {
      cancelled = true;
    };
  }, [authUserId, hasTeamModel, insightsLoaded, insightsReloadVersion, teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSponsorsForMoreTab() {
      if (!teamId || activeTab !== 'more' || !hasTeamModel || sponsorsLoaded || sponsorsLoadingRef.current) return;
      setSponsorsLoading(true);
      setSponsorsError('');
      try {
        const sponsorPayload = await loadTeamDetailSponsors(teamId);
        if (!cancelled) {
          setModel((currentModel) => currentModel ? { ...currentModel, ...sponsorPayload } : currentModel);
          setSponsorsLoaded(true);
        }
      } catch (loadError: any) {
        if (!cancelled) setSponsorsError(loadError?.message || 'Unable to load team sponsors.');
      } finally {
        if (!cancelled) setSponsorsLoading(false);
      }
    }

    void loadSponsorsForMoreTab();
    return () => {
      cancelled = true;
    };
  }, [activeTab, hasTeamModel, sponsorsLoaded, teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadRosterInvitesForTab() {
      if (!teamId || activeTab !== 'roster' || !model?.canManageTeam || rosterInviteAttempted) return;
      setRosterInviteLoading(true);
      setRosterInviteError('');
      try {
        const summaries = await loadTeamRosterParentInvites(teamId, auth.user);
        if (!cancelled) {
          setRosterInviteSummaries(Object.fromEntries(summaries.map((summary) => [summary.playerId, summary])));
          setRosterInviteAttempted(true);
        }
      } catch (loadError: any) {
        if (!cancelled) setRosterInviteError(loadError?.message || 'Unable to load parent invite status.');
      } finally {
        if (!cancelled) {
          setRosterInviteLoading(false);
          setRosterInviteAttempted(true);
        }
      }
    }

    void loadRosterInvitesForTab();
    return () => {
      cancelled = true;
    };
  }, [activeTab, authUserId, model?.canManageTeam, teamId, rosterInviteAttempted, auth.user]);

  useEffect(() => {
    let cancelled = false;
    async function loadTrackingForRosterTab() {
      if (!teamId || activeTab !== 'roster' || !model?.canManageTeam || trackingAttempted) return;
      setTrackingLoading(true);
      setTrackingError('');
      try {
        const nextItems = await loadTeamTrackingAdmin(teamId, auth.user);
        if (!cancelled) {
          setTrackingItems(nextItems);
          setTrackingAttempted(true);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setTrackingError(loadError?.message || 'Unable to load tracking items.');
          setTrackingAttempted(true);
        }
      } finally {
        if (!cancelled) setTrackingLoading(false);
      }
    }

    void loadTrackingForRosterTab();
    return () => {
      cancelled = true;
    };
  }, [activeTab, authUserId, auth.user, model?.canManageTeam, teamId, trackingAttempted]);

  useEffect(() => {
    // Also cover back/forward navigation and direct route changes that do not
    // pass through the tab controls. ScrollRestoration restores POP entries in
    // requestAnimationFrame, so this runs one frame later to win that race.
    return scheduleTeamTabScrollPositionReset();
  }, [teamId, activeTab]);

  async function refreshTeamDetail() {
    if (!teamId) return;
    const nextModel = detailCollectionsLoaded || activeTab === 'more'
      ? await loadParentTeamDetail(teamId, auth.user, { includeDeferredData: false })
      : await loadParentTeamDetailBootstrap(teamId, auth.user);
    const mergedModel = {
      ...nextModel,
      leaderboards: model?.leaderboards || nextModel.leaderboards,
      trackingSummaries: model?.trackingSummaries || nextModel.trackingSummaries,
      teamAnalytics: model?.teamAnalytics || nextModel.teamAnalytics,
      sponsors: model?.sponsors || nextModel.sponsors,
      staffPermissions: model?.staffPermissions || nextModel.staffPermissions
    };
    if (activeTab === 'more' && nextModel.canManageTeam) {
      const staffPermissions = await loadTeamStaffPermissions(teamId, auth.user);
      setModel({ ...mergedModel, staffPermissions });
      setStaffPermissionsError('');
      setStaffPermissionsLoading(false);
      return;
    }
    setModel(mergedModel);
    setStaffPermissionsError('');
    setStaffPermissionsLoading(false);
  }

  async function refreshRosterInvites() {
    if (!teamId || !model?.canManageTeam) return;
    setRosterInviteLoading(true);
    setRosterInviteError('');
    setRosterInviteAttempted(true);
    try {
      const summaries = await loadTeamRosterParentInvites(teamId, auth.user);
      setRosterInviteSummaries(Object.fromEntries(summaries.map((summary) => [summary.playerId, summary])));
    } catch (loadError: any) {
      setRosterInviteError(loadError?.message || 'Unable to load parent invite status.');
    } finally {
      setRosterInviteLoading(false);
    }
  }

  async function refreshTrackingItems() {
    if (!teamId || !model?.canManageTeam) return;
    setTrackingLoading(true);
    setTrackingError('');
    setTrackingAttempted(true);
    try {
      setTrackingItems(await loadTeamTrackingAdmin(teamId, auth.user));
    } catch (loadError: any) {
      setTrackingError(loadError?.message || 'Unable to load tracking items.');
    } finally {
      setTrackingLoading(false);
    }
  }

  const tabBadges = useMemo(() => ({
    overview: 0,
    schedule: authoritativeUpcomingCount ?? model?.upcomingEvents.length ?? 0,
    roster: 0,
    insights: (model?.leaderboards.length || 0) + (model?.trackingSummaries.length || 0),
    more: model?.sponsors.length || 0
  }), [authoritativeUpcomingCount, model]);
  const trackedTeamTab = activeTab === 'schedule' || activeTab === 'roster' || activeTab === 'insights' || activeTab === 'more';
  const teamTabRoute = `/teams/${teamId}${activeTab === 'overview' ? '' : `?tab=${activeTab}`}`;
  const teamTabReady = Boolean(model && !loading && (
    activeTab === 'schedule'
      ? true
      : activeTab === 'roster'
        ? !rosterInviteLoading && !trackingLoading
        : activeTab === 'insights'
          ? !insightsLoading
          : activeTab === 'more'
            ? !detailCollectionsLoading && !staffPermissionsLoading && !sponsorsLoading
            : false
  ));
  const teamTabError = activeTab === 'schedule'
    ? ''
    : activeTab === 'roster'
      ? rosterInviteError || trackingError
      : activeTab === 'insights'
        ? insightsError
        : activeTab === 'more'
          ? detailCollectionsError || staffPermissionsError || sponsorsError
          : '';

  useViewLoadTimer({
    viewName: `my teams team ${activeTab}`,
    route: teamTabRoute,
    ready: teamTabReady,
    resetKey: `${authUserId || 'anonymous'}:${teamId}:${activeTab}:${reloadVersion}`,
    disabled: !trackedTeamTab || !auth.user || !teamId,
    getBaseMeta: () => ({
      page: 'my_teams',
      teamId,
      tab: activeTab
    }),
    getCompleteMeta: () => ({
      teamId,
      tab: activeTab,
      playerCount: model?.players.length || 0,
      upcomingEventCount: model?.upcomingEvents.length || 0,
      recentResultCount: model?.recentResults.length || 0,
      leaderboardCount: model?.leaderboards.length || 0,
      trackingSummaryCount: model?.trackingSummaries.length || 0,
      sponsorCount: model?.sponsors.length || 0,
      canManageTeam: Boolean(model?.canManageTeam),
      error: teamTabError || undefined
    })
  });

  if (!teamId) return <Navigate to="/teams" replace />;

  if (loading) {
    return <TeamDetailPageSkeleton />;
  }

  if (error || !model) {
    return (
      <DetailLoadErrorState
        icon={Shield}
        title="Team unavailable"
        error={error}
        fallbackMessage="Team not found."
        backTo="/teams"
        backLabel="Back to teams"
        onRetry={() => setReloadVersion((current) => current + 1)}
        retrying={loading}
      />
    );
  }

  return (
    <div className="team-detail-page space-y-4">
      <TeamHero model={model} upcomingCount={authoritativeUpcomingCount} />

      <nav
        className="team-detail-tab-nav sticky top-24 z-30 -mx-1 bg-gray-50/95 py-2 backdrop-blur"
        aria-label="Team detail sections"
        data-testid="team-detail-tab-nav"
      >
        <div className="app-card grid grid-cols-5 gap-1 p-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            const badge = tabBadges[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-black transition ${selected ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
                onClick={() => navigateToTab(tab.id)}
                aria-pressed={selected}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {badge > 0 ? <span className={`absolute -right-2 -top-1 min-w-4 rounded-full px-1 text-center text-[9px] leading-4 ${selected ? 'bg-white text-primary-700' : 'bg-primary-600 text-white'}`}>{badge > 9 ? '9+' : badge}</span> : null}
                </span>
                <span className="max-w-full truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {activeTab === 'overview' ? <OverviewTab model={model} /> : null}
      {activeTab === 'schedule' ? <ScheduleTab model={model} auth={auth} onScheduleLoaded={setAuthoritativeUpcomingCount} onOpenStatTrackerConfigs={() => navigateToTab('more')} /> : null}
      {activeTab === 'roster' ? (
        <ErrorBoundary name="team-detail-roster" onRetry={() => setRosterTabRetryVersion((current) => current + 1)}>
          <Suspense fallback={<div className="app-card p-4 text-sm font-semibold text-gray-500" role="status" aria-label="Loading roster" aria-live="polite">Loading roster…</div>}>
            <LazyRosterTab key={model.team.id} model={model} authUser={auth.user} onRefresh={refreshTeamDetail} rosterInviteLoading={rosterInviteLoading} rosterInviteError={rosterInviteError} rosterInviteSummaries={rosterInviteSummaries} onInviteCreated={refreshRosterInvites} trackingLoading={trackingLoading} trackingError={trackingError} trackingItems={trackingItems} onTrackingChanged={refreshTrackingItems} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      {activeTab === 'insights' ? (
        <ErrorBoundary name="team-detail-insights" onRetry={() => setInsightsTabRetryVersion((current) => current + 1)}>
          <Suspense fallback={<div className="app-card p-4 text-sm font-semibold text-gray-500" role="status" aria-label="Loading insights" aria-live="polite">Loading insights…</div>}>
            <LazyInsightsTab model={model} loading={insightsLoading} error={insightsError} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      {activeTab === 'more' ? (
        detailCollectionsLoading ? <InlineDeferredLoading copy="Loading team settings…" /> : detailCollectionsError ? <DeferredCollectionsErrorState message={detailCollectionsError} onRetry={() => {
          setDetailCollectionsError('');
          setDetailCollectionsReloadVersion((current) => current + 1);
        }} /> : <MoreTab model={model} auth={auth} staffPermissionsLoading={staffPermissionsLoading} staffPermissionsError={staffPermissionsError} sponsorsLoading={sponsorsLoading} sponsorsError={sponsorsError} onTeamDetailRefresh={refreshTeamDetail} />
      ) : null}
    </div>
  );
}

function TeamHero({ model, upcomingCount = null }: { model: TeamDetailModel; upcomingCount?: number | null }) {
  const { team } = model;
  return (
    <section className="app-card overflow-hidden">
      <div className="relative h-32 bg-gray-950 sm:h-44">
        {team.photoUrl ? (
          <AvatarImage src={team.photoUrl} alt={`${team.name} team photo`} decoding="async" className="h-full w-full object-cover opacity-90" fallback={<div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#111827_0%,#4338ca_50%,#047857_100%)]"><span className="text-5xl font-black text-white">{getInitials(team.name)}</span></div>} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#111827_0%,#4338ca_50%,#047857_100%)]">
            <span className="text-5xl font-black text-white">{getInitials(team.name)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950/75 via-gray-950/10 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 text-white">
          <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-[0.06em] text-white/75">Team</div>
            <h1 className="mt-1 truncate text-2xl font-black leading-tight">{team.name}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-black">{team.sport}</span>
              {team.zip ? <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-black">{team.zip}</span> : null}
            </div>
          </div>
          <Link to={`/messages/${encodeURIComponent(team.id)}`} className="inline-flex min-h-10 flex-none items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-gray-950 shadow-sm">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Chat
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        <SummaryStat icon={Trophy} label="Record" value={formatRecord(model.record)} to={`/schedule?teamId=${encodeURIComponent(model.team.id)}&filter=recent-results`} />
        <SummaryStat icon={Users} label="Roster" value={String(model.players.length)} to={`/teams/${encodeURIComponent(model.team.id)}?tab=roster`} />
        <SummaryStat icon={CalendarDays} label="Upcoming" value={String(upcomingCount ?? model.upcomingEvents.length)} to={`/teams/${encodeURIComponent(model.team.id)}?tab=schedule`} />
      </div>
      {team.description ? <p className="border-t border-gray-100 px-4 py-3 text-sm font-semibold leading-6 text-gray-600">{team.description}</p> : null}
    </section>
  );
}

function OverviewTab({ model }: { model: TeamDetailModel }) {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2">
        <InfoCard icon={Trophy} title={`Season record (${model.record.label})`} value={formatRecord(model.record)} detail={model.record.gamesPlayed ? `${model.record.gamesPlayed} completed ${model.record.gamesPlayed === 1 ? 'game' : 'games'}${model.record.winPercentage !== null ? ` · ${model.record.winPercentage}%` : ''}` : 'No completed games yet'} to={`/schedule?teamId=${encodeURIComponent(model.team.id)}&filter=recent-results`} />
        <InfoCard icon={CalendarDays} title="Next event" value={model.nextEvent ? formatEventDate(model.nextEvent.date) : 'No upcoming'} detail={model.nextEvent ? `${model.nextEvent.title} · ${model.nextEvent.locationDetail || model.nextEvent.location}` : 'Schedule is clear for now'} to={`/schedule?teamId=${encodeURIComponent(model.team.id)}`} />
        <InfoCard icon={Users} title="Roster size" value={`${model.players.length}`} detail={`${model.linkedPlayers.length || 0} linked to your account`} to={`/teams/${encodeURIComponent(model.team.id)}?tab=roster`} />
        <InfoCard icon={BarChart3} title="Standings" value={getStandingValue(model)} detail={getStandingDetail(model)} href={model.team.leagueUrl || undefined} />
      </section>

      <TeamToolsSection model={model} />

      <StandingsSection model={model} />

      <section className="app-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-black text-gray-950">Parent actions</div>
            <div className="mt-1 text-xs font-semibold text-gray-500">The high-frequency team workflows are native in the app.</div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Link to={`/schedule?teamId=${encodeURIComponent(model.team.id)}&filter=availability`} className="secondary-button justify-center text-xs">
            Availability
          </Link>
          <Link to={`/schedule?teamId=${encodeURIComponent(model.team.id)}`} className="secondary-button justify-center text-xs">
            Team schedule
          </Link>
          <Link to={`/messages/${encodeURIComponent(model.team.id)}`} className="secondary-button justify-center text-xs">
            Team chat
          </Link>
        </div>
      </section>

      <TeamPassCard model={model} />
    </div>
  );
}

function TeamToolsSection({ model }: { model: TeamDetailModel }) {
  const [showAllTools, setShowAllTools] = useState(false);
  const sections = useMemo(() => buildTeamDetailNavigation(model), [model]);

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">Team tools</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Shortcuts for this team. Core app workflows stay first; current website tools remain available where needed.</div>
        </div>
      </div>

      <TeamNavigationPanel sections={sections} showAllTools={showAllTools} onToggleTools={() => setShowAllTools((value) => !value)} />
    </section>
  );
}

function TeamNavigationPanel({ sections, showAllTools, onToggleTools }: {
  sections: TeamNavigationSection[];
  showAllTools: boolean;
  onToggleTools: () => void;
}) {
  return (
    <div className="mt-3 space-y-3">
      {sections.map((section) => {
        const isManagement = section.id === 'management';
        const visibleItems = isManagement && !showAllTools ? section.items.slice(0, 4) : section.items;

        return (
          <div key={section.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">{section.title}</div>
                <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{section.detail}</div>
              </div>
              {isManagement && section.items.length > 4 ? (
                <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={onToggleTools} aria-expanded={showAllTools}>
                  {showAllTools ? 'Show less' : `${section.items.length - 4} more`}
                  <ChevronDown className={`h-4 w-4 transition ${showAllTools ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {visibleItems.map((item) => <TeamNavigationTile key={item.id} item={item} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TeamNavigationTile({ item }: { item: TeamNavigationItem }) {
  const Icon = teamNavigationIcons[item.id] || ClipboardList;
  const content = (
    <>
      <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${item.kind === 'native' ? 'bg-primary-50 text-primary-700' : 'bg-gray-100 text-gray-700'}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-black text-gray-950">{item.label}</span>
          {item.badge ? <span className="inline-flex min-h-5 flex-none items-center rounded-full bg-primary-600 px-2 text-[10px] font-black text-white">{item.badge}</span> : null}
        </span>
        <span className="mt-0.5 line-clamp-1 text-xs font-semibold leading-5 text-gray-500">{item.detail}</span>
        <span className="mt-1 hidden items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-400 sm:inline-flex">
          {item.kind === 'native' ? 'App' : 'Website'}
          {item.kind === 'website' ? <ExternalLink className="h-3 w-3" aria-hidden="true" /> : null}
        </span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 flex-none text-gray-300" aria-hidden="true" />
    </>
  );
  const className = 'group flex min-h-[74px] items-start gap-3 rounded-xl border border-gray-200 bg-white p-2.5 text-left transition hover:border-primary-200 hover:bg-primary-50/30';

  if (item.kind === 'native') {
    return <Link to={item.href} className={className}>{content}</Link>;
  }

  return (
    <a
      href={item.href}
      className={className}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openPublicUrl(item.href);
      }}
    >
      {content}
    </a>
  );
}

const teamNavigationIcons: Record<string, LucideIcon> = {
  schedule: CalendarDays,
  messages: MessageCircle,
  'practice-packets': ClipboardCheck,
  'team-page': Ticket,
  'website-team-page': ExternalLink,
  'player-profile': UserRound,
  players: Users,
  media: ImageIcon,
  'parent-fees': DollarSign,
  registrations: Ticket,
  awards: Award,
  'team-settings': Settings,
  'manage-roster': Users,
  'manage-schedule': CalendarDays,
  fees: DollarSign,
  'practice-command': Dumbbell,
  'game-plan': ClipboardList,
  'game-day': Radio,
  tracking: ClipboardCheck,
  'stats-config': SlidersHorizontal,
  certificates: Award
};

function StandingsSection({ model }: { model: TeamDetailModel }) {
  const [expanded, setExpanded] = useState(false);
  const rows = Array.isArray(model.standings.rows) ? model.standings.rows : [];
  const hasRows = rows.length > 0;
  const highlightKey = getStandingsRowKey(model.standings.currentRow);
  const highlightedRowIndex = rows.findIndex((row) => getStandingsRowKey(row) === highlightKey);
  const visibleRows = expanded
    ? rows
    : getCollapsedStandingsRows(rows, highlightedRowIndex, initialStandingsRowLimit);
  const hasMoreRows = rows.length > initialStandingsRowLimit;
  const contextColumn = getStandingsContextColumn(rows, model.standings.label);

  if (!hasRows && !model.team.leagueUrl) {
    return null;
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Standings</div>
          <div className="mt-1 text-xs font-semibold text-gray-500">
            {hasRows ? 'Quick league snapshot with the current team highlighted.' : 'Open the league page for current standings.'}
          </div>
        </div>
        {model.team.leagueUrl ? <a href={model.team.leagueUrl} className="secondary-button !min-h-9 text-xs" target="_blank" rel="noreferrer">League page</a> : null}
      </div>

      {hasRows ? (
        <>
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-left">
              <thead className="bg-gray-50">
                <tr className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">
                  <th className="px-3 py-2.5">Rank</th>
                  <th className="px-3 py-2.5">Team</th>
                  <th className="px-3 py-2.5">Record</th>
                  <th className="px-3 py-2.5">{contextColumn.label}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {visibleRows.map((row) => {
                  const isHighlighted = getStandingsRowKey(row) === highlightKey;
                  return (
                    <tr
                      key={getStandingsRowKey(row)}
                      className={isHighlighted ? 'bg-primary-50/70' : 'bg-white'}
                      aria-current={isHighlighted ? 'true' : undefined}
                    >
                      <td className={`whitespace-nowrap px-3 py-2.5 text-sm ${isHighlighted ? 'font-black text-primary-800' : 'font-semibold text-gray-700'}`}>{formatStandingsRank(row)}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-sm ${isHighlighted ? 'font-black text-primary-800' : 'font-semibold text-gray-900'}`}>{getStandingsTeamName(row)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-gray-700">{formatStandingsRecord(row)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-gray-700">{contextColumn.value(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-gray-500">Computed from completed in-app games.</div>
            {hasMoreRows ? (
              <button type="button" className="secondary-button !min-h-9 text-xs" onClick={() => setExpanded((current) => !current)}>
                {expanded ? 'Show fewer teams' : `Show ${rows.length - initialStandingsRowLimit} more team${rows.length - initialStandingsRowLimit === 1 ? '' : 's'}`}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
          No in-app standings rows yet.
        </div>
      )}
    </section>
  );
}

export function buildTeamSchedulePreviewEvents(
  scheduleEvents: ParentScheduleEvent[],
  modelEvents: TeamDetailEvent[],
  teamId: string,
  now = Date.now()
) {
  const modelEventsByIdentity = new Map(
    modelEvents.map((event) => [`${event.id}:${event.date.getTime()}`, event])
  );
  const uniqueEvents = new Map<string, TeamDetailEvent>();

  for (const scheduleEvent of scheduleEvents) {
    if (scheduleEvent.teamId !== teamId || !scheduleEvent.id || !scheduleEvent.date) continue;
    const identity = `${scheduleEvent.id}:${scheduleEvent.date.getTime()}`;
    if (uniqueEvents.has(identity)) continue;
    const existingEvent = modelEventsByIdentity.get(identity);
    uniqueEvents.set(identity, {
      id: scheduleEvent.id,
      isDbGame: scheduleEvent.isDbGame,
      type: scheduleEvent.type,
      title: scheduleEvent.title?.trim() || (scheduleEvent.type === 'practice' ? 'Practice' : `vs. ${scheduleEvent.opponent?.trim() || 'TBD'}`),
      date: scheduleEvent.date,
      location: scheduleEvent.location?.trim() || 'TBD',
      opponent: scheduleEvent.opponent?.trim() || 'TBD',
      status: scheduleEvent.status?.trim() || (scheduleEvent.isCancelled ? 'cancelled' : 'scheduled'),
      liveStatus: scheduleEvent.liveStatus?.trim() || '',
      visibility: scheduleEvent.visibility?.trim() || existingEvent?.visibility || '',
      isPrivate: existingEvent?.isPrivate || false,
      isPublic: existingEvent?.isPublic || false,
      shareable: existingEvent?.shareable || false,
      publicCalendar: existingEvent?.publicCalendar || false,
      homeScore: scheduleEvent.homeScore ?? null,
      awayScore: scheduleEvent.awayScore ?? null,
      isCancelled: scheduleEvent.isCancelled,
      statTrackerConfigId: scheduleEvent.statTrackerConfigId?.trim() || existingEvent?.statTrackerConfigId || '',
      statTrackerConfigLabel: existingEvent?.statTrackerConfigLabel || 'No config assigned',
      statTrackerConfigBaseType: existingEvent?.statTrackerConfigBaseType || '',
      statTrackerConfigExists: existingEvent?.statTrackerConfigExists || false,
      statTrackerConfigIsBasketball: existingEvent?.statTrackerConfigIsBasketball || false
    });
  }

  for (const modelEvent of modelEvents) {
    const identity = `${modelEvent.id}:${modelEvent.date.getTime()}`;
    if (!uniqueEvents.has(identity)) uniqueEvents.set(identity, modelEvent);
  }

  const events = [...uniqueEvents.values()];
  const upcoming = events
    .filter((event) => !event.isCancelled && event.status.toLowerCase() !== 'completed' && event.date.getTime() >= now - 3 * 60 * 60 * 1000)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 8);
  const recent = events
    .filter((event) => event.status.toLowerCase() === 'completed' || (event.homeScore !== null && event.awayScore !== null && event.date.getTime() < now))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 3);

  return [...upcoming, ...recent];
}

function countUpcomingTeamScheduleEvents(scheduleEvents: ParentScheduleEvent[], teamId: string, now = Date.now()) {
  const identities = new Set<string>();
  for (const event of scheduleEvents) {
    if (
      event.teamId !== teamId
      || !event.id
      || !event.date
      || event.isCancelled
      || event.status?.toLowerCase() === 'completed'
      || event.date.getTime() < now - 3 * 60 * 60 * 1000
    ) continue;
    identities.add(`${event.id}:${event.date.getTime()}`);
  }
  return identities.size;
}

function ScheduleTab({ model, auth, onScheduleLoaded, onOpenStatTrackerConfigs }: { model: TeamDetailModel; auth: AuthState; onScheduleLoaded: (upcomingCount: number) => void; onOpenStatTrackerConfigs: () => void }) {
  const [authoritativeEvents, setAuthoritativeEvents] = useState<ParentScheduleEvent[] | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleReloadVersion, setScheduleReloadVersion] = useState(0);
  const modelEvents = useMemo(() => [...model.upcomingEvents, ...model.recentResults], [model.recentResults, model.upcomingEvents]);
  const events = useMemo(
    () => buildTeamSchedulePreviewEvents(authoritativeEvents || [], modelEvents, model.team.id),
    [authoritativeEvents, model.team.id, modelEvents]
  );
  const reminderPreviewLoader = useMemo(() => createStaffRsvpReminderPreviewLoader(), []);

  useEffect(() => {
    let cancelled = false;
    async function loadTeamSchedule() {
      setScheduleLoading(true);
      setScheduleError('');
      try {
        const result = await loadParentSchedule(auth.user, {
          hydrateDetails: false,
          expandStaffPlayers: false,
          targetTeamId: model.team.id,
          includePastGames: true
        });
        if (result.isPartial === true) {
          throw new Error('The complete team schedule could not be loaded. Retry to avoid showing missing events.');
        }
        if (!cancelled) {
          const teamEvents = result.events.filter((event) => event.teamId === model.team.id);
          setAuthoritativeEvents(teamEvents);
          onScheduleLoaded(countUpcomingTeamScheduleEvents(teamEvents, model.team.id));
        }
      } catch (loadError: any) {
        if (!cancelled) setScheduleError(loadError?.message || 'Unable to load the team schedule.');
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    }
    void loadTeamSchedule();
    return () => {
      cancelled = true;
    };
  }, [auth.user, model.team.id, onScheduleLoaded, scheduleReloadVersion]);

  return (
    <section className="app-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Team schedule</div>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">Games, practices, availability, rideshare, assignments, and packets live in the schedule workflow.</div>
        </div>
        <Link to={`/schedule?teamId=${encodeURIComponent(model.team.id)}`} className="secondary-button !min-h-9 text-xs">Open</Link>
      </div>
      <div className="mt-3 space-y-2">
        {scheduleLoading ? <InlineDeferredLoading copy="Loading the complete team schedule…" /> : null}
        {scheduleError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="text-sm font-black text-gray-950">Team schedule unavailable</div>
            <div className="mt-1 text-xs font-semibold text-rose-700">{scheduleError}</div>
            <button type="button" className="secondary-button mt-3 !min-h-9 text-xs" onClick={() => setScheduleReloadVersion((current) => current + 1)}>
              Retry schedule
            </button>
          </div>
        ) : null}
        {events.length ? events.map((event) => <TeamEventRow key={`${event.id}-${event.date.toISOString()}`} event={event} model={model} auth={auth} reminderPreviewLoader={reminderPreviewLoader} onOpenStatTrackerConfigs={onOpenStatTrackerConfigs} />) : (
          !scheduleLoading && !scheduleError ? <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No team events found.</div> : null
        )}
      </div>
    </section>
  );
}
function MoreTab({ model, auth, staffPermissionsLoading, staffPermissionsError, sponsorsLoading, sponsorsError, onTeamDetailRefresh }: { model: TeamDetailModel; auth: AuthState; staffPermissionsLoading: boolean; staffPermissionsError: string; sponsorsLoading: boolean; sponsorsError: string; onTeamDetailRefresh: () => Promise<void> }) {
  const statTrackerConfigs = model.statTrackerConfigs || [];
  const orphanedConfigAssignments = model.canManageTeam
    ? model.upcomingEvents.filter((event) => event.type === 'game' && event.statTrackerConfigId && !event.statTrackerConfigExists)
    : [];

  return (
    <div className="space-y-4">
      {model.canManageTeam ? <StatTrackerConfigsCard teamId={model.team.id} auth={auth} configs={statTrackerConfigs} orphanedAssignments={orphanedConfigAssignments} onSaved={onTeamDetailRefresh} /> : null}
      {model.canManageTeam && !model.staffPermissions && staffPermissionsLoading ? (
        <section className="app-card p-4">
          <div className="flex items-center gap-3 text-sm font-semibold text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
            Loading team staff permissions…
          </div>
        </section>
      ) : null}
      {model.canManageTeam && !model.staffPermissions && staffPermissionsError ? (
        <section className="app-card p-4">
          <div className="text-sm font-black text-gray-950">Team staff permissions unavailable</div>
          <div className="mt-1 text-xs font-semibold text-rose-700">{staffPermissionsError}</div>
        </section>
      ) : null}
      {model.staffPermissions ? <StaffPermissionsCard model={model} auth={auth} onInviteSuccess={onTeamDetailRefresh} /> : null}
      {model.canManageTeam ? <ReminderTimingDefaultsCard model={model} onSaved={onTeamDetailRefresh} /> : null}
      {auth.user ? <PrivateCalendarSyncCard model={model} /> : null}
      {canExposePublicFanFeed(model.team, [...model.upcomingEvents, ...model.recentResults]) ? <FanFeedCard model={model} /> : null}
      {model.canManageTeam ? <ScoreboardWidgetCard model={model} /> : null}

      <section className="app-card p-4">
        <div className="text-sm font-black text-gray-950">Team links</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ExternalAction icon={ExternalLink} label="Website team page" detail="Open the current full team.html page." href={model.team.websiteUrl} />
          {model.canManageTeam ? <InternalAction icon={Shield} label="Edit team" detail="Update name, sport, photo, ZIP, and visibility in the app." to={`/teams/${encodeURIComponent(model.team.id)}/edit`} /> : null}
          {model.canManageTeam ? <InternalAction icon={Award} label="Awards studio" detail="Create drafts, review AI narratives, publish, and export." to={`/teams/${encodeURIComponent(model.team.id)}/certificates`} /> : null}
          {model.canManageTeam ? <InternalAction icon={Dumbbell} label="Drill library" detail="Browse community drills and manage favorites." to={`/teams/${encodeURIComponent(model.team.id)}/drills`} /> : null}
          {model.canManageTeam ? <InternalAction icon={Ticket} label="Registration forms" detail="Create, edit, publish, or close registration forms." to={`/teams/${encodeURIComponent(model.team.id)}/registration-forms`} /> : null}
          <InternalAction icon={ImageIcon} label="Media albums" detail="Photos, video links, albums, and files." to={`/teams/${encodeURIComponent(model.team.id)}/media`} />
          <InternalAction icon={DollarSign} label="My fees" detail="Balances, checkout links, installments, and history." to="/parent-tools/fees" />
          <InternalAction icon={Ticket} label="Registrations" detail="Open published team registration forms." to="/parent-tools/registrations" />
          {model.team.streamUrl ? <ExternalAction icon={Radio} label="Watch stream" detail="Open the configured team stream." href={model.team.streamUrl} /> : null}
          {model.team.bracketUrl ? <ExternalAction icon={Trophy} label="Tournament bracket" detail="Open official bracket." href={model.team.bracketUrl} /> : null}
          {model.team.leagueUrl ? <ExternalAction icon={Trophy} label="League page" detail="Open standings or league registration source." href={model.team.leagueUrl} /> : null}
        </div>
      </section>

      {model.team.registrationProvider.length ? <RegistrationProviderCard rows={model.team.registrationProvider} /> : null}

      {sponsorsLoading ? <InlineDeferredLoading copy="Loading local attractions and sponsors…" /> : null}
      {!sponsorsLoading && sponsorsError ? <InlineDeferredError title="Sponsors unavailable" message={sponsorsError} /> : null}

      {model.sponsors.length ? (
        <section className="app-card p-4">
          <div className="text-sm font-black text-gray-950">Local attractions and sponsors</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {model.sponsors.map((sponsor) => (
              <a
                key={sponsor.id}
                href={sponsor.websiteUrl || '#'}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3"
                onClick={(event) => {
                  if (!sponsor.websiteUrl) return;
                  event.preventDefault();
                  void openPublicUrl(sponsor.websiteUrl);
                }}
              >
                <SponsorImage sponsor={sponsor} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-gray-950">{sponsor.name}</span>
                  {sponsor.description ? <span className="line-clamp-1 text-xs font-semibold text-gray-500">{sponsor.description}</span> : null}
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatTrackerConfigsCard({
  teamId,
  auth,
  configs,
  orphanedAssignments,
  onSaved
}: {
  teamId: string;
  auth: AuthState;
  configs: TeamDetailModel['statTrackerConfigs'];
  orphanedAssignments: TeamDetailModel['upcomingEvents'];
  onSaved: () => Promise<void>;
}) {
  const safeConfigs = configs || [];
  const presetCatalog = getStatTrackerConfigPresetCatalog();
  const [editingConfigId, setEditingConfigId] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('blank');
  const [draft, setDraft] = useState<StatTrackerConfigDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  function openCreateForm() {
    setEditingConfigId('');
    setSelectedPresetId('blank');
    setDraft(createEmptyStatTrackerConfigDraft());
    setStatus(null);
  }

  function openEditForm(config: TeamDetailModel['statTrackerConfigs'][number]) {
    const nextDraft = createStatTrackerConfigDraft({
      id: config.id,
      name: config.name,
      baseType: config.baseType,
      columns: config.columns,
      statDefinitions: config.statDefinitions
    });
    setEditingConfigId(config.id);
    setSelectedPresetId('blank');
    setDraft(nextDraft);
    setStatus(null);
  }

  function closeEditor(options: { keepStatus?: boolean } = {}) {
    setEditingConfigId('');
    setSelectedPresetId('blank');
    setDraft(null);
    if (!options.keepStatus) {
      setStatus(null);
    }
  }

  function updateColumn(columnUiId: string, patch: { key?: string; label?: string }) {
    setDraft((currentDraft) => currentDraft ? {
      ...currentDraft,
      columns: currentDraft.columns.map((column) => column.uiId === columnUiId ? { ...column, ...patch } : column)
    } : currentDraft);
  }

  function moveColumn(columnUiId: string, direction: -1 | 1) {
    setDraft((currentDraft) => {
      if (!currentDraft) return currentDraft;
      const index = currentDraft.columns.findIndex((column) => column.uiId === columnUiId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= currentDraft.columns.length) return currentDraft;
      const columns = currentDraft.columns.slice();
      const [column] = columns.splice(index, 1);
      columns.splice(nextIndex, 0, column);
      return { ...currentDraft, columns };
    });
  }

  async function saveDraft() {
    if (!draft || submitting) return;

    const validation = validateStatTrackerConfigDraft(draft);
    if (!validation.valid) {
      setStatus({ success: false, message: validation.errors.join(' ') });
      return;
    }

    const payload = buildStatTrackerConfigPayload(draft);
    setSubmitting(true);
    setStatus(null);
    try {
      if (editingConfigId) {
        await updateStatTrackerConfigForApp(teamId, editingConfigId, auth.user || null, payload);
      } else {
        await createStatTrackerConfigForApp(teamId, auth.user || null, payload);
      }
      await onSaved();
      setStatus({ success: true, message: editingConfigId ? 'Stat config saved.' : 'Stat config created.' });
      closeEditor({ keepStatus: true });
    } catch (error: any) {
      setStatus({ success: false, message: error?.message || 'Unable to save this stat config.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Stat tracker configs</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Create a config from a sport preset or blank slate, then rename, reorder, add, or remove tracked columns without leaving the app.</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{safeConfigs.length} config{safeConfigs.length === 1 ? '' : 's'}</span>
          {!draft ? <button type="button" className="primary-button !min-h-9 px-3 text-xs" onClick={openCreateForm}>Create config</button> : null}
        </div>
      </div>

      {status ? <div className={`mt-3 rounded-xl border p-3 text-xs font-black ${status.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`} role="status">{status.message}</div> : null}

      {draft ? (
        <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-black text-gray-950">{editingConfigId ? 'Edit stat config' : 'Create stat config'}</div>
              <div className="mt-1 text-xs font-semibold text-gray-600">Column labels can change without changing stored stat keys. Basketball base type keeps the website tracker chooser working.</div>
            </div>
            <button type="button" className="secondary-button !min-h-9 px-3 text-xs" onClick={() => closeEditor()} disabled={submitting}>Cancel</button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Config name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(event) => setDraft((currentDraft) => currentDraft ? { ...currentDraft, name: event.target.value } : currentDraft)}
                className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                placeholder="Basketball Standard"
                disabled={submitting}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Base sport</span>
              <select
                value={draft.baseType}
                onChange={(event) => setDraft((currentDraft) => currentDraft ? { ...currentDraft, baseType: event.target.value } : currentDraft)}
                className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                disabled={submitting}
              >
                {['Basketball', 'Soccer', 'Baseball', 'Football', 'Volleyball', 'Custom'].map((baseType) => <option key={baseType} value={baseType}>{baseType}</option>)}
              </select>
            </label>
          </div>

          {!editingConfigId ? (
            <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
              <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Preset library</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <select
                  aria-label="Preset library"
                  value={selectedPresetId}
                  onChange={(event) => setSelectedPresetId(event.target.value)}
                  className="min-h-10 flex-1 rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                  disabled={submitting}
                >
                  {presetCatalog.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                </select>
                <button type="button" className="secondary-button !min-h-10 px-3 text-xs" onClick={() => {
                  const presetDraft = createStatTrackerConfigDraftFromPreset(selectedPresetId);
                  setDraft({ ...presetDraft, name: draft.name || presetDraft.name, baseType: presetDraft.baseType });
                }} disabled={submitting}>Apply preset</button>
              </div>
            </div>
          ) : null}

          <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Columns</div>
                <div className="mt-1 text-xs font-semibold text-gray-500">Keys power saved events. Labels control what coaches see in the tracker and reports.</div>
              </div>
              <button type="button" className="secondary-button !min-h-8 px-3 text-xs" onClick={() => setDraft((currentDraft) => currentDraft ? { ...currentDraft, columns: currentDraft.columns.concat(createBlankStatTrackerConfigColumnDraft()) } : currentDraft)} disabled={submitting}>Add column</button>
            </div>
            <div className="mt-3 space-y-2">
              {draft.columns.length ? draft.columns.map((column, index) => (
                <div key={column.uiId} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">Label</span>
                      <input
                        type="text"
                        value={column.label}
                        onChange={(event) => updateColumn(column.uiId, { label: event.target.value })}
                        className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        placeholder="PTS"
                        disabled={submitting}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">Key</span>
                      <input
                        type="text"
                        value={column.key}
                        onChange={(event) => updateColumn(column.uiId, { key: event.target.value })}
                        className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        placeholder="PTS"
                        disabled={submitting}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" className="secondary-button !min-h-10 px-3 text-xs" onClick={() => moveColumn(column.uiId, -1)} disabled={submitting || index === 0}>Up</button>
                      <button type="button" className="secondary-button !min-h-10 px-3 text-xs" onClick={() => moveColumn(column.uiId, 1)} disabled={submitting || index === draft.columns.length - 1}>Down</button>
                      <button type="button" className="secondary-button !min-h-10 px-3 text-xs !border-rose-200 !bg-rose-50 !text-rose-700" onClick={() => setDraft((currentDraft) => currentDraft ? { ...currentDraft, columns: currentDraft.columns.filter((entry) => entry.uiId !== column.uiId) } : currentDraft)} disabled={submitting}>Remove</button>
                    </div>
                  </div>
                </div>
              )) : <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-xs font-semibold text-gray-500">No columns yet. Add one manually or apply a preset.</div>}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="primary-button !min-h-10 px-3 text-xs" disabled={submitting} onClick={saveDraft}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {editingConfigId ? 'Save config' : 'Create config'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {safeConfigs.length ? safeConfigs.map((config) => (
          <div key={config.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-black text-gray-950">{config.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-700">{config.baseType || 'Custom'}</span>
                  {config.isBasketball ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-amber-800">Basketball tracker routing</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-black text-primary-700">{formatConfigColumnSummary(config.columnCount, config.columnNames)}</span>
                <button type="button" className="secondary-button !min-h-8 px-3 text-xs" onClick={() => openEditForm(config)} disabled={submitting}>Edit</button>
              </div>
            </div>
            <div className="mt-3 text-xs font-semibold text-gray-600">Columns: <span className="font-black text-gray-900">{config.columnNames.length ? config.columnNames.join(', ') : 'None configured'}</span></div>
            <div className="mt-3">
              <div className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">Assigned upcoming games</div>
              {config.assignedUpcomingGames.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {config.assignedUpcomingGames.map((game) => (
                    <span key={`${config.id}-${game.gameId}`} className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-gray-700">
                      {game.title} · {formatEventDate(game.date)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs font-semibold text-gray-500">No upcoming games assigned.</div>
              )}
            </div>
          </div>
        )) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No stat tracker configs found for this team.</div>
        )}

        {orphanedAssignments.length ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.04em] text-rose-700">Missing config assignments</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {orphanedAssignments.map((event) => (
                <span key={event.id} className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-rose-700">{event.title} · {event.statTrackerConfigId}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatConfigColumnSummary(columnCount: number, columnNames: string[]) {
  if (!columnCount) return 'No columns';
  const preview = columnNames.slice(0, 3).join(', ');
  const remainder = columnCount - Math.min(columnNames.length, 3);
  return `${columnCount} column${columnCount === 1 ? '' : 's'}${preview ? ` · ${preview}${remainder > 0 ? ` +${remainder}` : ''}` : ''}`;
}

function DeferredCollectionsErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="app-card p-4">
      <InlineDeferredError title="Team detail unavailable" message={message} />
      <button type="button" className="secondary-button mt-3 !min-h-9 text-xs" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}

function InlineDeferredLoading({ copy }: { copy: string }) {
  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
      <div className="flex items-center gap-3 text-sm font-semibold text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
        {copy}
      </div>
    </div>
  );
}

function InlineDeferredError({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
      <div className="text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold text-rose-700">{message}</div>
    </div>
  );
}

function ReminderTimingDefaultsCard({ model, onSaved }: { model: TeamDetailModel; onSaved: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(model.team.scheduleNotifications.enabled);
  const [reminderHours, setReminderHours] = useState(model.team.scheduleNotifications.reminderHours);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setEnabled(model.team.scheduleNotifications.enabled);
    setReminderHours(model.team.scheduleNotifications.reminderHours);
  }, [model.team.scheduleNotifications.enabled, model.team.scheduleNotifications.reminderHours]);

  const hasChanges = enabled !== model.team.scheduleNotifications.enabled
    || reminderHours !== model.team.scheduleNotifications.reminderHours;

  async function saveSettings() {
    if (submitting || !hasChanges) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await saveTeamScheduleNotificationsForApp(model.team.id, { enabled, reminderHours, delivery: 'team_chat' });
      await onSaved();
      setStatus({ success: true, message: 'Reminder timing defaults saved.' });
    } catch (saveError: any) {
      setStatus({ success: false, message: saveError?.message || 'Unable to save reminder timing defaults.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Reminder timing defaults</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Save the inherited team RSVP reminder timing for future schedule events in web and mobile.</div>

          <div className="mt-4 space-y-3 rounded-xl border border-primary-100 bg-primary-50 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setStatus(null);
                }}
                disabled={submitting}
              />
              <span>
                <span className="block text-sm font-black text-gray-950">Enable team-wide pre-event reminders</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-gray-600">When enabled, new schedule flows can inherit this team reminder window.</span>
              </span>
            </label>

            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Reminder window</span>
              <select
                aria-label="Reminder window"
                className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                value={String(reminderHours)}
                onChange={(event) => {
                  setReminderHours(Number.parseInt(event.target.value, 10) as 24 | 48 | 72);
                  setStatus(null);
                }}
                disabled={submitting}
              >
                <option value="24">24 hours before event start</option>
                <option value="48">48 hours before event start</option>
                <option value="72">72 hours before event start</option>
              </select>
            </label>

            <div className="rounded-lg border border-white/80 bg-white p-3 text-xs font-semibold leading-5 text-gray-600">{model.team.scheduleNotifications.summary}</div>

            <button type="button" className="primary-button !min-h-10 text-xs" disabled={submitting || !hasChanges} onClick={saveSettings}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save Timing Defaults
            </button>
            {status ? <div className={`text-xs font-black ${status.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{status.message}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function PrivateCalendarSyncCard({ model }: { model: TeamDetailModel }) {
  const [busyTarget, setBusyTarget] = useState<'apple' | 'google' | 'copy' | ''>('');
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  async function openFeed(target: 'apple' | 'google' | 'copy') {
    if (busyTarget) return;
    setBusyTarget(target);
    setStatus(null);
    try {
      const feedUrl = buildPrivateTeamCalendarFeedUrl(model.team.id, model.team);
      if (!feedUrl) throw new Error('Unable to create private calendar feed. Sign in again and retry.');
      if (target === 'copy') {
        const result = await copyPublicText(feedUrl);
        setStatus(result === 'copied'
          ? { success: true, message: 'Private calendar link copied.' }
          : { success: false, message: 'Unable to copy the private calendar link. Sign in again and retry.' });
        return;
      }
      await openPublicUrl(target === 'apple' ? getAppleCalendarFeedUrl(feedUrl) : getGoogleCalendarFeedUrl(feedUrl));
    } catch (feedError: any) {
      setStatus({ success: false, message: feedError?.message || 'Unable to open private calendar sync. Sign in again and retry.' });
    } finally {
      setBusyTarget('');
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Private calendar sync</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Subscribe to the live private team feed for games and practices. For a one-time .ics file instead, use the team schedule export.</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed('apple')} disabled={Boolean(busyTarget)}>
              {busyTarget === 'apple' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Apple Calendar
            </button>
            <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed('google')} disabled={Boolean(busyTarget)}>
              {busyTarget === 'google' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Google Calendar
            </button>
            <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed('copy')} disabled={Boolean(busyTarget)}>
              {busyTarget === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              Copy Link
            </button>
          </div>
          <Link to={`/schedule?teamId=${encodeURIComponent(model.team.id)}`} className="ghost-button mt-3 !min-h-9 px-0 text-xs text-primary-700">
            Open team schedule for one-time .ics export
          </Link>
          {status ? <div className={`mt-2 text-xs font-black ${status.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{status.message}</div> : null}
        </div>
      </div>
    </section>
  );
}

function FanFeedCard({ model }: { model: TeamDetailModel }) {
  const feedUrl = buildPublicTeamGamesIcsUrl(model.team.id);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  async function shareFanFeed() {
    const result = await sharePublicUrl({
      title: `${model.team.name} fan feed`,
      text: `${model.team.name} public games calendar feed`,
      url: feedUrl,
      clipboardText: feedUrl
    });
    if (result === 'shared') {
      setStatus({ success: true, message: 'Fan feed share sheet opened.' });
    } else if (result === 'copied') {
      setStatus({ success: true, message: 'Fan feed link copied.' });
    } else {
      setStatus({ success: false, message: 'Unable to share the fan feed from this device.' });
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Fan Feed</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Share a public games-only calendar link for fans. Practices, private notes, RSVPs, and assignments stay out of this feed.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="primary-button !min-h-9 text-xs" onClick={shareFanFeed}>
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              Copy or Share Fan Feed
            </button>
          </div>
          {status ? <div className={`mt-2 text-xs font-black ${status.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{status.message}</div> : null}
        </div>
      </div>
    </section>
  );
}

function RegistrationProviderCard({ rows }: { rows: TeamDetailModel['team']['registrationProvider'] }) {
  const [copyStatus, setCopyStatus] = useState<{ label: string; success: boolean } | null>(null);

  async function copyValue(label: string, value: string) {
    const result = await copyPublicText(value);
    setCopyStatus({ label, success: result === 'copied' });
  }

  return (
    <section className="app-card p-4">
      <div className="text-sm font-black text-gray-950">Registration provider</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">This team syncs registrations from an external provider.</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded-xl border border-blue-100 bg-blue-50 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.04em] text-blue-700">{row.label}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="min-w-0 break-all text-sm font-black text-gray-950">{row.value}</div>
              {row.copyable ? (
                <button
                  type="button"
                  className="flex-none rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-black text-blue-700 hover:bg-blue-100"
                  aria-label={`Copy ${row.label}`}
                  onClick={() => void copyValue(row.label, row.value)}
                >
                  Copy
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {copyStatus ? (
        <div className={`mt-2 text-xs font-bold ${copyStatus.success ? 'text-emerald-700' : 'text-rose-700'}`}>
          {copyStatus.success ? `${copyStatus.label} copied.` : `Unable to copy ${copyStatus.label}.`}
        </div>
      ) : null}
    </section>
  );
}

function ScoreboardWidgetCard({ model }: { model: TeamDetailModel }) {
  const widgetUrl = buildScoreboardWidgetUrl(model.team.id);
  const embedCode = buildScoreboardWidgetEmbedCode(model.team);
  const [copyStatus, setCopyStatus] = useState<{ kind: 'embed' | 'link'; success: boolean } | null>(null);

  if (model.team.isExplicitlyPublic !== true) {
    return (
      <section className="app-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gray-100 text-gray-600">
            <Code2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-black text-gray-950">Scoreboard widget unavailable</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">This team is private. Make the team public before sharing a scoreboard link or embed.</div>
          </div>
        </div>
      </section>
    );
  }

  async function copyValue(kind: 'embed' | 'link', value: string) {
    const result = await copyPublicText(value);
    setCopyStatus({ kind, success: result === 'copied' });
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <Code2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Scoreboard widget</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Copy a read-only public link or iframe embed for this team&apos;s live scoreboard.</div>
          <label className="mt-3 block text-[11px] font-black uppercase tracking-[0.04em] text-gray-500" htmlFor="scoreboard-widget-embed">Embed code</label>
          <textarea
            id="scoreboard-widget-embed"
            className="mt-1 h-24 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 p-3 font-mono text-xs font-semibold text-gray-700"
            readOnly
            value={embedCode}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="primary-button !min-h-9 text-xs" onClick={() => copyValue('embed', embedCode)}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy Embed Code
            </button>
            <button type="button" className="secondary-button !min-h-9 text-xs" onClick={() => copyValue('link', widgetUrl)}>
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              Copy Link
            </button>
          </div>
          {copyStatus ? (
            <div className={`mt-2 flex items-center gap-2 text-xs font-black ${copyStatus.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {copyStatus.success
                ? `${copyStatus.kind === 'embed' ? 'Embed code' : 'Widget link'} copied.`
                : `Unable to copy ${copyStatus.kind === 'embed' ? 'embed code' : 'widget link'}. Select the field and copy manually.`}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function buildScoreboardWidgetUrl(teamId: string, baseUrl = getPublicBaseUrl()) {
  const url = new URL('/widget-scoreboard.html', baseUrl);
  url.searchParams.set('teamId', teamId);
  return url.toString();
}

export function buildScoreboardWidgetEmbedCode(team: { id: string; name: string }, baseUrl?: string) {
  const widgetUrl = buildScoreboardWidgetUrl(team.id, baseUrl);
  const title = escapeHtmlAttribute(`${team.name || 'Team'} live scoreboard`);
  return `<iframe src="${escapeHtmlAttribute(widgetUrl)}" title="${title}" style="width: 100%; max-width: 720px; height: 480px; border: 0;" loading="lazy"></iframe>`;
}

function getPublicBaseUrl() {
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
    return window.location.origin;
  }
  return 'https://allplays.ai';
}

function escapeHtmlAttribute(value: string) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));
}

function StaffPermissionsCard({ model, auth, onInviteSuccess }: { model: TeamDetailModel; auth: AuthState; onInviteSuccess: () => Promise<void> }) {
  const summary = model.staffPermissions;
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InviteTeamAdminForAppResult | null>(null);
  const [grantingUserId, setGrantingUserId] = useState<string | null>(null);
  const [removingAdminEmail, setRemovingAdminEmail] = useState<string | null>(null);
  const [grantStatus, setGrantStatus] = useState<{ success: boolean; message: string } | null>(null);
  if (!summary) return null;
  const scorekeeperGrantTargets = summary.scorekeeperGrantTargets || [];
  const teamMediaManagerGrantTargets = summary.teamMediaManagerGrantTargets || [];
  const videographerGrantTargets = summary.videographerGrantTargets || [];
  const isAllConfirmedScorekeeping = summary.scorekeepingMode === 'all_confirmed';
  const existingEmails = getStaffPermissionEmails(summary);

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setResult(null);
    if (!normalizedEmail) {
      setError('Enter an admin email.');
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (existingEmails.has(normalizedEmail)) {
      setError('That email is already listed as staff or pending.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const inviteResult = await inviteTeamAdminForApp(model.team.id, normalizedEmail, auth.user || null);
      if (inviteResult.status === 'fallback_code' && !inviteResult.code && !inviteResult.acceptInviteUrl) {
        setError('Unable to create an admin invite code. Try again.');
        return;
      }
      setResult(inviteResult);
      setEmail('');
      await onInviteSuccess();
    } catch (submitError: any) {
      setError(submitError?.message || 'Unable to send admin invite.');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeAdmin(emailToRemove: string) {
    if (!emailToRemove || removingAdminEmail) return;
    const confirmed = window.confirm(`Remove ${emailToRemove} as a team admin?`);
    if (!confirmed) return;
    setRemovingAdminEmail(emailToRemove);
    setGrantStatus(null);
    setResult(null);
    try {
      await revokeTeamAdminAccessForApp(model.team.id, emailToRemove, auth.user || null);
      setGrantStatus({ success: true, message: `${emailToRemove} removed from team admins.` });
      await onInviteSuccess();
    } catch (removeError: any) {
      setGrantStatus({ success: false, message: removeError?.message || 'Unable to remove this team admin.' });
    } finally {
      setRemovingAdminEmail(null);
    }
  }

  async function toggleScorekeeperGrant(memberUserId: string, isGranted: boolean) {
    if (!memberUserId || grantingUserId) return;
    setGrantingUserId(memberUserId);
    setGrantStatus(null);
    setResult(null);
    try {
      if (isGranted) {
        await revokeScorekeeperAccessForApp(model.team.id, memberUserId);
      } else {
        await grantScorekeeperAccessForApp(model.team.id, memberUserId);
      }
      setGrantStatus({ success: true, message: isGranted ? 'Scorekeeper access revoked.' : 'Scorekeeper access granted.' });
      await onInviteSuccess();
    } catch (grantError: any) {
      setGrantStatus({ success: false, message: grantError?.message || 'Unable to update scorekeeper access.' });
    } finally {
      setGrantingUserId(null);
    }
  }

  async function toggleVideographerGrant(memberUserId: string, isGranted: boolean) {
    if (!memberUserId || grantingUserId) return;
    setGrantingUserId(memberUserId);
    setGrantStatus(null);
    setResult(null);
    try {
      if (isGranted) {
        await revokeVideographerAccessForApp(model.team.id, memberUserId);
      } else {
        await grantVideographerAccessForApp(model.team.id, memberUserId);
      }
      setGrantStatus({ success: true, message: isGranted ? 'Videographer access revoked.' : 'Videographer access granted.' });
      await onInviteSuccess();
    } catch (grantError: any) {
      setGrantStatus({ success: false, message: grantError?.message || 'Unable to update videographer access.' });
    } finally {
      setGrantingUserId(null);
    }
  }

  async function toggleTeamMediaManagerGrant(memberUserId: string, isGranted: boolean) {
    if (!memberUserId || grantingUserId) return;
    setGrantingUserId(memberUserId);
    setGrantStatus(null);
    setResult(null);
    try {
      if (isGranted) {
        await revokeTeamMediaManagerAccessForApp(model.team.id, memberUserId);
      } else {
        await grantTeamMediaManagerAccessForApp(model.team.id, memberUserId);
      }
      setGrantStatus({ success: true, message: isGranted ? 'Team Media manager access revoked.' : 'Team Media manager access granted.' });
      await onInviteSuccess();
    } catch (grantError: any) {
      setGrantStatus({ success: false, message: grantError?.message || 'Unable to update Team Media manager access.' });
    } finally {
      setGrantingUserId(null);
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Team Staff &amp; Permissions</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Owners and platform admins can manage team admins here in the app. Scoped helpers cover scorekeeping, Stream &amp; Score, Team Media, video, and volunteer tasks.</div>
        </div>
      </div>

      {model.canManageAdmins ? (
        <form className="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-3" onSubmit={submitInvite} noValidate>
          <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Invite admin</div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="team-admin-invite-email">Admin email</label>
            <input
              id="team-admin-invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="send"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError('');
              }}
              className="min-h-10 flex-1 rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              placeholder="coach@example.com"
              disabled={submitting}
              aria-invalid={Boolean(error)}
            />
            <button type="submit" className="primary-button !min-h-10 text-xs" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Send invite
            </button>
          </div>
          {error ? <div className="mt-2 text-xs font-black text-rose-700" role="alert">{error}</div> : null}
          {result ? (
            result.code || result.acceptInviteUrl ? (
              <InviteResultCard
                code={result.code}
                inviteUrl={result.acceptInviteUrl}
                recipientEmail={result.email}
                emailSent={result.status === 'sent'}
                title="Invite code"
                shareTitle={`${model.team.name} staff invite`}
                shareText={`Join ${model.team.name} staff on ALL PLAYS.`}
                onStatus={(message) => setGrantStatus({ success: !message.startsWith('Unable'), message })}
              />
            ) : (
              <div className="mt-3 rounded-lg border border-white/80 bg-white p-3 text-xs font-black text-gray-950" role="status">
                {result.email} already has an account and was added as an admin.
              </div>
            )
          ) : null}
        </form>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-semibold text-gray-600">Only the team owner or a platform admin can add or remove team admins.</div>
      )}

      {isAllConfirmedScorekeeping ? (
        <div className="mt-4 rounded-xl border border-primary-100 bg-white p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Scorekeeper helper access</div>
          <p className="mt-2 text-xs font-semibold leading-5 text-gray-600">All confirmed team members can score games, so individual scorekeeper grants are disabled to preserve that team-wide access.</p>
        </div>
      ) : scorekeeperGrantTargets.length ? (
        <PermissionGrantPanel
          title="Scorekeeper helper access"
          description="Grant an existing linked team member scorekeeping duty without making them a full admin or giving roster, schedule, settings, or broader team access."
          targets={scorekeeperGrantTargets}
          grantingUserId={grantingUserId}
          onToggle={toggleScorekeeperGrant}
          grantedText="Can score games."
          emptyText="No scorekeeper helper grant."
          grantLabel="Grant scorekeeper"
          revokeLabel="Revoke scorekeeper"
        />
      ) : null}

      {videographerGrantTargets.length ? (
        <PermissionGrantPanel
          title="Videographer access"
          description="Grant an existing linked team member live-game camera and media capture access only. This does not grant roster, schedule, RSVP, or full team admin rights."
          targets={videographerGrantTargets}
          grantingUserId={grantingUserId}
          onToggle={toggleVideographerGrant}
          grantedText="Can capture live-game camera and media."
          emptyText="No videographer helper grant."
          grantLabel="Grant videographer"
          revokeLabel="Revoke videographer"
        />
      ) : null}

      {teamMediaManagerGrantTargets.length ? (
        <PermissionGrantPanel
          title="Team Media manager access"
          description="Grant an existing linked team member album, visibility, upload, video-link, and media moderation access without full roster, schedule, or settings admin rights."
          targets={teamMediaManagerGrantTargets}
          grantingUserId={grantingUserId}
          onToggle={toggleTeamMediaManagerGrant}
          grantedText="Can manage albums, visibility, uploads, and video links."
          emptyText="No Team Media manager grant."
          grantLabel="Grant media manager"
          revokeLabel="Revoke media manager"
        />
      ) : null}

      {grantStatus ? <div className={`mt-2 text-xs font-black ${grantStatus.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{grantStatus.message}</div> : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.04em] text-indigo-700">Owner, admins, and invites</div>
          <div className="mt-2 space-y-2">
            {summary.staff.length ? summary.staff.map((member) => {
              const canRemove = model.canManageAdmins && member.role === 'Admin';
              const busy = removingAdminEmail === member.label;
              return (
                <div key={`${member.role}:${member.label}`} className="flex items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-white px-3 py-2">
                  <span className="min-w-0 truncate text-xs font-black text-indigo-800">{member.label} · {member.role}</span>
                  {canRemove ? (
                    <button type="button" className="secondary-button !min-h-8 flex-none text-xs !border-rose-200 !bg-rose-50 !text-rose-700" disabled={Boolean(removingAdminEmail)} onClick={() => removeAdmin(member.label)}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                      Remove
                    </button>
                  ) : null}
                </div>
              );
            }) : null}
            {summary.pendingInvites.length ? summary.pendingInvites.map((inviteEmail) => (
              <div key={`pending:${inviteEmail}`} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-800">{inviteEmail} · Pending admin invite</div>
            )) : null}
            {!summary.staff.length && !summary.pendingInvites.length ? <PillList items={[]} emptyText="No owner, admin staff, or pending admin invites found." tone="border-indigo-200 bg-white text-indigo-800" /> : null}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.04em] text-emerald-700">Admin vs game-day helpers</div>
          <p className="mt-2 text-xs font-semibold leading-5 text-emerald-800">Stream &amp; Score means scorekeeping plus streaming capability. It does not grant roster, schedule, RSVP, scoring setup, or full team settings access.</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.helperPermissions.map((permission) => (
          <div key={permission.key} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-700">{permission.title}</div>
            <PillList items={permission.grants} emptyText={permission.emptyText} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PermissionGrantPanel({
  title,
  description,
  targets,
  grantingUserId,
  onToggle,
  grantedText,
  emptyText,
  grantLabel,
  revokeLabel
}: {
  title: string;
  description: string;
  targets: TeamScorekeeperGrantTarget[];
  grantingUserId: string | null;
  onToggle: (memberUserId: string, isGranted: boolean) => Promise<void>;
  grantedText: string;
  emptyText: string;
  grantLabel: string;
  revokeLabel: string;
}) {
  return (
    <div className="mt-4 rounded-xl border border-primary-100 bg-white p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">{title}</div>
      <p className="mt-2 text-xs font-semibold leading-5 text-gray-600">{description}</p>
      <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
        {targets.map((target) => {
          const busy = grantingUserId === target.userId;
          const detail = target.playerNames.length ? `Linked to ${target.playerNames.join(', ')}.` : 'Linked team member account.';
          return (
            <div key={target.userId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-gray-950">{target.name || target.email || 'Team member'}</div>
                <div className="text-xs font-semibold leading-5 text-gray-500">{target.isGranted ? `${grantedText} ${detail}` : `${emptyText} ${detail}`}</div>
              </div>
              <button type="button" className={`secondary-button !min-h-9 flex-none text-xs ${target.isGranted ? '!border-rose-200 !bg-rose-50 !text-rose-700' : ''}`} disabled={Boolean(grantingUserId)} onClick={() => onToggle(target.userId, target.isGranted)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {target.isGranted ? revokeLabel : grantLabel}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function getStaffPermissionEmails(summary: NonNullable<TeamDetailModel['staffPermissions']>) {
  const emails = new Set<string>();
  summary.staff.forEach((member) => {
    const value = member.label.trim().toLowerCase();
    if (value.includes('@')) emails.add(value);
  });
  summary.pendingInvites.forEach((inviteEmail) => {
    const value = inviteEmail.trim().toLowerCase();
    if (value) emails.add(value);
  });
  return emails;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function PillList({ items, emptyText, tone = 'border-gray-200 bg-white text-gray-700' }: { items: string[]; emptyText: string; tone?: string }) {
  if (!items.length) {
    return <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-white/70 p-3 text-xs font-semibold italic text-gray-500">{emptyText}</div>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((item) => <span key={item} className={`rounded-full border px-2.5 py-1 text-xs font-black ${tone}`}>{item}</span>)}
    </div>
  );
}

function TeamPassCard({ model }: { model: TeamDetailModel }) {
  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <Ticket className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Team Pass</div>
          <div className="mt-1 text-sm font-semibold leading-6 text-gray-600">
            Parents can view team content through their team access. Staff-managed pass setup and checkout stay on the current website until the payment flow is migrated.
          </div>
          <button type="button" className="ghost-button mt-3 !min-h-9 text-xs" onClick={() => openPublicUrl(model.team.websiteUrl)}>
            Open website team page
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function InfoCard({ icon: Icon, title, value, detail, to, href }: { icon: LucideIcon; title: string; value: string; detail: string; to?: string; href?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
        {(to || href) ? <ChevronRight className="h-4 w-4 text-gray-300" aria-hidden="true" /> : null}
      </div>
      <div className="mt-3 text-xs font-black uppercase tracking-[0.04em] text-gray-500">{title}</div>
      <div className="mt-1 truncate text-xl font-black text-gray-950">{value}</div>
      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-gray-600">{detail}</div>
    </>
  );

  if (to) return <Link to={to} className="app-card p-4 transition hover:border-primary-200">{body}</Link>;
  if (href) {
    return (
      <a
        href={href}
        className="app-card p-4 transition hover:border-primary-200"
        onClick={(event) => {
          event.preventDefault();
          void openPublicUrl(href);
        }}
      >
        {body}
      </a>
    );
  }
  return <div className="app-card p-4">{body}</div>;
}

function SummaryStat({ icon: Icon, label, value, to }: { icon: LucideIcon; label: string; value: string; to?: string }) {
  const body = (
    <>
      <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
      <div className="mt-1 truncate text-sm font-black text-gray-950">{value}</div>
      <div className="truncate text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
    </>
  );
  const className = 'block rounded-xl border border-gray-200 bg-gray-50 p-2 text-left transition hover:border-primary-200 hover:bg-primary-50/40';
  return to ? <Link to={to} className={className}>{body}</Link> : <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">{body}</div>;
}

function TeamEventRow({ event, model, auth, reminderPreviewLoader, onOpenStatTrackerConfigs }: { event: TeamDetailEvent; model: TeamDetailModel; auth: AuthState; reminderPreviewLoader: ReturnType<typeof createStaffRsvpReminderPreviewLoader>; onOpenStatTrackerConfigs: () => void }) {
  const childId = '';
  const teamId = model.team.id;
  const eventPath = getEventDetailPath({ teamId, id: event.id, childId });
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50/30">
      <div className="flex items-center gap-3">
        <Link to={eventPath} className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-xl bg-gray-100 text-gray-700">
            <span className="text-[10px] font-black uppercase">{event.date.toLocaleDateString(undefined, { month: 'short' })}</span>
            <span className="text-lg font-black leading-none">{event.date.getDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-black text-gray-950">{event.title}</div>
              {event.type === 'practice' ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">Practice</span> : null}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-gray-500">
              <span>{event.date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
              <span className="truncate">{event.location}</span>
            </div>
            {event.locationDetail ? (
              <div className="mt-1 inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-black text-primary-800">
                {event.locationDetail}
              </div>
            ) : null}
            {model.canManageTeam && event.type === 'game' ? <TeamEventStatConfigSummary event={event} onOpenStatTrackerConfigs={onOpenStatTrackerConfigs} /> : null}
          </div>
          {event.homeScore !== null && event.awayScore !== null ? <div className="text-sm font-black text-gray-950">{event.homeScore}-{event.awayScore}</div> : null}
          <ChevronRight className="h-4 w-4 flex-none text-gray-300" aria-hidden="true" />
        </Link>
      </div>
      <TeamEventReminderAction event={event} model={model} auth={auth} reminderPreviewLoader={reminderPreviewLoader} />
    </div>
  );
}

function TeamEventStatConfigSummary({ event, onOpenStatTrackerConfigs }: { event: TeamDetailEvent; onOpenStatTrackerConfigs: () => void }) {
  const pillClassName = event.statTrackerConfigId
    ? (event.statTrackerConfigExists ? 'bg-primary-50 text-primary-700' : 'bg-rose-50 text-rose-700')
    : 'bg-gray-100 text-gray-700';

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
      <span className={`rounded-full px-2 py-0.5 font-black ${pillClassName}`}>{event.statTrackerConfigLabel}</span>
      {event.statTrackerConfigIsBasketball ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-black text-amber-800">Basketball</span> : null}
      {event.statTrackerConfigId && event.statTrackerConfigExists ? (
        <button type="button" className="font-black text-primary-700" onClick={(clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          onOpenStatTrackerConfigs();
        }}>
          View config
        </button>
      ) : null}
    </div>
  );
}

function TeamEventReminderAction({ event, model, auth, reminderPreviewLoader }: { event: TeamDetailEvent; model: TeamDetailModel; auth: AuthState; reminderPreviewLoader: ReturnType<typeof createStaffRsvpReminderPreviewLoader> }) {
  const [preview, setPreview] = useState<StaffRsvpReminderPreview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const { loading, error: previewError, clearError: clearPreviewError, run: runPreviewOperation } = useAppAsyncOperation();
  const { loading: sending, error: sendError, clearError: clearSendError, run: runSendOperation } = useAppAsyncOperation();
  const [revealed, setRevealed] = useState(false);
  const scheduleEvent = useMemo(() => buildTeamReminderScheduleEvent(event, model), [event, model]);
  const canLoad = Boolean(auth.user && scheduleEvent && model.canManageTeam && event.date.getTime() >= Date.now() && event.status.toLowerCase() !== 'completed');

  useEffect(() => {
    setPreview(null);
    setStatus(null);
    clearPreviewError();
    clearSendError();
    setRevealed(false);
  }, [auth.user?.uid, canLoad, clearPreviewError, clearSendError, scheduleEvent?.eventKey]);

  if (!scheduleEvent || !canLoad) return null;

  const loadPreview = async () => {
    const user = auth.user;
    if (!user || loading || sending) return;
    setRevealed(true);
    clearSendError();
    setStatus(null);
    await runPreviewOperation(
      () => reminderPreviewLoader.loadPreview(scheduleEvent, user),
      {
        fallbackMessage: 'Unable to load RSVP reminder preview.',
        onSuccess: (nextPreview) => {
          setPreview(nextPreview);
        }
      }
    );
  };

  if (!revealed) {
    return (
      <div className="mt-3 flex justify-start">
        <button type="button" className="secondary-button !min-h-9 px-3 text-xs" onClick={loadPreview}>
          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
          Review reminder
        </button>
      </div>
    );
  }

  if (loading && !preview) {
    return (
      <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50 p-3 text-xs font-semibold text-gray-600">
        Loading RSVP reminder preview…
      </div>
    );
  }

  if (previewError && !preview) {
    return (
      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
        <div className="text-xs font-bold text-rose-700">{previewError.message}</div>
        {isRetryableAppServiceError(previewError) ? <button type="button" className="secondary-button mt-2 !min-h-9 px-3 text-xs" onClick={loadPreview}>
          Retry reminder preview
        </button> : null}
      </div>
    );
  }

  if (!preview) return null;

  if (preview.missingPlayerCount <= 0) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
        All player RSVPs are in.
      </div>
    );
  }

  const sendReminder = async () => {
    const user = auth.user;
    if (!user || sending) return;
    const confirmed = window.confirm(`Send an RSVP reminder to ${preview.missingPlayerCount} no-response ${preview.missingPlayerCount === 1 ? 'player' : 'players'}? ${preview.eligibleEmailCount} eligible parent/guardian ${preview.eligibleEmailCount === 1 ? 'email' : 'emails'} will be targeted.`);
    if (!confirmed) return;
    clearPreviewError();
    setStatus(null);
    await runSendOperation(
      () => sendStaffRsvpReminder(scheduleEvent, user, auth.profile || {}) as Promise<StaffRsvpReminderSendResult>,
      {
        fallbackMessage: 'Unable to send RSVP reminder.',
        onSuccess: (result) => {
          setPreview(result);
          setStatus(`RSVP reminder sent to team chat and ${result.emailSentCount} parent/guardian ${result.emailSentCount === 1 ? 'email' : 'emails'}.`);
        }
      }
    );
  };

  return (
    <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-semibold leading-5 text-gray-600">
          <span className="font-black text-gray-950">Staff RSVP reminder</span> · {preview.missingPlayerCount} no-response {preview.missingPlayerCount === 1 ? 'player' : 'players'}.
        </div>
        <button type="button" className="primary-button min-h-9 flex-none px-3 text-xs" disabled={sending || loading} onClick={sendReminder}>
          {sending ? 'Sending…' : `Send reminder (${preview.missingPlayerCount})`}
        </button>
      </div>
      {status ? <div className="mt-2 text-xs font-bold text-emerald-700">{status}</div> : null}
      {sendError ? <div className="mt-2 text-xs font-bold text-rose-700">{sendError.message}</div> : null}
    </div>
  );
}

function buildTeamReminderScheduleEvent(event: TeamDetailEvent, model: TeamDetailModel): ParentScheduleEvent | null {
  if (!model.canManageTeam || event.isDbGame === false || event.isCancelled || !event.id || !event.date) return null;
  return {
    eventKey: `${model.team.id}:${event.id}`,
    id: event.id,
    teamId: model.team.id,
    teamName: model.team.name,
    type: event.type,
    date: event.date,
    location: event.location,
    opponent: event.opponent,
    title: event.title,
    childId: '',
    childName: '',
    isDbGame: true,
    isCancelled: event.isCancelled,
    status: event.status,
    homeScore: event.homeScore,
    awayScore: event.awayScore,
    assignments: [],
    openAssignmentCount: 0,
    isTeamStaff: true,
    isTeamRsvpReminderManager: true
  };
}
function ExternalAction({ icon: Icon, label, detail, href }: { icon: LucideIcon; label: string; detail: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40"
      onClick={(event) => {
        event.preventDefault();
        void openPublicUrl(href);
      }}
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white text-primary-700">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-gray-950">{label}</span>
        <span className="line-clamp-1 text-xs font-semibold text-gray-500">{detail}</span>
      </span>
      <ExternalLink className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </a>
  );
}

function InternalAction({ icon: Icon, label, detail, to }: { icon: LucideIcon; label: string; detail: string; to: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white text-primary-700">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-gray-950">{label}</span>
        <span className="line-clamp-1 text-xs font-semibold text-gray-500">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </Link>
  );
}

function SponsorImage({ sponsor }: { sponsor: { name: string; imageUrl: string | null } }) {
  if (sponsor.imageUrl) return <img src={sponsor.imageUrl} alt={`${sponsor.name} sponsor logo`} className="h-12 w-12 flex-none rounded-xl object-cover" loading="lazy" />;
  return (
    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-white text-gray-500">
      <LinkIcon className="h-5 w-5" aria-hidden="true" />
    </span>
  );
}

function formatRecord(record: TeamDetailModel['record']) {
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}`;
}

function getStandingValue(model: TeamDetailModel) {
  const row = model.standings.currentRow;
  if (!row) return model.team.leagueUrl ? 'League link' : 'Not set';
  return formatStandingsRecord(row);
}

function getStandingDetail(model: TeamDetailModel) {
  const row = model.standings.currentRow;
  if (!row) return model.team.leagueUrl ? 'Open league page for standings' : 'No standings configured';
  const rank = typeof row.rank === 'number' ? `#${row.rank}` : model.standings.label;
  const contextColumn = getStandingsContextColumn(model.standings.rows, model.standings.label);
  return `${rank} · ${contextColumn.label} ${contextColumn.value(row)}`;
}

function getStandingsRowKey(row: Record<string, any> | null | undefined) {
  if (!row) return 'current-row';
  return `${cleanStandingsCell(row.team) || 'team'}::${cleanStandingsCell(row.rank) || 'rank'}`;
}

function getStandingsTeamName(row: Record<string, any> | null | undefined) {
  return cleanStandingsCell(row?.team) || '—';
}

function formatStandingsRank(row: Record<string, any> | null | undefined) {
  return typeof row?.rank === 'number' ? `#${row.rank}` : '—';
}

function formatStandingsRecord(row: Record<string, any> | null | undefined) {
  if (!row) return '—';
  const explicitRecord = cleanStandingsCell(row.record);
  if (explicitRecord) return explicitRecord;
  const wins = toStandingsNumber(row.w);
  const losses = toStandingsNumber(row.l);
  const ties = toStandingsNumber(row.t);
  if (wins === null && losses === null && ties === null) return '—';
  return `${wins ?? 0}-${losses ?? 0}${ties ? `-${ties}` : ''}`;
}

function getCollapsedStandingsRows(rows: Array<Record<string, any>>, highlightedRowIndex: number, limit: number) {
  if (rows.length <= limit || highlightedRowIndex < 0 || highlightedRowIndex < limit) {
    return rows.slice(0, limit);
  }
  return rows.slice(0, Math.max(limit - 1, 0)).concat(rows[highlightedRowIndex]);
}

function getStandingsContextColumn(rows: Array<Record<string, any>> = [], label = '') {
  const safeRows = Array.isArray(rows) ? rows : [];
  const normalizedLabel = label.toLowerCase();
  if (normalizedLabel.includes('win percentage')) {
    return {
      label: 'PCT',
      value: (row: Record<string, any>) => {
        const winPct = row?.winPct;
        if (typeof winPct === 'number' && Number.isFinite(winPct)) return winPct.toFixed(3);
        const stringPct = cleanStandingsCell(winPct);
        return stringPct || '—';
      }
    };
  }

  const hasPoints = safeRows.some((row) => toStandingsNumber(row?.points) !== null);
  if (hasPoints || normalizedLabel.includes('points')) {
    return {
      label: 'PTS',
      value: (row: Record<string, any>) => formatStandingsCellValue(toStandingsNumber(row?.points))
    };
  }

  const hasGoalsForAgainst = safeRows.some((row) => toStandingsNumber(row?.pf) !== null || toStandingsNumber(row?.pa) !== null);
  if (hasGoalsForAgainst) {
    return {
      label: 'PF/PA',
      value: (row: Record<string, any>) => `${formatStandingsCellValue(toStandingsNumber(row?.pf))}/${formatStandingsCellValue(toStandingsNumber(row?.pa))}`
    };
  }

  return {
    label: 'PCT',
    value: (row: Record<string, any>) => {
      const winPct = row?.winPct;
      if (typeof winPct === 'number' && Number.isFinite(winPct)) return winPct.toFixed(3);
      const stringPct = cleanStandingsCell(winPct);
      return stringPct || '—';
    }
  };
}

function formatStandingsCellValue(value: number | string | null) {
  if (value === null || value === '') return '—';
  return String(value);
}

function toStandingsNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanStandingsCell(value: unknown) {
  return String(value ?? '').trim();
}

function formatEventDate(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'T';
}
