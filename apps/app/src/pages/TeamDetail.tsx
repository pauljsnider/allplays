import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Award,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  Dumbbell,
  ExternalLink,
  ImageIcon,
  Loader2,
  MessageCircle,
  Radio,
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
import { openPublicUrl } from '../lib/publicActions';
import { isRetryableAppServiceError, toAppServiceError, type AppServiceError } from '../lib/appErrors';
import { useAppAsyncOperation } from '../lib/useAsyncOperation';
import { getEventDetailPath } from '../lib/homeLogic';
import { createStaffRsvpReminderPreviewLoader, loadParentSchedule, sendStaffRsvpReminder, type StaffRsvpReminderSendResult } from '../lib/scheduleService';
import type { ParentScheduleEvent, StaffRsvpReminderPreview } from '../lib/scheduleLogic';
import { createTeamPassCheckoutForApp, loadParentTeamDetail, loadParentTeamDetailBootstrap, loadTeamDetailInsights, loadTeamDetailSponsors, loadTeamRosterParentInvites, loadTeamStaffPermissions, loadTeamTrackingAdmin, type TeamDetailEvent, type TeamDetailModel, type TeamRosterParentInviteSummary, type TeamTrackingAdminItem } from '../lib/teamDetailService';
import { useViewLoadTimer } from '../lib/viewLoadTiming';
import { buildTeamDetailNavigation, type TeamNavigationItem, type TeamNavigationSection } from '../lib/teamNavigation';
import type { AuthState } from '../lib/types';
import { PREMIUM_FEATURES, PREMIUM_SCOPES, type PremiumAccessResult } from '../lib/premiumAccessService';
import { usePremiumFeatureAccess } from '../lib/usePremiumFeatureAccess';
import { useRefreshOnResume } from '../lib/useRefreshOnResume';
import { loadInsightsTab } from './team-detail/insightsTabLoader';
import { loadMoreTab } from './team-detail/moreTabLoader';
import { loadRosterTab } from './team-detail/rosterTabLoader';

type TeamTab = 'overview' | 'schedule' | 'roster' | 'insights' | 'more';

