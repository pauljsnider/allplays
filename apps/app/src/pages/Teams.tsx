import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Dumbbell,
  ExternalLink,
  FileText,
  Images,
  Loader2,
  MessageCircle,
  Radio,
  RefreshCw,
  Settings,
  Shield,
  SlidersHorizontal,
  Ticket,
  UserRound,
  Users,
  WalletCards
} from 'lucide-react';
import { RoleBadge } from '../components/Badges';
import { getEventDetailPath, getPlayerDetailPath, type ParentHomeModel, type ParentHomeTeam } from '../lib/homeLogic';
import { loadParentHomeSummary, loadParentTeamsSummary } from '../lib/homeService';
import { openPublicUrl } from '../lib/publicActions';
import { useShellLayout } from '../lib/useShellLayout';
import {
  buildTeamNavigation,
  getTeamSchedulePath,
  isTeamManagementRole,
  type TeamNavigationItem,
  type TeamNavigationSection
} from '../lib/teamNavigation';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [home, setHome] = useState<ParentHomeModel>(() => emptyHome());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const selectedTeamId = searchParams.get('selectedTeamId') || '';

  const loadTeams = async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
    if (!auth.user) return;
    if (showLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError('');
    try {
      const fastHome = await loadParentTeamsSummary(auth.user, { force: !showLoading });
      setHome(fastHome);
      setLoading(false);
      setRefreshing(true);
      try {
        const enrichedHome = await loadParentHomeSummary(auth.user, { force: !showLoading });
        setHome((current) => mergeTeamSummary(current, enrichedHome));
      } catch (enrichError) {
        console.warn('[teams-page] Unable to enrich team summary:', enrichError);
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load teams.');
      setHome(emptyHome());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTeams({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  const selectedTeam = useMemo(() => (
    home.teams.find((team) => team.teamId === selectedTeamId) || home.teams[0] || null
  ), [home.teams, selectedTeamId]);
  const teamRoles = useMemo(() => getLoadedTeamRoles(home.teams), [home.teams]);
  const hasManagementTeam = useMemo(() => home.teams.some((team) => isTeamManagementRole(team.role)), [home.teams]);

  const selectTeam = (teamId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('selectedTeamId', teamId);
    setSearchParams(params, { replace: true });
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  return (
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
      ) : home.teams.length ? (
        isDesktopWeb ? (
          <div className="teams-web-workbench">
            <TeamLauncher teams={home.teams} selectedTeamId={selectedTeam?.teamId || ''} onSelect={selectTeam} variant="rail" />
            <div className="min-w-0 space-y-4">
              {selectedTeam ? <SelectedTeamPanel team={selectedTeam} variant="web" /> : null}
              {hasManagementTeam ? <WebsiteToolsNotice compact /> : null}
            </div>
          </div>
        ) : (
          <>
            <TeamLauncher teams={home.teams} selectedTeamId={selectedTeam?.teamId || ''} onSelect={selectTeam} />
            {selectedTeam ? <SelectedTeamPanel team={selectedTeam} /> : null}
          </>
        )
      ) : (
        <EmptyTeams />
      )}

      {!loading && hasManagementTeam && !isDesktopWeb ? <WebsiteToolsNotice /> : null}

      <section className="app-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black text-gray-950">Discover public teams</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Browse and search public teams in the app, then open their team page in read-only mode.</div>
          </div>
          <Link to="/teams/browse" className="primary-button !min-h-10 !px-3 text-sm">
            Browse teams
          </Link>
        </div>
      </section>
    </div>
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
        <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !flex-none !p-0 sm:!w-auto sm:!px-3" onClick={onRefresh} disabled={refreshing} aria-label="Refresh teams" title="Refresh teams">
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

function TeamLauncher({ teams, selectedTeamId, onSelect, variant = 'grid' }: {
  teams: ParentHomeTeam[];
  selectedTeamId: string;
  onSelect: (teamId: string) => void;
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
          <div className="mt-0.5 text-xs font-semibold text-gray-500">{isRail ? 'Select a team, or jump straight to chat and schedule.' : 'Open the team hub, or jump straight to chat, schedule, or the full team page.'}</div>
        </div>
        <span className="inline-flex h-7 flex-none items-center rounded-full bg-gray-100 px-2.5 text-[11px] font-black text-gray-700">
          {teams.length} team{teams.length === 1 ? '' : 's'}
        </span>
      </div>
      <label className="mt-3 block px-1">
        <span className="sr-only">Filter teams</span>
        <input
          className="auth-input !min-h-10 !px-3 !py-2 text-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search teams or players"
        />
      </label>
      <div className={`${isRail ? 'teams-team-rail-list mt-3 space-y-2' : 'mt-3 grid gap-2 xl:grid-cols-2'}`}>
        {visibleTeams.length ? visibleTeams.map((team) => (
          <TeamLauncherRow key={team.teamId} team={team} selected={team.teamId === selectedTeamId} onSelect={() => onSelect(team.teamId)} compact={isRail} />
        )) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No teams match that search.</div>
        )}
      </div>
    </section>
  );
}

function TeamLauncherRow({ team, selected, onSelect, compact = false }: { team: ParentHomeTeam; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const hasSchedule = team.eventCount > 0 || team.players.length > 0;
  const nextEventSummary = getTeamNextEventSummary(team);

  return (
    <article className={`team-launcher-row flex min-w-0 items-center gap-2 rounded-2xl border bg-white p-2 shadow-sm transition ${compact ? 'team-launcher-row-compact' : ''} ${selected ? 'border-primary-300 bg-primary-50/50 ring-2 ring-primary-100' : 'border-gray-200 hover:border-primary-200 hover:bg-primary-50/25'}`}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left" onClick={onSelect} aria-pressed={selected}>
        <TeamAvatar name={team.teamName} photoUrl={team.photoUrl} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-black text-gray-950">{team.teamName}</span>
            {selected ? <span className="hidden rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-white sm:inline-flex">Open</span> : null}
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
      </button>
      <div className="flex flex-none items-center gap-1">
        <TeamQuickLink to={`/messages/${encodeURIComponent(team.teamId)}`} label={`${team.teamName} messages`} icon={MessageCircle} badge={team.unreadCount} />
        {hasSchedule ? <TeamQuickLink to={getTeamSchedulePath(team.teamId)} label={`${team.teamName} schedule`} icon={CalendarDays} badge={team.openActions} /> : null}
        <TeamHubQuickLink team={team} />
      </div>
    </article>
  );
}

function TeamQuickLink({ to, label, icon: Icon, badge = 0 }: { to: string; label: string; icon: typeof Users; badge?: number }) {
  return (
    <Link to={to} className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700" aria-label={label} title={label}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {badge > 0 ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary-600 px-1 text-center text-[9px] font-black leading-4 text-white">{badge > 9 ? '9+' : badge}</span> : null}
    </Link>
  );
}

function TeamHubQuickLink({ team }: { team: ParentHomeTeam }) {
  return (
    <Link
      to={`/teams/${encodeURIComponent(team.teamId)}`}
      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
      aria-label={`${team.teamName} team hub`}
      title={`${team.teamName} team hub`}
    >
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

export function TeamLauncherChip({ label, tone = 'gray' }: { label: string; tone?: 'gray' | 'primary' | 'amber' }) {
  const toneClass = tone === 'primary'
    ? 'bg-primary-50 text-primary-700'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-100 text-gray-600';

  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${toneClass}`}>{label}</span>;
}

function SelectedTeamPanel({ team, variant = 'mobile' }: { team: ParentHomeTeam; variant?: 'mobile' | 'web' }) {
  const [showAllTools, setShowAllTools] = useState(false);
  const navigationSections = useMemo(() => buildTeamNavigation(team), [team]);
  const isWeb = variant === 'web';

  useEffect(() => {
    setShowAllTools(false);
  }, [team.teamId]);

  return (
    <section className={`app-card overflow-hidden ${isWeb ? 'teams-selected-panel' : ''}`}>
      <div className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <TeamAvatar name={team.teamName} photoUrl={team.photoUrl} large />
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.06em] text-primary-700">Team hub</div>
              <h2 className="mt-1 truncate text-xl font-black leading-tight text-gray-950">{team.teamName}</h2>
              <div className="mt-1 flex min-w-0 flex-wrap gap-2">
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{team.role}</span>
                {team.sport ? <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{team.sport}</span> : null}
                {team.unreadCount > 0 ? <span className="rounded-full bg-primary-600 px-2.5 py-1 text-xs font-black text-white">{team.unreadCount} unread</span> : null}
              </div>
            </div>
          </div>
          <Link to={`/messages/${encodeURIComponent(team.teamId)}`} className="secondary-button !min-h-10 flex-none text-sm">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Chat
          </Link>
        </div>

        <div className={`mt-3 grid grid-cols-3 gap-2 ${isWeb ? 'teams-selected-stats' : ''}`}>
          <MiniStat icon={Users} label="Players" value={String(team.players.length)} />
          <MiniStat icon={CalendarDays} label="Events" value={String(team.eventCount)} />
          <MiniStat icon={MessageCircle} label="Unread" value={String(team.unreadCount)} />
        </div>
      </div>

      <TeamNavigationPanel sections={navigationSections} showAllTools={showAllTools} onToggleTools={() => setShowAllTools((value) => !value)} />

      <div className="border-t border-gray-100 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-gray-950">Linked players</div>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">
              {team.players.length ? 'Tap a player to open the player view.' : 'This team is available through coach/admin access.'}
            </div>
          </div>
          {team.nextEvent ? (
            <Link to={getEventDetailPath(team.nextEvent)} className="secondary-button !min-h-9 text-xs">
              Next event
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {team.players.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {team.players.map((player) => (
              <Link key={`${player.teamId}-${player.playerId}`} to={getPlayerDetailPath(player.teamId, player.playerId)} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gray-900 text-xs font-black text-white">{getInitials(player.playerName)}</div>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-gray-950">{player.playerName}</span>
                  <span className="block truncate text-xs font-semibold text-gray-500">{player.teamName || team.teamName}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-blue-700" aria-hidden="true" />
            <div>
              <div className="text-sm font-black text-blue-950">Team chat access</div>
              <div className="mt-0.5 text-xs font-semibold text-blue-700">No player is linked to this account for the team, but team chat is available.</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function WebsiteToolsNotice({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`app-card ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center gap-2 text-sm font-black text-primary-800">
        <Shield className="h-4 w-4" aria-hidden="true" />
        Website tools available
      </div>
      <p className={`mt-2 font-semibold text-gray-600 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'}`}>
        Coach and admin teams include links to the current website for roster, schedule, fees, drills, and game-day operations.
      </p>
    </section>
  );
}

function TeamNavigationPanel({ sections, showAllTools, onToggleTools }: {
  sections: TeamNavigationSection[];
  showAllTools: boolean;
  onToggleTools: () => void;
}) {
  return (
    <div className="border-t border-gray-100 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">Team navigation</div>
          <div className="mt-0.5 text-xs font-semibold leading-5 text-gray-500">App routes first, current website tools where the full feature already exists.</div>
        </div>
      </div>

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

const teamNavigationIcons: Record<string, typeof Users> = {
  schedule: CalendarDays,
  messages: MessageCircle,
  'practice-packets': ClipboardCheck,
  'team-page': Ticket,
  'website-team-page': ExternalLink,
  'player-profile': UserRound,
  players: Users,
  media: Images,
  'parent-fees': WalletCards,
  registrations: Ticket,
  awards: FileText,
  'team-settings': Settings,
  'manage-roster': Users,
  'manage-schedule': CalendarDays,
  fees: WalletCards,
  'practice-command': Dumbbell,
  'game-plan': ClipboardList,
  'game-day': Radio,
  tracking: ClipboardCheck,
  'stats-config': SlidersHorizontal,
  certificates: FileText,
  analytics: BarChart3
};

function MiniStat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
      <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
      <div className="mt-1 truncate text-sm font-black text-gray-950">{value}</div>
      <div className="truncate text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
    </div>
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
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Link to="/accept-invite" className="secondary-button justify-center !min-h-9 text-xs">Accept invite</Link>
            <Link to="/home" className="ghost-button justify-center !min-h-9 text-xs">Back to Home</Link>
            <a
              href="https://allplays.ai/teams.html"
              className="ghost-button justify-center !min-h-9 text-xs"
              onClick={(event) => {
                event.preventDefault();
                void openPublicUrl('https://allplays.ai/teams.html');
              }}
            >
              Browse teams
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      <Shield className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      {message}
    </div>
  );
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'T';
}

export function TeamAvatar({ name, photoUrl, large = false }: { name: string; photoUrl?: string | null; large?: boolean }) {
  if (photoUrl) {
    return (
      <span className={`flex flex-none overflow-hidden rounded-2xl bg-gray-100 shadow-sm ${large ? 'h-12 w-12' : 'h-11 w-11'}`}>
        <img src={photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      </span>
    );
  }
  return (
    <span className={`flex flex-none items-center justify-center rounded-2xl bg-gray-950 font-black text-white shadow-sm ${large ? 'h-12 w-12 text-sm' : 'h-11 w-11 text-xs'}`}>
      {getInitials(name)}
    </span>
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

function getTeamHeaderDetail(teams: ParentHomeTeam[]) {
  const teamNames = teams.map((team) => team.teamName).filter(Boolean);
  if (!teamNames.length) return 'Team access loaded for this account.';
  const visibleNames = teamNames.slice(0, 2).join(', ');
  const remaining = teamNames.length > 2 ? ` +${teamNames.length - 2} more` : '';
  return `${visibleNames}${remaining}`;
}
