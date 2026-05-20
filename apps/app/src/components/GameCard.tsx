import { Link } from 'react-router-dom';
import { CalendarDays, Car, ChevronRight, ClipboardCheck, MapPin, Users } from 'lucide-react';
import { mockPlayers } from '../data/mockData';
import type { Game } from '../lib/types';

const availabilityLabel: Record<Game['availability'], string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_going: 'Not going',
  needed: 'RSVP needed'
};

const availabilityClass: Record<Game['availability'], string> = {
  going: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  maybe: 'border-amber-200 bg-amber-50 text-amber-700',
  not_going: 'border-rose-200 bg-rose-50 text-rose-700',
  needed: 'border-primary-200 bg-primary-50 text-primary-700'
};

export function GameCard({ game, compact = false }: { game: Game; compact?: boolean }) {
  const players = mockPlayers.filter((player) => game.playerIds.includes(player.id));

  return (
    <Link to={`/games/${game.id}`} className="app-card block p-4 transition hover:border-primary-200 hover:shadow-app-lg">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <CalendarDays className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-black text-gray-950">
              {game.type === 'practice' ? 'Practice' : `${game.teamName} vs ${game.opponent}`}
            </span>
            <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] ${availabilityClass[game.availability]}`}>
              {availabilityLabel[game.availability]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-gray-600">
            <span>{game.dateLabel}</span>
            <span>{game.timeLabel}</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {game.location}
            </span>
          </div>
          {!compact ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
                <div className="flex items-center gap-1.5 text-xs font-black text-gray-800">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  Players
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-gray-600">{players.map((player) => player.name).join(', ') || 'Team event'}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
                <div className="flex items-center gap-1.5 text-xs font-black text-gray-800">
                  <Car className="h-3.5 w-3.5" aria-hidden="true" />
                  Rideshare
                </div>
                <div className="mt-1 text-xs font-semibold text-gray-600">
                  {game.rideshare.seatsLeft} seats, {game.rideshare.requests} requests
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
                <div className="flex items-center gap-1.5 text-xs font-black text-gray-800">
                  <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Assignments
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-gray-600">{game.assignments[0] || 'None posted'}</div>
              </div>
            </div>
          ) : null}
        </div>
        <ChevronRight className="mt-1 h-5 w-5 flex-none text-gray-400" aria-hidden="true" />
      </div>
    </Link>
  );
}