type AuthoritativeTeamSchedule = {
  teamId: string;
  userId: string;
  events: ParentScheduleEvent[];
};

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
  const [premiumRefreshVersion, setPremiumRefreshVersion] = useState(0);
  const teamPassCheckoutReturnArmedRef = useRef(false);
  const parentTeamIds = [auth.user?.parentTeamIds, auth.profile?.parentTeamIds]
    .flatMap((values) => Array.isArray(values) ? values : []);
  const hasLoadedTeamAccess = model?.team.id === teamId && Boolean(
    model.canManageTeam ||
    model.linkedPlayers.length ||
    parentTeamIds.includes(teamId)
  );
  const teamPremiumAccess = usePremiumFeatureAccess({
    scope: PREMIUM_SCOPES.TEAM,
    feature: PREMIUM_FEATURES.TEAM_ANALYTICS,
    user: auth.user,
    normalAccess: hasLoadedTeamAccess,
    teamId,
    currentSeasonId: model?.team.currentSeasonId || '',
    refreshVersion: premiumRefreshVersion
  });
  useRefreshOnResume(() => {
    if (!teamPassCheckoutReturnArmedRef.current) return;
    teamPassCheckoutReturnArmedRef.current = false;
    setPremiumRefreshVersion((current) => current + 1);
  }, { enabled: Boolean(auth.user?.uid && teamId), staleAfterMs: 0 });
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
  const [moreTabRetryVersion, setMoreTabRetryVersion] = useState(0);
  const LazyMoreTab = useMemo(() => {
    void moreTabRetryVersion;
    return lazy(loadMoreTab);
  }, [moreTabRetryVersion]);
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
  const [authoritativeSchedule, setAuthoritativeSchedule] = useState<AuthoritativeTeamSchedule | null>(null);
  const [authoritativeScheduleLoading, setAuthoritativeScheduleLoading] = useState(false);
  const [authoritativeScheduleError, setAuthoritativeScheduleError] = useState('');
  const [authoritativeScheduleReloadVersion, setAuthoritativeScheduleReloadVersion] = useState(0);
  const authUserRef = useRef(auth.user);
  const activeTabRef = useRef(activeTab);
  const detailCollectionsLoadingRef = useRef(detailCollectionsLoading);
  const staffPermissionsLoadingRef = useRef(staffPermissionsLoading);
  const insightsLoadingRef = useRef(insightsLoading);
  const insightsRequestRef = useRef<{ key: string; request: ReturnType<typeof loadTeamDetailInsights> } | null>(null);
  const sponsorsLoadingRef = useRef(sponsorsLoading);
  const hasTeamModel = Boolean(model);
  const canManageTeam = Boolean(model?.canManageTeam);
  const hasStaffPermissions = Boolean(model?.staffPermissions);

  const authoritativeTeamSchedule = authoritativeSchedule?.teamId === teamId && authoritativeSchedule.userId === authUserId
    ? authoritativeSchedule
    : null;
  const authoritativeScheduleSummary = useMemo(() => {
    if (!authoritativeTeamSchedule) return null;
    const now = Date.now();
    return {
      upcomingCount: countUpcomingTeamScheduleEvents(authoritativeTeamSchedule.events, teamId, now),
      nextEvent: getNextTeamScheduleEvent(authoritativeTeamSchedule.events, teamId, now)
    };
  }, [authoritativeTeamSchedule, teamId]);
  const authoritativeUpcomingCount = authoritativeScheduleSummary?.upcomingCount ?? null;
  const authoritativeNextEvent = authoritativeScheduleSummary ? authoritativeScheduleSummary.nextEvent : undefined;
  const authoritativeSchedulePending = authoritativeScheduleLoading || Boolean(
    authUserId
    && model?.team.id === teamId
    && !authoritativeTeamSchedule
    && !authoritativeScheduleError
  );

  useEffect(() => {
    setAuthoritativeSchedule(null);
    setAuthoritativeScheduleLoading(false);
    setAuthoritativeScheduleError('');
    setAuthoritativeScheduleReloadVersion(0);
  }, [authUserId, teamId]);

  useEffect(() => {
    const previousTab = activeTabRef.current;
    activeTabRef.current = activeTab;
    if (activeTab === 'schedule' && previousTab !== 'schedule') {
      setAuthoritativeScheduleReloadVersion((current) => current + 1);
    }
  }, [activeTab]);

  useEffect(() => {
    authUserRef.current = auth.user;
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
        const nextModel = await loadParentTeamDetailBootstrap(teamId, authUserRef.current);
        if (!cancelled) {
          setModel(nextModel);
          setDetailCollectionsLoaded(false);
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

    async function loadAuthoritativeTeamSchedule() {
      if (!teamId || !authUserId || model?.team.id !== teamId) return;
      setAuthoritativeScheduleLoading(true);
      setAuthoritativeScheduleError('');
      try {
        const loadOptions = {
          hydrateDetails: false,
          expandStaffPlayers: false,
          targetTeamId: teamId,
          includePastGames: true
        } as const;
        let result = await loadParentSchedule(authUserRef.current, loadOptions);
        if (cancelled) return;
        if (result.isPartial !== false) {
          result = await loadParentSchedule(authUserRef.current, loadOptions);
        }
        if (result.isPartial !== false) {
          throw new Error('The complete team schedule could not be loaded. Retry to avoid showing missing events.');
        }
        if (!cancelled) {
          setAuthoritativeSchedule({
            teamId,
            userId: authUserId,
            events: result.events.filter((event) => event.teamId === teamId)
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setAuthoritativeScheduleError(loadError instanceof Error && loadError.message
            ? loadError.message
            : 'Unable to load the team schedule.');
        }
      } finally {
        if (!cancelled) setAuthoritativeScheduleLoading(false);
      }
    }

    void loadAuthoritativeTeamSchedule();
    return () => {
      cancelled = true;
    };
  }, [authUserId, authoritativeScheduleReloadVersion, model?.team.id, reloadVersion, teamId]);

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
            rosterStatistics: currentModel.rosterStatistics,
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
      if (!teamId || activeTab !== 'insights' || !hasTeamModel || insightsLoaded) return;
      setInsightsLoading(true);
      setInsightsError('');
      const requestKey = `${teamId}:${authUserId}:${insightsReloadVersion}`;
      const activeRequest = insightsRequestRef.current?.key === requestKey
        ? insightsRequestRef.current
        : { key: requestKey, request: loadTeamDetailInsights(teamId, authUserRef.current) };
      insightsRequestRef.current = activeRequest;
      try {
        const insights = await activeRequest.request;
        if (!cancelled) {
          setModel((currentModel) => currentModel ? { ...currentModel, ...insights } : currentModel);
          setInsightsLoaded(true);
        }
      } catch (loadError: any) {
        if (!cancelled) setInsightsError(loadError?.message || 'Unable to load team insights.');
      } finally {
        if (insightsRequestRef.current === activeRequest) insightsRequestRef.current = null;
        if (!cancelled) setInsightsLoading(false);
      }
    }

    void loadInsightsForTab();
    return () => {
      cancelled = true;
    };
  }, [activeTab, authUserId, hasTeamModel, insightsLoaded, insightsReloadVersion, teamId]);

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
      rosterStatistics: model?.rosterStatistics || nextModel.rosterStatistics,
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
    schedule: authoritativeUpcomingCount ?? 0,
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
      upcomingEventCount: authoritativeUpcomingCount ?? undefined,
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

      {activeTab === 'overview' ? (
        <OverviewTab
          model={model}
          nextEvent={authoritativeNextEvent ?? null}
          scheduleLoading={authoritativeSchedulePending}
          scheduleError={authoritativeScheduleError}
          premiumAccess={teamPremiumAccess}
          onTeamPassCheckoutOpening={() => {
            teamPassCheckoutReturnArmedRef.current = true;
          }}
          onTeamPassCheckoutOpenFailed={() => {
            teamPassCheckoutReturnArmedRef.current = false;
          }}
        />
      ) : null}
      {activeTab === 'schedule' ? (
        <ScheduleTab
          model={model}
          auth={auth}
          authoritativeEvents={authoritativeTeamSchedule?.events || null}
          scheduleLoading={authoritativeSchedulePending}
          scheduleError={authoritativeScheduleError}
          onScheduleRetry={() => setAuthoritativeScheduleReloadVersion((current) => current + 1)}
          onOpenStatTrackerConfigs={() => navigateToTab('more')}
        />
      ) : null}
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
            <LazyInsightsTab model={model} loading={insightsLoading} error={insightsError} premiumAccess={teamPremiumAccess} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      {activeTab === 'more' ? (
        detailCollectionsLoading ? <InlineDeferredLoading copy="Loading team settings…" /> : detailCollectionsError ? <DeferredCollectionsErrorState message={detailCollectionsError} onRetry={() => {
          setDetailCollectionsError('');
          setDetailCollectionsReloadVersion((current) => current + 1);
        }} /> : (
          <ErrorBoundary name="team-detail-more" onRetry={() => setMoreTabRetryVersion((current) => current + 1)}>
            <Suspense fallback={<div className="app-card p-4 text-sm font-semibold text-gray-500" role="status" aria-label="Loading more" aria-live="polite">Loading more…</div>}>
              <LazyMoreTab model={model} auth={auth} staffPermissionsLoading={staffPermissionsLoading} staffPermissionsError={staffPermissionsError} sponsorsLoading={sponsorsLoading} sponsorsError={sponsorsError} onTeamDetailRefresh={refreshTeamDetail} />
            </Suspense>
          </ErrorBoundary>
        )
      ) : null}
    </div>
  );
}

