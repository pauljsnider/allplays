import { Link, Navigate, useParams } from 'react-router-dom';
import { Award, BarChart3, ClipboardList, FileVideo, LineChart, Shield, Sparkles, Trophy, UserRound } from 'lucide-react';
import { mockGames, mockPlayers } from '../data/mockData';
import type { AuthState } from '../lib/types';

export function PlayerDetail({ auth }: { auth: AuthState }) {
  const { playerId } = useParams();
  const player = mockPlayers.find((item) => item.id === playerId);

  if (!player) {
    return <Navigate to="/home" replace />;
  }

  const games = mockGames.filter((game) => game.playerIds.includes(player.id));

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl bg-primary-50 text-2xl font-black text-primary-700">#{player.number}</div>
          <div className="min-w-0">
            <div className="app-label">Player</div>
            <h1 className="truncate text-2xl font-black text-gray-950">{player.name}</h1>
            <p className="mt-1 truncate text-sm font-semibold text-gray-600">{player.teamName}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FeatureCard icon={UserRound} title="Parent view" detail="Schedule, RSVP, rideshare, assignments, packets, and fees visible to parents." />
        {auth.isCoach || auth.isAdmin ? <FeatureCard icon={Shield} title="Coach view" detail="Practice attendance, tracking statuses, notes, and admin-only player fields." /> : null}
        <FeatureCard icon={LineChart} title="Advanced analytics" detail="Performance summaries, trends, and player comparison hooks." />
        <FeatureCard icon={ClipboardList} title="Game stats" detail="Match report link, stat drilldown, and score sheet context." />
        <FeatureCard icon={BarChart3} title="Season averages" detail="Aggregated season stats from current player profile contracts." />
        <FeatureCard icon={FileVideo} title="Video clips" detail="Game clips, highlight clips, and public athlete profile sharing." />
        <FeatureCard icon={Sparkles} title="Profile builder" detail="Headshot upload, season selection, share settings, and career stats." />
        <FeatureCard icon={Award} title="Incentives" detail="Parent incentives and awards tied to team activity." />
      </section>

      <section className="app-card p-4">
        <h2 className="app-section-title">Game history</h2>
        <div className="mt-3 space-y-2">
          {games.map((game) => (
            <Link key={game.id} to={`/games/${game.id}`} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
              <Trophy className="h-5 w-5 flex-none text-primary-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-gray-950">{game.teamName} vs {game.opponent}</div>
                <div className="truncate text-xs font-semibold text-gray-500">{game.dateLabel} · {game.timeLabel}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, detail }: { icon: typeof UserRound; title: string; detail: string }) {
  return (
    <div className="app-card p-4">
      <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">{detail}</div>
    </div>
  );
}
