import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, Loader2, MapPin, RefreshCw, ShieldCheck, Trophy, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { formatShortDate, formatTimeOfDay } from '../lib/datetime';
import {
  FamilyShareTokenError,
  loadFamilyShareView,
  type FamilyShareEvent,
  type FamilyShareViewModel
} from '../lib/familyShareViewerService';

export function FamilyShare() {
  const { token = '' } = useParams();
  const [model, setModel] = useState<FamilyShareViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const refresh = useCallback(() => {
    let active = true;
    setLoading(true);
    setModel(null);
    setError(null);
    loadFamilyShareView(token)
      .then((loadedModel) => {
        if (active) setModel(loadedModel);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(getFamilyShareErrorState(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  useEffect(refresh, [refresh]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <section className="app-card p-8 text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-black text-gray-950">Loading family page</h1>
        </section>
      </div>
    );
  }

  if (error || !model) {
    const state = error || getFamilyShareErrorState(null);
    return (
      <div className="mx-auto max-w-2xl">
        <section className="app-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-3 text-2xl font-black text-gray-950">{state.title}</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">{state.detail}</p>
          <Link to="/home" className="secondary-button mx-auto mt-5 w-fit justify-center text-xs">Open ALL PLAYS</Link>
        </section>
      </div>
    );
  }

  return <FamilyShareContent model={model} onRefresh={refresh} />;
}

function FamilyShareContent({ model, onRefresh }: { model: FamilyShareViewModel; onRefresh: () => void }) {
  const eventCount = model.events.length;
  const playerCount = model.children.length;
  const teamCount = model.teams.length;
  const expiresLabel = model.expiresAt ? `${formatShortDate(model.expiresAt)} ${formatTimeOfDay(model.expiresAt)}` : '';

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <section className="overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-app">
        <div className="bg-primary-950 p-5 text-white sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-black uppercase text-primary-100">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Shared family page
              </div>
              <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">{model.label}</h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-primary-50">
                Schedule, players, and recent results shared from ALL PLAYS.
              </p>
            </div>
            <button type="button" className="secondary-button !border-white/20 !bg-white/10 !text-white hover:!bg-white/20" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-4">
          <Metric label="Players" value={playerCount} icon={Users} />
          <Metric label="Teams" value={teamCount} icon={ShieldCheck} />
          <Metric label="Events" value={eventCount} icon={CalendarDays} />
          <Metric label="Expires" value={expiresLabel || 'Active'} icon={Trophy} />
        </div>
      </section>

      {model.calendarWarnings.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900" role="status">
          Some external calendars could not be loaded ({model.calendarWarnings.slice(0, 2).join(', ')}{model.calendarWarnings.length > 2 ? ` +${model.calendarWarnings.length - 2} more` : ''}). ALL PLAYS events are still shown.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section className="app-card p-4">
          <h2 className="text-base font-black text-gray-950">Players</h2>
          <div className="mt-3 grid gap-2">
            {model.children.length ? model.children.map((child) => (
              <div key={`${child.teamId}-${child.playerId}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-gray-200 p-3">
                <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full bg-primary-50 text-sm font-black text-primary-700">
                  {child.playerPhotoUrl ? <img src={child.playerPhotoUrl} alt="" className="h-full w-full object-cover" /> : (child.playerName.charAt(0) || 'P')}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-gray-950">{child.playerName}</div>
                  <div className="truncate text-xs font-semibold text-gray-500">{child.teamName || 'Team'}{child.playerNumber ? ` - #${child.playerNumber}` : ''}</div>
                </div>
              </div>
            )) : <EmptyBlock title="No players shared" detail="Ask the parent to refresh this family share link." />}
          </div>
        </section>

        <section className="app-card p-4">
          <h2 className="text-base font-black text-gray-950">Upcoming</h2>
          <div className="mt-3 grid gap-2">
            {model.upcomingEvents.length ? model.upcomingEvents.map((event) => (
              <FamilyEventRow key={event.eventKey} event={event} />
            )) : <EmptyBlock title="No upcoming events" detail="Games and practices will appear here after the team schedule is updated." />}
          </div>
        </section>
      </div>

      <section className="app-card p-4">
        <h2 className="text-base font-black text-gray-950">Teams</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {model.teams.length ? model.teams.map((team) => (
            <div key={team.teamId} className="rounded-xl border border-gray-200 p-3">
              <div className="text-sm font-black text-gray-950">{team.teamName}</div>
              <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">{team.playerNames.join(', ') || 'Shared player'}</div>
            </div>
          )) : <EmptyBlock title="No teams shared" detail="Team details show after a player is included in the share." />}
        </div>
      </section>

      <section className="app-card p-4">
        <h2 className="text-base font-black text-gray-950">Recent Results</h2>
        <div className="mt-3 grid gap-2">
          {model.recentResults.length ? model.recentResults.map((event) => (
            <FamilyEventRow key={event.eventKey} event={event} compact />
          )) : <EmptyBlock title="No recent results" detail="Completed games and past scores will show here." />}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Users }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center gap-2 text-xs font-black uppercase text-gray-500">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-black text-gray-950">{value}</div>
    </div>
  );
}

function FamilyEventRow({ event, compact = false }: { event: FamilyShareEvent; compact?: boolean }) {
  const title = getFamilyEventTitle(event);
  const score = event.homeScore !== null || event.awayScore !== null ? `${event.homeScore ?? '-'}-${event.awayScore ?? '-'}` : '';
  const childNames = event.childNames.join(', ');

  return (
    <article className="rounded-xl border border-gray-200 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${event.type === 'practice' ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary-700'}`}>{event.type}</span>
            {event.isCancelled ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase text-rose-700">Cancelled</span> : null}
            {score ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">Final {score}</span> : null}
          </div>
          <h3 className="mt-2 text-sm font-black text-gray-950">{title}</h3>
          <div className="mt-1 text-xs font-semibold text-gray-500">{event.teamName}{childNames ? ` - ${childNames}` : ''}</div>
        </div>
        <div className="text-left text-xs font-black text-gray-600 sm:text-right">
          <div>{formatShortDate(event.date)}</div>
          <div>{formatTimeOfDay(event.date)}</div>
        </div>
      </div>
      {!compact ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-gray-600">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{event.location}</span>
          {event.sourceLabel ? <span>{event.sourceLabel}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

function EmptyBlock({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm">
      <div className="font-black text-gray-800">{title}</div>
      <div className="mt-1 font-semibold leading-6 text-gray-500">{detail}</div>
    </div>
  );
}

function getFamilyEventTitle(event: FamilyShareEvent) {
  if (event.title) return event.title;
  if (event.type === 'practice') return 'Practice';
  return event.opponent && event.opponent !== 'TBD' ? `vs ${event.opponent}` : 'Game';
}

function getFamilyShareErrorState(error: unknown) {
  if (error instanceof FamilyShareTokenError) {
    if (error.reason === 'expired') {
      return {
        title: 'This link has expired',
        detail: 'Ask the parent to create a new family share link. Expired links never load player, team, or schedule details.'
      };
    }
    if (error.reason === 'revoked') {
      return {
        title: 'This link was revoked',
        detail: 'Ask the parent to send a new family share link if you still need schedule access.'
      };
    }
    if (error.reason === 'missing') {
      return {
        title: 'Missing family share token',
        detail: 'Open the full family share link that was sent to you.'
      };
    }
  }

  return {
    title: 'This link is no longer valid',
    detail: 'The family page link you used has expired, been revoked, or does not exist.'
  };
}