function TeamHero({ model, upcomingCount }: { model: TeamDetailModel; upcomingCount: number | null }) {
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
        <SummaryStat icon={CalendarDays} label="Upcoming" value={upcomingCount === null ? '—' : String(upcomingCount)} to={`/teams/${encodeURIComponent(model.team.id)}?tab=schedule`} />
      </div>
      {team.description ? <p className="border-t border-gray-100 px-4 py-3 text-sm font-semibold leading-6 text-gray-600">{team.description}</p> : null}
    </section>
  );
}

function OverviewTab({
  model,
  nextEvent,
  scheduleLoading,
  scheduleError,
  premiumAccess,
  onTeamPassCheckoutOpening,
  onTeamPassCheckoutOpenFailed
}: {
  model: TeamDetailModel;
  nextEvent: TeamDetailEvent | null;
  scheduleLoading: boolean;
  scheduleError: string;
  premiumAccess: PremiumAccessResult;
  onTeamPassCheckoutOpening: () => void;
  onTeamPassCheckoutOpenFailed: () => void;
}) {
  const nextEventValue = nextEvent
    ? formatEventDate(nextEvent.date)
    : scheduleLoading
      ? 'Checking schedule…'
      : scheduleError
        ? 'Schedule unavailable'
        : 'No upcoming';
  const nextEventDetail = nextEvent
    ? `${nextEvent.title} · ${nextEvent.locationDetail || nextEvent.location}`
    : scheduleLoading
      ? 'Loading the latest team events.'
      : scheduleError
        ? 'Open the schedule to retry.'
        : 'Schedule is clear for now';

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2">
        <InfoCard icon={Trophy} title={`Season record (${model.record.label})`} value={formatRecord(model.record)} detail={model.record.gamesPlayed ? `${model.record.gamesPlayed} completed ${model.record.gamesPlayed === 1 ? 'game' : 'games'}${model.record.winPercentage !== null ? ` · ${model.record.winPercentage}%` : ''}` : 'No completed games yet'} to={`/schedule?teamId=${encodeURIComponent(model.team.id)}&filter=recent-results`} />
        <InfoCard icon={CalendarDays} title="Next event" value={nextEventValue} detail={nextEventDetail} to={`/schedule?teamId=${encodeURIComponent(model.team.id)}`} />
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

      <TeamPassCard model={model} premiumAccess={premiumAccess} onCheckoutOpening={onTeamPassCheckoutOpening} onCheckoutOpenFailed={onTeamPassCheckoutOpenFailed} />
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
  now = Date.now(),
  options: { includeModelOnlyEvents?: boolean } = {}
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
      locationDetail: scheduleEvent.locationDetail?.trim() || existingEvent?.locationDetail || null,
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
      sourceLabel: scheduleEvent.sourceLabel?.trim() || existingEvent?.sourceLabel || null,
      statTrackerConfigId: scheduleEvent.statTrackerConfigId?.trim() || existingEvent?.statTrackerConfigId || '',
      statTrackerConfigLabel: existingEvent?.statTrackerConfigLabel || 'No config assigned',
      statTrackerConfigBaseType: existingEvent?.statTrackerConfigBaseType || '',
      statTrackerConfigExists: existingEvent?.statTrackerConfigExists || false,
      statTrackerConfigIsBasketball: existingEvent?.statTrackerConfigIsBasketball || false
    });
  }

  if (options.includeModelOnlyEvents !== false) {
    for (const modelEvent of modelEvents) {
      const identity = `${modelEvent.id}:${modelEvent.date.getTime()}`;
      if (!uniqueEvents.has(identity)) uniqueEvents.set(identity, modelEvent);
    }
  }

  const events = [...uniqueEvents.values()];
  const upcoming = events
    .filter((event) => isUpcomingTeamDetailEvent(event, now))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 8);
  const recent = events
    .filter((event) => event.status.toLowerCase() === 'completed' || (event.homeScore !== null && event.awayScore !== null && event.date.getTime() < now))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 3);

  return [...upcoming, ...recent];
}

