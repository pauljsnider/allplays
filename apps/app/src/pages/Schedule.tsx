import { useMemo, useState } from 'react';
import { CalendarDays, Download, Filter, ListChecks } from 'lucide-react';
import { GameCard } from '../components/GameCard';
import { mockGames } from '../data/mockData';
import type { AuthState, Game } from '../lib/types';

type ScheduleFilter = 'all' | 'games' | 'practices' | 'rsvp';

export function Schedule({ auth }: { auth: AuthState }) {
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [view, setView] = useState<'list' | 'calendar'>('list');

  const visibleGames = useMemo(() => {
    return mockGames.filter((game) => {
      if (filter === 'games') {
        return game.type === 'game';
      }
      if (filter === 'practices') {
        return game.type === 'practice';
      }
      if (filter === 'rsvp') {
        return game.availability === 'needed';
      }
      return true;
    });
  }, [filter]);

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="app-label">Schedule</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950">Games, practices, RSVP</h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
              Matches the parent-dashboard schedule direction: mobile list first, with event detail, per-player RSVP, rideshare, assignments, and calendar export hooks.
            </p>
          </div>
          <button type="button" className="secondary-button">
            <Download className="h-4 w-4" aria-hidden="true" />
            Sync
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Segment active={view === 'list'} onClick={() => setView('list')} icon={ListChecks} label="List" />
          <Segment active={view === 'calendar'} onClick={() => setView('calendar')} icon={CalendarDays} label="Calendar" />
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          ['all', 'All'],
          ['games', 'Games'],
          ['practices', 'Practices'],
          ['rsvp', 'RSVP needed']
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`inline-flex min-h-10 flex-none items-center gap-2 rounded-full border px-3 text-sm font-black ${
              filter === value ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'
            }`}
            onClick={() => setFilter(value as ScheduleFilter)}
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {view === 'calendar' ? (
        <CalendarPreview games={visibleGames} />
      ) : (
        <div className="space-y-3">
          {visibleGames.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}

      {auth.isCoach || auth.isAdmin ? (
        <section className="app-card p-4">
          <div className="app-label">Coach/admin lite</div>
          <h2 className="mt-1 app-section-title">RSVP Summary</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Summary label="Going" value="7" />
            <Summary label="Maybe" value="1" />
            <Summary label="Missing" value="3" />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Segment({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof CalendarDays; label: string }) {
  return (
    <button type="button" className={`secondary-button ${active ? '' : '!border-gray-200 !bg-white !text-gray-600 !shadow-none'}`} onClick={onClick}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function CalendarPreview({ games }: { games: Game[] }) {
  return (
    <div className="app-card p-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {games.map((game) => (
          <div key={game.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-primary-700">{game.dateLabel}</div>
            <div className="mt-1 text-sm font-black text-gray-950">{game.teamName}</div>
            <div className="mt-1 text-xs font-semibold text-gray-600">{game.timeLabel} · {game.opponent}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="text-2xl font-black text-gray-950">{value}</div>
      <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
    </div>
  );
}
