import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  DollarSign,
  Loader2,
  MessageCircle,
  RefreshCw,
  Share2,
  Shield,
  Ticket,
  Trophy,
  UserRound,
  Users,
  type LucideIcon
} from 'lucide-react';
import { loadParentHome } from '../lib/homeService';
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
import type { AuthState } from '../lib/types';

type HomeSectionId = 'today' | 'players' | 'teams' | 'access';

const homeSections: Array<{ id: HomeSectionId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' },
  { id: 'access', label: 'Access' }
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
  const [activeSection, setActiveSection] = useState<HomeSectionId>('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshHome = async () => {
    if (!auth.user) return;
    setLoading(true);
    setError('');
    try {
      setHome(await loadParentHome(auth.user));
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load Home.');
      setHome(emptyHome());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  const topAction = home.actionItems[0] || null;
  const displayName = auth.user?.displayName || auth.user?.email || 'ALL PLAYS User';
  const openCount = home.metrics.rsvpNeeded + home.metrics.packetsReady + home.metrics.unreadMessages + home.fees.length;
  const today = new Date();

  const selectSection = (sectionId: HomeSectionId) => {
    setActiveSection(sectionId);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  return (
    <div className="home-page home-page-live space-y-3">
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
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0 sm:!w-auto sm:!px-3 text-xs" onClick={refreshHome} disabled={loading} aria-label="Refresh Home" title="Refresh Home">
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
        </div>
      </section>

      <div className="home-section-nav sticky top-24 z-30 -mx-1 overflow-x-auto bg-gray-50/95 py-2 backdrop-blur">
        <div className="grid min-w-max grid-cols-4 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
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

      {loading ? (
        <section className="app-card p-6 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
          <div className="mt-3 text-sm font-black text-gray-900">Loading Home</div>
          <div className="mt-1 text-xs font-semibold text-gray-500">Pulling players, teams, schedule, chat, and fees.</div>
        </section>
      ) : null}

      {!loading && activeSection === 'today' ? <TodaySection home={home} /> : null}
      {!loading && activeSection === 'players' ? <PlayersSection players={home.players} /> : null}
      {!loading && activeSection === 'teams' ? <TeamsSection teams={home.teams} /> : null}
      {!loading && activeSection === 'access' ? <AccessSection /> : null}
    </div>
  );
}

function TodaySection({ home }: { home: ParentHomeModel }) {
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

function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}
