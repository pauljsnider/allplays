import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  Loader2,
  RefreshCw,
  Shield,
  Users
} from 'lucide-react';
import { RoleBadge } from '../components/Badges';
import { TeamAvatar, TeamLauncherChip, Status } from '../components/TeamSummaryPrimitives';
import { toAppServiceError, type AppServiceError } from '../lib/appErrors';
import { type ParentHomeModel, type ParentHomeTeam } from '../lib/homeLogic';
import { loadParentHomeSummary, loadParentTeamsSummaryBootstrap } from '../lib/homeService';
import { PullToRefresh } from '../components/PullToRefresh';
import { useAsyncOperation } from '../lib/useAsyncOperation';
import { useRefreshOnResume } from '../lib/useRefreshOnResume';
import { useShellLayout } from '../lib/useShellLayout';
import { completeParentCoreWorkflowTimer } from '../lib/parentWorkflowTiming';
import type { AuthState } from '../lib/types';

function emptyHome(): ParentHomeModel {
  return {
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
  };
}

export function Teams({ auth }: { auth: AuthState }) {
  const { isDesktopWeb } = useShellLayout();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [home, setHome] = useState<ParentHomeModel>(() => emptyHome());
  const [teamsLoadError, setTeamsLoadError] = useState<AppServiceError | null>(null);
  const [loadedTeamSummaryUserId, setLoadedTeamSummaryUserId] = useState<string | null>(null);
  const [loadedTeamUserId, setLoadedTeamUserId] = useState<string | null>(null);
  const activeLoadIdRef = useRef(0);
  const hasStartedInitialTeamLoadRef = useRef(false);
  const {
    loading: teamSummaryLoading,
    error: teamSummaryError,
    clearError: clearTeamSummaryError,
    run: runTeamSummaryLoad
  } = useAsyncOperation();
  const {
    loading: teamEnrichmentLoading,
    error: teamEnrichmentError,
    clearError: clearTeamEnrichmentError,
    run: runTeamEnrichmentLoad
  } = useAsyncOperation();
  const selectedTeamId = searchParams.get('selectedTeamId') || '';
  const requestedWorkflow = searchParams.get('workflow') || '';
  const authUserId = auth.user?.uid || null;
  const hasLoadedTeamSummary = Boolean(authUserId) && authUserId === loadedTeamSummaryUserId;
  const hasLoadedTeamDetails = Boolean(authUserId) && authUserId === loadedTeamUserId;
  const isInitialTeamLoad = Boolean(authUserId) && !hasLoadedTeamSummary && !teamsLoadError;
  const loading = isInitialTeamLoad && (teamSummaryLoading || !hasStartedInitialTeamLoadRef.current);
  const refreshing = !loading && (teamSummaryLoading || teamEnrichmentLoading);
  const error = teamSummaryError || teamEnrichmentError || '';

  const loadTeams = async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
    const user = auth.user;
    if (!user) return;
    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;
    const hasExistingTeams = loadedTeamUserId === user.uid;
    if (showLoading) {
      setLoadedTeamSummaryUserId(null);
    }
    clearTeamSummaryError();
    clearTeamEnrichmentError();
    setTeamsLoadError(null);

    let teamSummaryBootstrap: Awaited<ReturnType<typeof loadParentTeamsSummaryBootstrap>> | null = null;
    const fastHome = await runTeamSummaryLoad(
      async () => {
        teamSummaryBootstrap = await loadParentTeamsSummaryBootstrap(user, { force: !showLoading });
        return teamSummaryBootstrap.home;
      },
      {
        ignoreStale: true,
        rethrow: false,
        getErrorMessage: (loadError) => getTeamsLoadErrorMessage(toAppServiceError(loadError, 'Unable to load teams.'), hasExistingTeams),
        onSuccess: (fastHome) => {
          if (loadId !== activeLoadIdRef.current) return;
          setHome(fastHome);
          setLoadedTeamSummaryUserId(user.uid);
          setTeamsLoadError(null);
        },
        onError: (loadError) => {
          if (loadId !== activeLoadIdRef.current) return;
          const appError = toAppServiceError(loadError, 'Unable to load teams.');
          setTeamsLoadError(appError);
          if (!hasExistingTeams) {
            setHome(emptyHome());
            setLoadedTeamSummaryUserId(null);
            setLoadedTeamUserId(null);
          }
        }
      }
    );
    if (!fastHome || loadId !== activeLoadIdRef.current) return;

    const hasFastTeams = fastHome.teams.length > 0;
    await runTeamEnrichmentLoad(
      () => loadParentHomeSummary(user, {
        force: !showLoading,
        scheduleScope: teamSummaryBootstrap?.scheduleScope
      }),
      {
        ignoreStale: true,
        rethrow: false,
        shouldHandleError: () => loadId === activeLoadIdRef.current,
        getErrorMessage: (enrichError) => getTeamsLoadErrorMessage(toAppServiceError(enrichError, 'Unable to load teams.'), true),
        onSuccess: (enrichedHome) => {
          if (loadId !== activeLoadIdRef.current) return;
          setHome((current) => mergeTeamSummary(current, enrichedHome));
          setLoadedTeamSummaryUserId(user.uid);
          setLoadedTeamUserId(user.uid);
          setTeamsLoadError(null);
        },
        onError: (enrichError) => {
          if (loadId !== activeLoadIdRef.current) return;
          const appError = toAppServiceError(enrichError, 'Unable to load teams.');
          if (!hasExistingTeams && !hasFastTeams) {
            clearTeamEnrichmentError();
            setHome(emptyHome());
            setLoadedTeamUserId(null);
            setTeamsLoadError(appError);
          }
        }
      }
    );
  };

  useEffect(() => {
    if (!auth.user?.uid) {
      hasStartedInitialTeamLoadRef.current = false;
      return;
    }
    hasStartedInitialTeamLoadRef.current = true;
    loadTeams({ showLoading: true });
    return () => {
      activeLoadIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  useRefreshOnResume(() => loadTeams(), { enabled: Boolean(auth.user?.uid) });

  const showBlockingErrorState = !loading && !hasLoadedTeamDetails && Boolean(teamsLoadError);

  const teamRoles = useMemo(() => getLoadedTeamRoles(home.teams), [home.teams]);

  useEffect(() => {
    if (loading || selectedTeamId || !hasLoadedTeamSummary) return;
    if (shouldOpenSingleTeamDirectly(home.teams)) {
      navigate(getSingleTeamDestination(home.teams[0].teamId, requestedWorkflow), { replace: true });
    }
  }, [hasLoadedTeamSummary, home.teams, loading, navigate, requestedWorkflow, selectedTeamId]);

  useEffect(() => {
    if (loading || !hasLoadedTeamSummary) return;
    completeParentCoreWorkflowTimer('teams', {
      targetPage: 'teams',
      teamId: selectedTeamId || '',
      teamCount: home.teams.length,
      completedRoute: selectedTeamId ? `/teams?selectedTeamId=${selectedTeamId}` : '/teams'
    });
  }, [hasLoadedTeamSummary, home.teams.length, loading, selectedTeamId]);

  return (
    <PullToRefresh onRefresh={() => loadTeams()} disabled={!auth.user?.uid}>
    <div className={`teams-page ${isDesktopWeb ? 'teams-page-web' : ''} space-y-4`}>
      <TeamsHeader
        loading={loading}
        refreshing={refreshing}
        teams={home.teams}
        teamRoles={teamRoles}
        onRefresh={() => loadTeams()}
      />

      {error ? <Status tone="error" message={error} /> : null}

      {loading ? (
        <section className="app-card p-6 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
          <div className="mt-3 text-sm font-black text-gray-900">Loading teams</div>
          <div className="mt-1 text-xs font-semibold text-gray-500">Pulling team access, linked players, schedule, and chat counts.</div>
        </section>
      ) : showBlockingErrorState && teamsLoadError ? (
        <TeamsLoadErrorState error={teamsLoadError} onRetry={() => loadTeams({ showLoading: true })} retrying={loading || refreshing} />
      ) : home.teams.length ? (
        isDesktopWeb ? (
          <div className="teams-web-workbench">
            <TeamLauncher teams={home.teams} selectedTeamId={selectedTeamId} variant="rail" />
          </div>
        ) : (
          <TeamLauncher teams={home.teams} selectedTeamId={selectedTeamId} />
        )
      ) : (
        <EmptyTeams />
      )}

      <section className="app-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black text-gray-950">Discover public teams</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Browse and search public teams in the app, then open their team page in read-only mode.</div>
          </div>
          <Link to="/teams/browse" className="primary-button !min-h-11 !px-3 text-sm">
            Browse teams
          </Link>
        </div>
      </section>
    </div>
    </PullToRefresh>
  );
}

function mergeTeamSummary(current: ParentHomeModel, enriched: ParentHomeModel): ParentHomeModel {
  if (!enriched.teams.length) return current;
  const currentByTeamId = new Map(current.teams.map((team) => [team.teamId, team]));
  return {
    ...enriched,
    teams: enriched.teams.map((team) => ({
      ...team,
      unreadCount: currentByTeamId.get(team.teamId)?.unreadCount || team.unreadCount,
      role: currentByTeamId.get(team.teamId)?.role || team.role,
      sport: currentByTeamId.get(team.teamId)?.sport || team.sport,
      photoUrl: currentByTeamId.get(team.teamId)?.photoUrl || team.photoUrl
    }))
  };
}

function shouldOpenSingleTeamDirectly(teams: ParentHomeTeam[]): boolean {
  return teams.length === 1;
}

function getSingleTeamDestination(teamId: string, workflow: string) {
  if (workflow === 'fees') {
    return `/teams/${encodeURIComponent(teamId)}/fees`;
  }
  return `/teams/${encodeURIComponent(teamId)}`;
}

function TeamsHeader({ loading, refreshing, teams, teamRoles, onRefresh }: {
  loading: boolean;
  refreshing: boolean;
  teams: ParentHomeTeam[];
  teamRoles: string[];
  onRefresh: () => void;
}) {
  const metrics = getTeamHeaderMetrics(teams);
  const title = loading
    ? 'Loading your teams'
    : teams.length
      ? `${teams.length} team${teams.length === 1 ? '' : 's'} ready`
      : 'No teams linked yet';
  const detail = loading
    ? 'Checking team access, players, schedule, and chat.'
    : teams.length
      ? getTeamHeaderDetail(teams)
      : 'Accept an invite or request team access to connect this account.';

  return (
    <section className="teams-header app-card p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="app-label">My Teams</div>
          <h1 className="mt-1 truncate text-xl font-black text-gray-950 sm:text-2xl">{title}</h1>
          <p className="mt-1 line-clamp-1 text-xs font-semibold text-gray-600 sm:text-sm">{detail}</p>
        </div>
        <button type="button" className="ghost-button !h-11 !min-h-11 !w-11 !flex-none !p-0 sm:!w-auto sm:!px-3" onClick={onRefresh} disabled={refreshing} aria-label="Refresh teams" title="Refresh teams">
          <RefreshCw className={`h-4 w-4 ${refreshing || loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {loading ? (
          <span className="rounded-full border border-primary-100 bg-primary-50 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-primary-700">Loading</span>
        ) : (
          <>
            <MetricPill label="Teams" value={String(metrics.teams)} />
            <MetricPill label="Players" value={String(metrics.players)} />
            <MetricPill label="Unread" value={String(metrics.unread)} />
            {teamRoles.map((role) => <RoleBadge key={role} role={role} />)}
          </>
        )}
      </div>
    </section>
  );
}

function TeamLauncher({ teams, selectedTeamId, variant = 'grid' }: {
  teams: ParentHomeTeam[];
  selectedTeamId: string;
  variant?: 'grid' | 'rail';
}) {
  const [query, setQuery] = useState('');
  const isRail = variant === 'rail';
  const visibleTeams = useMemo(() => filterTeams(teams, query), [query, teams]);

  return (
    <section className={`app-card p-3 ${isRail ? 'teams-team-rail' : ''}`}>
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">{isRail ? 'Teams' : 'Choose a team'}</div>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">Choose a team to open its page and tools.</div>
        </div>
        <span className="inline-flex h-7 flex-none items-center rounded-full bg-gray-100 px-2.5 text-[11px] font-black text-gray-700">
          {teams.length} team{teams.length === 1 ? '' : 's'}
        </span>
      </div>
      <label className="mt-3 block px-1">
        <span className="sr-only">Filter teams</span>
        <input
          className="auth-input !min-h-11 !px-3 !py-2 text-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search teams or players"
        />
      </label>
      <div className={`${isRail ? 'teams-team-rail-list mt-3 space-y-2' : 'mt-3 grid gap-2 xl:grid-cols-2'}`}>
        {visibleTeams.length ? visibleTeams.map((team) => (
          <TeamLauncherRow key={team.teamId} team={team} selected={team.teamId === selectedTeamId} compact={isRail} />
        )) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No teams match that search.</div>
        )}
      </div>
    </section>
  );
}

function TeamLauncherRow({ team, selected, compact = false }: { team: ParentHomeTeam; selected: boolean; compact?: boolean }) {
  const nextEventSummary = getTeamNextEventSummary(team);

  return (
    <article className={`team-launcher-row flex min-w-0 items-center gap-2 rounded-2xl border bg-white p-2 shadow-sm transition ${compact ? 'team-launcher-row-compact' : ''} ${selected ? 'border-primary-300 bg-primary-50/50 ring-2 ring-primary-100' : 'border-gray-200 hover:border-primary-200 hover:bg-primary-50/25'}`}>
      <Link
        to={`/teams/${encodeURIComponent(team.teamId)}`}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left"
        aria-describedby={selected ? `selected-team-${team.teamId}` : undefined}
        aria-label={`Open ${team.teamName}`}
        title={`Open ${team.teamName}`}
      >
        <TeamAvatar name={team.teamName} photoUrl={team.photoUrl} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-black text-gray-950">{team.teamName}</span>
            {selected ? (
              <>
                <span id={`selected-team-${team.teamId}`} className="sr-only">Currently selected team</span>
                <span aria-hidden="true" className="hidden rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-white sm:inline-flex">Selected</span>
              </>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-gray-500">{getTeamLauncherDetail(team)}</span>
          <span className="mt-1 flex min-w-0 flex-wrap gap-1.5">
            <TeamLauncherChip label={`${team.players.length} player${team.players.length === 1 ? '' : 's'}`} />
            <TeamLauncherChip label={`${team.eventCount} event${team.eventCount === 1 ? '' : 's'}`} />
            {team.unreadCount > 0 ? <TeamLauncherChip tone="primary" label={`${team.unreadCount} unread`} /> : null}
            {team.openActions > 0 ? <TeamLauncherChip tone="amber" label={`${team.openActions} action${team.openActions === 1 ? '' : 's'}`} /> : null}
          </span>
          {nextEventSummary && !compact ? <span className="mt-1 block truncate text-[11px] font-bold text-gray-500">{nextEventSummary}</span> : null}
        </span>
        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-700 transition group-hover:border-primary-200 group-hover:bg-primary-50 group-hover:text-primary-700">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </Link>
    </article>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-600">
      <span>{value}</span>
      <span>{label}</span>
    </span>
  );
}

function EmptyTeams() {
  return (
    <section className="app-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-gray-100 text-gray-500">
          <Users className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-900">No teams available</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Team access appears after an invite is accepted, a parent link is approved, or staff access is granted.</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <Link to="/teams/new" className="primary-button justify-center !min-h-11 text-xs">Create team</Link>
            <Link to="/accept-invite" className="secondary-button justify-center !min-h-11 text-xs">Accept invite</Link>
            <Link to="/home" className="ghost-button justify-center !min-h-11 text-xs">Back to Home</Link>
            <Link to="/teams/browse" className="ghost-button justify-center !min-h-11 text-xs">
              Browse teams
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function TeamsLoadErrorState({ error, onRetry, retrying }: { error: AppServiceError; onRetry: () => void; retrying: boolean }) {
  const copy = getTeamsLoadErrorStateCopy(error);
  return (
    <section className="app-card p-5 text-center">
      <Shield className="mx-auto h-8 w-8 text-rose-400" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-900">{copy.title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{copy.detail}</div>
      <button type="button" className="primary-button mx-auto mt-4 !min-h-11 !px-4 text-sm" onClick={onRetry} disabled={retrying} aria-label="Retry team load">
        <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
        Retry
      </button>
    </section>
  );
}

function getTeamLauncherDetail(team: ParentHomeTeam) {
  if (team.players.length) {
    return team.players.map((player) => player.playerName).join(', ');
  }
  return [team.role, team.sport].filter(Boolean).join(' · ') || 'Team access';
}

function getTeamNextEventSummary(team: ParentHomeTeam) {
  const event = team.nextEvent;
  if (!event?.date) return '';
  const label = event.title || (event.type === 'practice' ? 'Practice' : event.opponent ? `vs. ${event.opponent}` : 'Next event');
  return `${formatShortEventDate(event.date)} · ${label}`;
}

function filterTeams(teams: ParentHomeTeam[], query: string) {
  const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return teams;
  return teams.filter((team) => {
    const haystack = [
      team.teamName,
      team.role,
      team.sport,
      ...team.players.map((player) => player.playerName)
    ].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function formatShortEventDate(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Upcoming';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function getLoadedTeamRoles(teams: ParentHomeTeam[]) {
  return [...new Set(teams.map((team) => team.role).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function getTeamHeaderMetrics(teams: ParentHomeTeam[]) {
  return teams.reduce((metrics, team) => {
    metrics.teams += 1;
    metrics.players += team.players.length;
    metrics.unread += Number(team.unreadCount || 0);
    return metrics;
  }, { teams: 0, players: 0, unread: 0 });
}

function getTeamsLoadErrorMessage(error: AppServiceError, hasExistingTeams: boolean) {
  if (hasExistingTeams) {
    if (error.type === 'network') return 'Unable to refresh teams while offline. Showing the last loaded teams.';
    if (error.type === 'permission') return 'Unable to refresh teams because access was denied. Showing the last loaded teams.';
    if (error.type === 'not_found') return 'Unable to refresh teams because the requested data was not found. Showing the last loaded teams.';
    if (error.type === 'validation') return error.message;
    return 'Unable to refresh teams. Showing the last loaded teams. Try again.';
  }
  if (error.type === 'network') return 'Unable to load teams while offline. Check your connection and try again.';
  if (error.type === 'permission') return 'You do not have permission to load these teams.';
  if (error.type === 'not_found') return 'Team data was not found. Try again or check the linked team access.';
  if (error.type === 'validation') return error.message;
  return error.message || 'Unable to load teams. Try again.';
}

function getTeamsLoadErrorStateCopy(error: AppServiceError) {
  if (error.type === 'network') {
    return {
      title: 'Teams could not connect',
      detail: 'Check your connection and try loading teams again.'
    };
  }
  if (error.type === 'permission') {
    return {
      title: 'Teams access is blocked',
      detail: 'Your account does not have permission to load these teams.'
    };
  }
  if (error.type === 'not_found') {
    return {
      title: 'Team data was not found',
      detail: 'The linked team data is missing. Try again after refreshing your team access.'
    };
  }
  if (error.type === 'validation') {
    return {
      title: 'Teams request needs attention',
      detail: error.message
    };
  }
  return {
    title: 'Teams could not load',
    detail: 'Try loading teams again to restore your team dashboard.'
  };
}

function getTeamHeaderDetail(teams: ParentHomeTeam[]) {
  const teamNames = teams.map((team) => team.teamName).filter(Boolean);
  if (!teamNames.length) return 'Team access loaded for this account.';
  const visibleNames = teamNames.slice(0, 2).join(', ');
  const remaining = teamNames.length > 2 ? ` +${teamNames.length - 2} more` : '';
  return `${visibleNames}${remaining}`;
}