function isUpcomingTeamDetailEvent(event: TeamDetailEvent, now = Date.now()) {
  return !event.isCancelled
    && event.status.toLowerCase() !== 'completed'
    && event.date.getTime() >= now - 3 * 60 * 60 * 1000;
}

function getNextTeamScheduleEvent(scheduleEvents: ParentScheduleEvent[], teamId: string, now = Date.now()) {
  return buildTeamSchedulePreviewEvents(scheduleEvents, [], teamId, now)
    .find((event) => isUpcomingTeamDetailEvent(event, now)) || null;
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

function ScheduleTab({
  model,
  auth,
  authoritativeEvents,
  scheduleLoading,
  scheduleError,
  onScheduleRetry,
  onOpenStatTrackerConfigs
}: {
  model: TeamDetailModel;
  auth: AuthState;
  authoritativeEvents: ParentScheduleEvent[] | null;
  scheduleLoading: boolean;
  scheduleError: string;
  onScheduleRetry: () => void;
  onOpenStatTrackerConfigs: () => void;
}) {
  const modelEvents = useMemo(() => [...model.upcomingEvents, ...model.recentResults], [model.recentResults, model.upcomingEvents]);
  const events = useMemo(
    () => buildTeamSchedulePreviewEvents(
      authoritativeEvents || [],
      modelEvents,
      model.team.id,
      Date.now(),
      { includeModelOnlyEvents: authoritativeEvents === null }
    ),
    [authoritativeEvents, model.team.id, modelEvents]
  );
  const reminderPreviewLoader = useMemo(() => createStaffRsvpReminderPreviewLoader(), []);

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
            <button type="button" className="secondary-button mt-3 !min-h-9 text-xs" onClick={onScheduleRetry}>
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

function TeamPassCard({ model, premiumAccess, onCheckoutOpening, onCheckoutOpenFailed }: { model: TeamDetailModel; premiumAccess: PremiumAccessResult; onCheckoutOpening: () => void; onCheckoutOpenFailed: () => void }) {
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const checkoutPendingRef = useRef(false);
  const checkoutScope = `${model.team.id}:${model.team.currentSeasonId}`;
  const checkoutScopeRef = useRef(checkoutScope);
  const canPurchase = model.canPurchaseTeamPass === true
    && Boolean(model.team.currentSeasonId)
    && premiumAccess.state === 'locked';
  useEffect(() => {
    checkoutScopeRef.current = checkoutScope;
    checkoutPendingRef.current = false;
    setCheckoutPending(false);
    setCheckoutError('');
    return () => {
      checkoutScopeRef.current = '';
      checkoutPendingRef.current = false;
    };
  }, [checkoutScope]);

  async function startCheckout() {
    if (!canPurchase || checkoutPendingRef.current) return;
    checkoutPendingRef.current = true;
    setCheckoutPending(true);
    setCheckoutError('');
    try {
      const checkoutUrl = await createTeamPassCheckoutForApp(model.team.id, model.team.currentSeasonId);
      if (checkoutScopeRef.current !== checkoutScope) return;
      onCheckoutOpening();
      try {
        await openPublicUrl(checkoutUrl);
      } catch (error) {
        onCheckoutOpenFailed();
        throw error;
      }
    } catch (error: any) {
      if (checkoutScopeRef.current === checkoutScope) {
        setCheckoutError(error?.message || 'Unable to start Team Pass checkout. Please try again.');
      }
    } finally {
      if (checkoutScopeRef.current === checkoutScope) {
        checkoutPendingRef.current = false;
        setCheckoutPending(false);
      }
    }
  }

  const copy = premiumAccess.state === 'unlocked' && ['global-open', 'default-open'].includes(premiumAccess.reason)
    ? 'Premium features are open to everyone. No Team Pass purchase is needed while global access is enabled.'
    : premiumAccess.state === 'unlocked'
      ? 'This team has active premium access for the current season.'
      : premiumAccess.state === 'loading'
        ? 'Checking Team Pass access for this team.'
        : premiumAccess.state === 'unavailable'
          ? 'Team Pass access could not be verified right now. Try again later.'
          : 'An active Team Pass is required for team analytics and archived replay when the team enables that gate.';
  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <Ticket className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Team Pass</div>
          <div className="mt-1 text-sm font-semibold leading-6 text-gray-600">
            {copy}
          </div>
          {canPurchase ? (
            <button type="button" className="primary-button mt-3 !min-h-10 text-sm" onClick={() => void startCheckout()} disabled={checkoutPending}>
              {checkoutPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ticket className="h-4 w-4" aria-hidden="true" />}
              {checkoutPending ? 'Opening checkout…' : 'Buy Team Pass'}
            </button>
          ) : null}
          {checkoutError ? <div className="mt-2 text-sm font-semibold text-rose-700" role="alert">{checkoutError}</div> : null}
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
