import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Award,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  DollarSign,
  Dumbbell,
  ExternalLink,
  ImageIcon,
  LinkIcon,
  Loader2,
  MapPin,
  MessageCircle,
  Radio,
  Save,
  Shield,
  Ticket,
  Trophy,
  UserRound,
  Users,
  Zap
} from 'lucide-react';
import { copyPublicText, openPublicUrl, sharePublicUrl } from '../lib/publicActions';
import { getEventDetailPath } from '../lib/homeLogic';
import { buildPrivateTeamCalendarFeedUrl, getAppleCalendarFeedUrl, getGoogleCalendarFeedUrl } from '../lib/parentToolsService';
import { createStaffRsvpReminderPreviewLoader, sendStaffRsvpReminder, type StaffRsvpReminderSendResult } from '../lib/scheduleService';
import type { ParentScheduleEvent, StaffRsvpReminderPreview } from '../lib/scheduleLogic';
import { buildPublicTeamGamesIcsUrl, canExposePublicFanFeed, createRosterParentInviteForApp, deactivateRosterPlayerForApp, grantScorekeeperAccessForApp, grantVideographerAccessForApp, inviteTeamAdminForApp, loadParentTeamDetail, loadTeamDetailInsights, loadTeamDetailSponsors, loadTeamRosterParentInvites, loadTeamStaffPermissions, reactivateRosterPlayerForApp, revokeScorekeeperAccessForApp, revokeTeamAdminAccessForApp, revokeVideographerAccessForApp, saveTeamScheduleNotificationsForApp, type CreateRosterParentInviteForAppResult, type InviteTeamAdminForAppResult, type TeamDetailEvent, type TeamDetailModel, type TeamDetailPlayer, type TeamRosterParentInviteSummary, type TeamScorekeeperGrantTarget } from '../lib/teamDetailService';
import type { AuthState } from '../lib/types';

type TeamTab = 'overview' | 'schedule' | 'roster' | 'insights' | 'more';

const tabs: Array<{ id: TeamTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: Trophy },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'more', label: 'More', icon: Ticket }
];

export function TeamDetail({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const authUserId = auth.user?.uid || '';
  const [model, setModel] = useState<TeamDetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TeamTab>('overview');
  const [staffPermissionsLoading, setStaffPermissionsLoading] = useState(false);
  const [staffPermissionsError, setStaffPermissionsError] = useState('');
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [insightsLoaded, setInsightsLoaded] = useState(false);
  const [sponsorsLoading, setSponsorsLoading] = useState(false);
  const [sponsorsError, setSponsorsError] = useState('');
  const [sponsorsLoaded, setSponsorsLoaded] = useState(false);
  const [rosterInviteLoading, setRosterInviteLoading] = useState(false);
  const [rosterInviteError, setRosterInviteError] = useState('');
  const [rosterInviteAttempted, setRosterInviteAttempted] = useState(false);
  const [rosterInviteSummaries, setRosterInviteSummaries] = useState<Record<string, TeamRosterParentInviteSummary>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!teamId) return;
      setLoading(true);
      setError('');
      try {
        const nextModel = await loadParentTeamDetail(teamId, auth.user, { includeDeferredData: false });
        if (!cancelled) {
          setModel(nextModel);
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
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError?.message || 'Unable to load this team.');
          setModel(null);
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
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [authUserId, teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadStaffPermissionsForMoreTab() {
      if (!teamId || activeTab !== 'more' || !model?.canManageTeam || model.staffPermissions || staffPermissionsLoading) return;
      setStaffPermissionsLoading(true);
      setStaffPermissionsError('');
      try {
        const staffPermissions = await loadTeamStaffPermissions(teamId, auth.user);
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
  }, [activeTab, authUserId, model?.canManageTeam, model?.staffPermissions, teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadInsightsForTab() {
      if (!teamId || activeTab !== 'insights' || !model || insightsLoaded || insightsLoading) return;
      setInsightsLoading(true);
      setInsightsError('');
      try {
        const insights = await loadTeamDetailInsights(teamId, auth.user);
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
  }, [activeTab, authUserId, insightsLoaded, Boolean(model), teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSponsorsForMoreTab() {
      if (!teamId || activeTab !== 'more' || !model || sponsorsLoaded || sponsorsLoading) return;
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
  }, [activeTab, Boolean(model), sponsorsLoaded, teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadRosterInvitesForTab() {
      if (!teamId || activeTab !== 'roster' || !model?.canManageTeam || rosterInviteLoading || rosterInviteAttempted) return;
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
  }, [activeTab, authUserId, model?.canManageTeam, teamId, rosterInviteLoading, rosterInviteAttempted, auth.user]);

  useEffect(() => {
    const scroll = () => {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        // jsdom does not implement scrollTo; real browsers and WebViews do.
      }
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(scroll);
    } else {
      scroll();
    }
  }, [teamId]);

  async function refreshTeamDetail() {
    if (!teamId) return;
    const nextModel = await loadParentTeamDetail(teamId, auth.user, { includeDeferredData: false });
    const mergedModel = {
      ...nextModel,
      leaderboards: model?.leaderboards || nextModel.leaderboards,
      trackingSummaries: model?.trackingSummaries || nextModel.trackingSummaries,
      sponsors: model?.sponsors || nextModel.sponsors
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

  const tabBadges = useMemo(() => ({
    overview: 0,
    schedule: model?.upcomingEvents.length || 0,
    roster: 0,
    insights: (model?.leaderboards.length || 0) + (model?.trackingSummaries.length || 0),
    more: model?.sponsors.length || 0
  }), [model]);

  if (!teamId) return <Navigate to="/teams" replace />;

  if (loading) {
    return (
      <div className="space-y-4">
        <section className="app-card p-5 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
          <div className="mt-3 text-sm font-black text-gray-950">Loading team</div>
          <div className="mt-1 text-xs font-semibold text-gray-500">Getting the team photo, roster, schedule, standings, and parent-visible insights.</div>
        </section>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="space-y-4">
        <section className="app-card p-5">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 flex-none text-rose-600" aria-hidden="true" />
            <div>
              <div className="text-sm font-black text-gray-950">Team unavailable</div>
              <div className="mt-1 text-sm font-semibold text-gray-600">{error || 'Team not found.'}</div>
              <Link to="/teams" className="secondary-button mt-3 !min-h-9 text-xs">Back to teams</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="team-detail-page space-y-4">
      <TeamHero model={model} />

      <section className="app-card p-2">
        <div className="grid grid-cols-5 gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            const badge = tabBadges[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-black transition ${selected ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={selected}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {badge > 0 ? <span className={`absolute -right-2 -top-1 min-w-4 rounded-full px-1 text-center text-[9px] leading-4 ${selected ? 'bg-white text-primary-700' : 'bg-primary-600 text-white'}`}>{badge > 9 ? '9+' : badge}</span> : null}
                </span>
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === 'overview' ? <OverviewTab model={model} /> : null}
      {activeTab === 'schedule' ? <ScheduleTab model={model} auth={auth} onOpenStatTrackerConfigs={() => setActiveTab('more')} /> : null}
      {activeTab === 'roster' ? <RosterTab model={model} authUser={auth.user} onRefresh={refreshTeamDetail} rosterInviteLoading={rosterInviteLoading} rosterInviteError={rosterInviteError} rosterInviteSummaries={rosterInviteSummaries} onInviteCreated={refreshRosterInvites} /> : null}
      {activeTab === 'insights' ? <InsightsTab model={model} loading={insightsLoading} error={insightsError} /> : null}
      {activeTab === 'more' ? <MoreTab model={model} auth={auth} staffPermissionsLoading={staffPermissionsLoading} staffPermissionsError={staffPermissionsError} sponsorsLoading={sponsorsLoading} sponsorsError={sponsorsError} onTeamDetailRefresh={refreshTeamDetail} /> : null}
    </div>
  );
}

function TeamHero({ model }: { model: TeamDetailModel }) {
  const { team } = model;
  return (
    <section className="app-card overflow-hidden">
      <div className="relative h-32 bg-gray-950 sm:h-44">
        {team.photoUrl ? (
          <img src={team.photoUrl} alt="" className="h-full w-full object-cover opacity-90" />
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
        <SummaryStat icon={Trophy} label="Record" value={formatRecord(model.record)} />
        <SummaryStat icon={Users} label="Roster" value={String(model.players.length)} />
        <SummaryStat icon={CalendarDays} label="Upcoming" value={String(model.upcomingEvents.length)} />
      </div>
      {team.description ? <p className="border-t border-gray-100 px-4 py-3 text-sm font-semibold leading-6 text-gray-600">{team.description}</p> : null}
    </section>
  );
}

function OverviewTab({ model }: { model: TeamDetailModel }) {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2">
        <InfoCard icon={Trophy} title={`Season record (${model.record.label})`} value={formatRecord(model.record)} detail={model.record.gamesPlayed ? `${model.record.gamesPlayed} completed games${model.record.winPercentage !== null ? ` · ${model.record.winPercentage}%` : ''}` : 'No completed games yet'} />
        <InfoCard icon={CalendarDays} title="Next event" value={model.nextEvent ? formatEventDate(model.nextEvent.date) : 'No upcoming'} detail={model.nextEvent ? `${model.nextEvent.title} · ${model.nextEvent.location}` : 'Schedule is clear for now'} to={`/schedule?teamId=${encodeURIComponent(model.team.id)}`} />
        <InfoCard icon={Users} title="Roster size" value={`${model.players.length}`} detail={`${model.linkedPlayers.length || 0} linked to your account`} />
        <InfoCard icon={BarChart3} title="Standings" value={getStandingValue(model)} detail={getStandingDetail(model)} href={model.team.leagueUrl || undefined} />
      </section>

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

function ScheduleTab({ model, auth, onOpenStatTrackerConfigs }: { model: TeamDetailModel; auth: AuthState; onOpenStatTrackerConfigs: () => void }) {
  const events = [...model.upcomingEvents.slice(0, 8), ...model.recentResults.slice(0, 3)];
  const reminderPreviewLoader = useMemo(() => createStaffRsvpReminderPreviewLoader(), [model.team.id]);
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
        {events.length ? events.map((event) => <TeamEventRow key={`${event.id}-${event.date.toISOString()}`} event={event} model={model} auth={auth} reminderPreviewLoader={reminderPreviewLoader} onOpenStatTrackerConfigs={onOpenStatTrackerConfigs} />) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No team events found.</div>
        )}
      </div>
    </section>
  );
}

function RosterTab({
  model,
  authUser,
  onRefresh,
  rosterInviteLoading,
  rosterInviteError,
  rosterInviteSummaries,
  onInviteCreated
}: {
  model: TeamDetailModel;
  authUser: AuthState['user'];
  onRefresh: () => Promise<void>;
  rosterInviteLoading: boolean;
  rosterInviteError: string;
  rosterInviteSummaries: Record<string, TeamRosterParentInviteSummary>;
  onInviteCreated: () => Promise<void>;
}) {
  const [pendingPlayerId, setPendingPlayerId] = useState('');
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  async function togglePlayerActiveState(player: TeamDetailPlayer) {
    const action = player.active ? 'deactivate' : 'reactivate';
    const confirmed = window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Reactivate'} ${player.name}?`);
    if (!confirmed) return;
    setPendingPlayerId(player.id);
    setStatus(null);
    try {
      if (player.active) {
        await deactivateRosterPlayerForApp(model.team.id, player.id);
      } else {
        await reactivateRosterPlayerForApp(model.team.id, player.id);
      }
      await onRefresh();
      setStatus({ success: true, message: `${player.name} ${player.active ? 'deactivated' : 'reactivated'}.` });
    } catch (saveError: any) {
      setStatus({ success: false, message: saveError?.message || `Unable to ${action} ${player.name}.` });
    } finally {
      setPendingPlayerId('');
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Roster</div>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">Player photos, numbers, linked-player shortcuts, and profile drill-in.</div>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{model.players.length} active</span>
      </div>
      {status ? (
        <div className={`mt-3 rounded-xl border p-3 text-xs font-semibold ${status.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {status.message}
        </div>
      ) : null}
      {model.canManageTeam && rosterInviteLoading ? <div className="mt-3 text-xs font-semibold text-gray-500">Loading parent invite status…</div> : null}
      {model.canManageTeam && rosterInviteError ? <div className="mt-3 text-xs font-black text-rose-700">{rosterInviteError}</div> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {model.players.length ? model.players.map((player) => <PlayerRow key={player.id} teamId={model.team.id} teamName={model.team.name} authUser={authUser} player={player} canManageTeam={model.canManageTeam} pending={pendingPlayerId === player.id} onToggleActive={togglePlayerActiveState} inviteSummary={rosterInviteSummaries[player.id]} onInviteCreated={onInviteCreated} />) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No players have been added yet.</div>
        )}
      </div>
      {model.canManageTeam && model.inactivePlayers.length ? (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Inactive roster</div>
              <div className="mt-0.5 text-xs font-semibold text-gray-500">Inactive players stay attached to history and can be restored anytime.</div>
            </div>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{model.inactivePlayers.length} inactive</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {model.inactivePlayers.map((player) => <PlayerRow key={player.id} teamId={model.team.id} teamName={model.team.name} authUser={authUser} player={player} canManageTeam pending={pendingPlayerId === player.id} onToggleActive={togglePlayerActiveState} inviteSummary={rosterInviteSummaries[player.id]} onInviteCreated={onInviteCreated} />)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function InsightsTab({ model, loading, error }: { model: TeamDetailModel; loading: boolean; error: string }) {
  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="text-sm font-black text-gray-950">Player checklist</div>
        <div className="mt-0.5 text-xs font-semibold text-gray-500">Public tracking items visible for your linked player.</div>
        <div className="mt-3 space-y-3">
          {loading ? <InlineDeferredLoading copy="Loading player tracking…" /> : null}
          {!loading && error ? <InlineDeferredError title="Player checklist unavailable" message={error} /> : null}
          {model.trackingSummaries.length ? model.trackingSummaries.map((summary) => (
            <div key={summary.playerId} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center gap-3">
                <PlayerPhoto name={summary.playerName} photoUrl={summary.photoUrl} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-gray-950">{summary.playerName}</div>
                  <div className="text-xs font-semibold text-gray-500">{summary.items.filter((item) => item.isComplete).length}/{summary.items.length} complete</div>
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {summary.items.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-gray-900">{item.title}</div>
                      {item.description ? <div className="line-clamp-1 text-[11px] font-semibold text-gray-500">{item.description}</div> : null}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${item.isComplete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {item.isComplete ? 'Done' : 'Open'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )) : !loading && !error ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No parent-visible tracking items for your players yet.</div>
          ) : null}
        </div>
      </section>

      <section className="app-card p-4">
        <div className="text-sm font-black text-gray-950">Leaderboards</div>
        <div className="mt-0.5 text-xs font-semibold text-gray-500">Public top stats from completed tracked games.</div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {loading ? <InlineDeferredLoading copy="Loading leaderboards…" /> : null}
          {!loading && error ? <InlineDeferredError title="Leaderboards unavailable" message={error} /> : null}
          {model.leaderboards.length ? model.leaderboards.map((leaderboard) => (
            <div key={leaderboard.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-sm font-black text-gray-950">{leaderboard.label}</div>
              <div className="mt-3 space-y-2">
                {leaderboard.leaders.map((leader) => (
                  <div key={`${leaderboard.id}-${leader.playerId}`} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                    <div className="w-6 text-xs font-black text-gray-500">#{leader.rank}</div>
                    <PlayerPhoto name={leader.playerName} photoUrl={leader.photoUrl} small />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-black text-gray-950">{leader.playerNumber ? `#${leader.playerNumber} ` : ''}{leader.playerName}</div>
                    </div>
                    <div className="text-sm font-black text-primary-700">{leader.formattedValue}</div>
                  </div>
                ))}
              </div>
            </div>
          )) : !loading && !error ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">Leaderboards appear after public stat configs and completed tracked games exist.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function MoreTab({ model, auth, staffPermissionsLoading, staffPermissionsError, sponsorsLoading, sponsorsError, onTeamDetailRefresh }: { model: TeamDetailModel; auth: AuthState; staffPermissionsLoading: boolean; staffPermissionsError: string; sponsorsLoading: boolean; sponsorsError: string; onTeamDetailRefresh: () => Promise<void> }) {
  const statTrackerConfigs = model.statTrackerConfigs || [];
  const orphanedConfigAssignments = model.canManageTeam
    ? model.upcomingEvents.filter((event) => event.type === 'game' && event.statTrackerConfigId && !event.statTrackerConfigExists)
    : [];

  return (
    <div className="space-y-4">
      {model.canManageTeam ? <StatTrackerConfigsCard configs={statTrackerConfigs} orphanedAssignments={orphanedConfigAssignments} /> : null}
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
          {model.canManageTeam ? <InternalAction icon={Award} label="Awards drafts" detail="Pick a template, select players, and preview certificates in the app." to={`/teams/${encodeURIComponent(model.team.id)}/certificates`} /> : null}
          {model.canManageTeam ? <InternalAction icon={Dumbbell} label="Drill library" detail="Browse community drills and manage favorites." to={`/teams/${encodeURIComponent(model.team.id)}/drills`} /> : null}
          <InternalAction icon={ImageIcon} label="Media albums" detail="Photos, video links, albums, and files." to={`/teams/${encodeURIComponent(model.team.id)}/media`} />
          <InternalAction icon={DollarSign} label="My fees" detail="Balances, checkout links, installments, and history." to="/parent-tools/fees" />
          <InternalAction icon={Ticket} label="Registrations" detail="Open published team registration forms." to="/parent-tools/registrations" />
          {model.team.streamUrl ? <ExternalAction icon={Radio} label="Watch stream" detail="Open the configured team stream." href={model.team.streamUrl} /> : null}
          {model.team.bracketUrl ? <ExternalAction icon={Trophy} label="Tournament bracket" detail="Open official bracket." href={model.team.bracketUrl} /> : null}
          {model.team.leagueUrl ? <ExternalAction icon={Trophy} label="League page" detail="Open standings or league registration source." href={model.team.leagueUrl} /> : null}
        </div>
      </section>

      {model.team.registrationProvider.length ? (
        <section className="app-card p-4">
          <div className="text-sm font-black text-gray-950">Registration provider</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {model.team.registrationProvider.map((row) => (
              <div key={row.label} className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.04em] text-blue-700">{row.label}</div>
                <div className="mt-1 break-all text-sm font-black text-gray-950">{row.value}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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

function StatTrackerConfigsCard({ configs, orphanedAssignments }: { configs: TeamDetailModel['statTrackerConfigs']; orphanedAssignments: TeamDetailModel['upcomingEvents'] }) {
  const safeConfigs = configs || [];

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Stat tracker configs</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Read-only view of this team&apos;s tracker setups, sport routing, and scheduled game assignments.</div>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{safeConfigs.length} config{safeConfigs.length === 1 ? '' : 's'}</span>
      </div>

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
              <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-black text-primary-700">{formatConfigColumnSummary(config.columnCount, config.columnNames)}</span>
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

function ScoreboardWidgetCard({ model }: { model: TeamDetailModel }) {
  const widgetUrl = buildScoreboardWidgetUrl(model.team.id);
  const embedCode = buildScoreboardWidgetEmbedCode(model.team);
  const [copyStatus, setCopyStatus] = useState<{ kind: 'embed' | 'link'; success: boolean } | null>(null);

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
  const [copyStatus, setCopyStatus] = useState<{ kind: 'code' | 'link'; success: boolean } | null>(null);
  if (!summary) return null;
  const scorekeeperGrantTargets = summary.scorekeeperGrantTargets || [];
  const videographerGrantTargets = summary.videographerGrantTargets || [];
  const isAllConfirmedScorekeeping = summary.scorekeepingMode === 'all_confirmed';
  const existingEmails = getStaffPermissionEmails(summary);

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setResult(null);
    setCopyStatus(null);
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
      setResult(inviteResult);
      setEmail('');
      await onInviteSuccess();
    } catch (submitError: any) {
      setError(submitError?.message || 'Unable to send admin invite.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyInviteValue(kind: 'code' | 'link', value: string | null) {
    if (!value) return;
    const copyResult = await copyPublicText(value);
    setCopyStatus({ kind, success: copyResult === 'copied' });
  }

  async function shareInviteLink() {
    if (!result?.acceptInviteUrl) return;
    const shareResult = await sharePublicUrl({
      title: `${model.team.name} staff invite`,
      text: `Join ${model.team.name} staff on ALL PLAYS`,
      url: result.acceptInviteUrl,
      clipboardText: result.acceptInviteUrl
    });
    setGrantStatus({
      success: shareResult === 'shared' || shareResult === 'copied',
      message: shareResult === 'shared'
        ? 'Share sheet opened.'
        : shareResult === 'copied'
          ? 'Invite link copied.'
          : 'Unable to share the invite from this device.'
    });
  }

  async function removeAdmin(emailToRemove: string) {
    if (!emailToRemove || removingAdminEmail) return;
    const confirmed = window.confirm(`Remove ${emailToRemove} as a team admin?`);
    if (!confirmed) return;
    setRemovingAdminEmail(emailToRemove);
    setGrantStatus(null);
    setResult(null);
    setCopyStatus(null);
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
    setCopyStatus(null);
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
    setCopyStatus(null);
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

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Team Staff &amp; Permissions</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Owners and platform admins can manage team admins here in the app. Scoped helpers only cover game-day jobs like scorekeeping, Stream &amp; Score, video, and volunteer tasks.</div>
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
            <div className="mt-3 rounded-lg border border-white/80 bg-white p-3 text-xs font-semibold leading-5 text-gray-700" role="status">
              <div className="font-black text-gray-950">
                {result.status === 'sent' ? `Invite sent to ${result.email}.` : result.status === 'existing_user' ? `${result.email} already has an account and was added as an admin.` : `Email delivery needs a fallback for ${result.email}.`}
              </div>
              {result.code || result.acceptInviteUrl ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {result.code ? <button type="button" className="secondary-button !min-h-8 text-xs" onClick={() => copyInviteValue('code', result.code)}>Copy code</button> : null}
                  {result.acceptInviteUrl ? <button type="button" className="secondary-button !min-h-8 text-xs" onClick={() => copyInviteValue('link', result.acceptInviteUrl)}>Copy link</button> : null}
                  {result.acceptInviteUrl ? <button type="button" className="secondary-button !min-h-8 text-xs" onClick={shareInviteLink}>Share invite</button> : null}
                </div>
              ) : null}
              {copyStatus ? <div className={`mt-2 font-black ${copyStatus.success ? 'text-emerald-700' : 'text-rose-700'}`}>{copyStatus.success ? `${copyStatus.kind === 'code' ? 'Invite code' : 'Invite link'} copied.` : `Unable to copy ${copyStatus.kind === 'code' ? 'invite code' : 'invite link'}.`}</div> : null}
            </div>
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

function SummaryStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
      <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
      <div className="mt-1 truncate text-sm font-black text-gray-950">{value}</div>
      <div className="truncate text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
    </div>
  );
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
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const scheduleEvent = useMemo(() => buildTeamReminderScheduleEvent(event, model), [event, model]);
  const canLoad = Boolean(auth.user && scheduleEvent && model.canManageTeam && event.date.getTime() >= Date.now() && event.status.toLowerCase() !== 'completed');

  useEffect(() => {
    setPreview(null);
    setLoading(false);
    setSending(false);
    setStatus(null);
    setError(null);
    setRevealed(false);
  }, [auth.user?.uid, canLoad, scheduleEvent?.eventKey]);

  if (!scheduleEvent || !canLoad) return null;

  const loadPreview = async () => {
    if (!auth.user || loading || sending) return;
    setRevealed(true);
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const nextPreview = await reminderPreviewLoader.loadPreview(scheduleEvent, auth.user);
      setPreview(nextPreview);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load RSVP reminder preview.');
    } finally {
      setLoading(false);
    }
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

  if (error && !preview) {
    return (
      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
        <div className="text-xs font-bold text-rose-700">{error}</div>
        <button type="button" className="secondary-button mt-2 !min-h-9 px-3 text-xs" onClick={loadPreview}>
          Retry reminder preview
        </button>
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
    if (!auth.user || sending) return;
    const confirmed = window.confirm(`Send an RSVP reminder to ${preview.missingPlayerCount} no-response ${preview.missingPlayerCount === 1 ? 'player' : 'players'}? ${preview.eligibleEmailCount} eligible parent/guardian ${preview.eligibleEmailCount === 1 ? 'email' : 'emails'} will be targeted.`);
    if (!confirmed) return;
    setSending(true);
    setError(null);
    setStatus(null);
    try {
      const result: StaffRsvpReminderSendResult = await sendStaffRsvpReminder(scheduleEvent, auth.user, auth.profile || {});
      setPreview(result);
      setStatus(`RSVP reminder sent to team chat and ${result.emailSentCount} parent/guardian ${result.emailSentCount === 1 ? 'email' : 'emails'}.`);
    } catch (sendError: any) {
      setError(sendError?.message || 'Unable to send RSVP reminder.');
    } finally {
      setSending(false);
    }
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
      {error ? <div className="mt-2 text-xs font-bold text-rose-700">{error}</div> : null}
    </div>
  );
}

function buildTeamReminderScheduleEvent(event: TeamDetailEvent, model: TeamDetailModel): ParentScheduleEvent | null {
  if (!model.canManageTeam || event.isCancelled || !event.id || !event.date) return null;
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
    isTeamStaff: true,
    isTeamRsvpReminderManager: true
  };
}

function PlayerRow({
  teamId,
  teamName,
  authUser,
  player,
  canManageTeam = false,
  pending = false,
  onToggleActive,
  inviteSummary,
  onInviteCreated
}: {
  teamId: string;
  teamName: string;
  authUser: AuthState['user'];
  player: TeamDetailPlayer;
  canManageTeam?: boolean;
  pending?: boolean;
  onToggleActive?: (player: TeamDetailPlayer) => Promise<void>;
  inviteSummary?: TeamRosterParentInviteSummary;
  onInviteCreated: () => Promise<void>;
}) {
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteResult, setInviteResult] = useState<CreateRosterParentInviteForAppResult | null>(null);
  const [inviteStatus, setInviteStatus] = useState<{ success: boolean; message: string } | null>(null);

  const effectiveStatus = inviteResult?.status || inviteSummary?.status || 'none';
  const statusLabel = effectiveStatus === 'accepted' ? 'Accepted' : effectiveStatus === 'pending' ? 'Pending invite' : 'No parent linked';
  const statusClassName = effectiveStatus === 'accepted'
    ? 'bg-emerald-50 text-emerald-700'
    : effectiveStatus === 'pending'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-100 text-gray-700';

  async function createInvite() {
    if (creatingInvite) return;
    setCreatingInvite(true);
    setInviteStatus(null);
    try {
      const result = await createRosterParentInviteForApp(teamId, authUser || null, player);
      setInviteResult(result);
      setInviteStatus({ success: true, message: result.autoLinked ? 'Existing parent linked automatically.' : 'Parent invite is ready to copy or share.' });
      await onInviteCreated();
    } catch (error: any) {
      setInviteStatus({ success: false, message: error?.message || 'Unable to create a parent invite.' });
    } finally {
      setCreatingInvite(false);
    }
  }

  async function copyInvite(kind: 'code' | 'link') {
    const value = kind === 'code' ? inviteResult?.code : inviteResult?.inviteUrl;
    if (!value) return;
    const result = await copyPublicText(value);
    setInviteStatus({ success: result === 'copied', message: result === 'copied' ? `${kind === 'code' ? 'Invite code' : 'Invite link'} copied.` : `Unable to copy the ${kind}.` });
  }

  async function shareInvite() {
    if (!inviteResult?.inviteUrl) return;
    const result = await sharePublicUrl({
      title: `${player.name} parent invite`,
      text: `Join ${teamName} on ALL PLAYS for ${player.name}`,
      url: inviteResult.inviteUrl,
      clipboardText: inviteResult.inviteUrl
    });
    if (result === 'shared') {
      setInviteStatus({ success: true, message: 'Share sheet opened.' });
      return;
    }
    if (result === 'copied') {
      setInviteStatus({ success: true, message: 'Invite link copied.' });
      return;
    }
    setInviteStatus({ success: false, message: 'Unable to share the invite from this device.' });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link to={`/players/${encodeURIComponent(teamId)}/${encodeURIComponent(player.id)}`} className="flex min-w-0 flex-1 items-center gap-3 transition hover:text-primary-700">
          <PlayerPhoto name={player.name} photoUrl={player.photoUrl} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-black text-gray-950">{player.number ? `#${player.number} ` : ''}{player.name}</span>
              {player.isLinked ? <span className="rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-black text-white">Yours</span> : null}
              {!player.active ? <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-black text-gray-700">Inactive</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-gray-500">{player.position || 'Player profile'}</span>
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-gray-300" aria-hidden="true" />
        </Link>
        {canManageTeam && onToggleActive ? (
          <button
            type="button"
            className={`inline-flex min-h-10 flex-none items-center justify-center rounded-lg px-3 text-xs font-black ${player.active ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'} disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={() => void onToggleActive(player)}
            disabled={pending}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : player.active ? 'Deactivate' : 'Reactivate'}
          </button>
        ) : null}
      </div>
      {canManageTeam ? (
        <div className="mt-3 rounded-lg border border-white/80 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.04em] ${statusClassName}`}>{statusLabel}</span>
            {player.active ? (
              <button type="button" className="secondary-button !min-h-8 text-xs" disabled={creatingInvite} onClick={createInvite}>
                {creatingInvite ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                {effectiveStatus === 'pending' || inviteResult ? 'Regenerate invite' : 'Invite parent'}
              </button>
            ) : null}
          </div>
          {inviteSummary?.status === 'accepted' && inviteSummary.acceptedParentCount > 0 ? <div className="mt-2 text-xs font-semibold text-emerald-700">{inviteSummary.acceptedParentCount} linked parent{inviteSummary.acceptedParentCount === 1 ? '' : 's'}.</div> : null}
          {inviteSummary?.status === 'pending' && inviteSummary.pendingInviteCount > 0 && !inviteResult ? <div className="mt-2 text-xs font-semibold text-amber-700">{inviteSummary.pendingInviteCount} pending invite{inviteSummary.pendingInviteCount === 1 ? '' : 's'}.</div> : null}
          {!player.active ? <div className="mt-2 text-xs font-semibold text-gray-500">Reactivate the player to send a parent invite.</div> : null}
          {inviteResult ? (
            <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50 p-3">
              <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Invite code</div>
              <div className="mt-1 font-mono text-sm font-black text-gray-950">{inviteResult.code}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="secondary-button !min-h-8 text-xs" onClick={() => copyInvite('code')}>Copy code</button>
                <button type="button" className="secondary-button !min-h-8 text-xs" onClick={() => copyInvite('link')}>Copy link</button>
                <button type="button" className="secondary-button !min-h-8 text-xs" onClick={shareInvite}>Share</button>
              </div>
            </div>
          ) : null}
          {inviteStatus ? <div className={`mt-2 text-xs font-black ${inviteStatus.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{inviteStatus.message}</div> : null}
        </div>
      ) : null}
    </div>
  );
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

function PlayerPhoto({ name, photoUrl, small = false }: { name: string; photoUrl?: string | null; small?: boolean }) {
  const sizeClass = small ? 'h-8 w-8 text-[10px]' : 'h-11 w-11 text-xs';
  if (photoUrl) {
    return <img src={photoUrl} alt="" className={`${sizeClass} flex-none rounded-full object-cover ring-1 ring-gray-200`} loading="lazy" />;
  }
  return (
    <span className={`${sizeClass} flex flex-none items-center justify-center rounded-full bg-gray-900 font-black text-white`}>
      {getInitials(name)}
    </span>
  );
}

function SponsorImage({ sponsor }: { sponsor: { name: string; imageUrl: string | null } }) {
  if (sponsor.imageUrl) return <img src={sponsor.imageUrl} alt="" className="h-12 w-12 flex-none rounded-xl object-cover" loading="lazy" />;
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
  return row.record || `${row.w || 0}-${row.l || 0}${row.t ? `-${row.t}` : ''}`;
}

function getStandingDetail(model: TeamDetailModel) {
  const row = model.standings.currentRow;
  if (!row) return model.team.leagueUrl ? 'Open league page for standings' : 'No standings configured';
  const rank = typeof row.rank === 'number' ? `#${row.rank}` : model.standings.label;
  return `${rank} · PF ${row.pf || 0} · PA ${row.pa || 0}`;
}

function formatEventDate(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'T';
}
