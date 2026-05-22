import { Link, Navigate, useParams } from 'react-router-dom';
import { BarChart3, Brain, Car, ClipboardCheck, FileText, ListTree, MessageCircleReply, Radio, Share2, Shield, Trophy, Users } from 'lucide-react';
import { mockGames, mockPlayers } from '../data/mockData';
import type { AuthState } from '../lib/types';

export function GameDetail({ auth }: { auth: AuthState }) {
  const { gameId } = useParams();
  const game = mockGames.find((item) => item.id === gameId);

  if (!game) {
    return <Navigate to="/schedule" replace />;
  }

  const players = mockPlayers.filter((player) => game.playerIds.includes(player.id));

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="app-label">{game.type}</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950">{game.teamName} vs {game.opponent}</h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">{game.dateLabel} · {game.timeLabel} · {game.location}</p>
          </div>
          <Link to={`/messages/${game.teamId}`} className="secondary-button">
            <MessageCircleReply className="h-4 w-4" aria-hidden="true" />
            Reply
          </Link>
        </div>
      </section>

      {auth.isCoach || auth.isAdmin ? (
        <section className="app-card p-4">
          <div className="flex items-center gap-2 text-sm font-black text-primary-800">
            <Shield className="h-4 w-4" aria-hidden="true" />
            Admin buttons
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {['Lineup', 'Tracker', 'RSVP', 'Wrap-up'].map((label) => (
              <Link key={label} to={`/capabilities/${label === 'Lineup' ? 'game-plan' : label === 'Tracker' ? 'track-standard' : label === 'RSVP' ? 'game-day' : 'game-report'}`} className="secondary-button justify-center">
                {label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="app-card p-4 lg:col-span-2">
          <h2 className="app-section-title">Availability</h2>
          <div className="mt-3 space-y-2">
            {players.map((player) => (
              <div key={player.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-gray-950">{player.name}</div>
                    <div className="text-xs font-semibold text-gray-500">#{player.number} · {player.teamName}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {['Going', 'Maybe', 'Out'].map((label) => (
                      <button key={label} type="button" className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-black text-gray-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Info icon={Car} title="Rideshare" detail={`${game.rideshare.seatsLeft} seats open · ${game.rideshare.requests} requests`} />
          <Info icon={ClipboardCheck} title="Assignments" detail={game.assignments.join(', ')} />
          <Info icon={Radio} title="Game" detail="Live tracker, stream, and postgame report hooks." />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Action icon={Share2} label="Share" to="/capabilities/game-report" />
        <Action icon={FileText} label="Match Report" to="/capabilities/game-report" />
        <Action icon={Brain} label="Insights" to="/capabilities/game-day" />
        <Action icon={BarChart3} label="Player Performance" to="/capabilities/player-profile" />
        <Action icon={ListTree} label="Play by Play" to="/capabilities/live-game" />
        <Action icon={Users} label="Opponent Stats" to="/capabilities/track-standard" />
        <Action icon={Trophy} label="Match Summary" to="/capabilities/game-report" />
      </section>
    </div>
  );
}

function Info({ icon: Icon, title, detail }: { icon: typeof Car; title: string; detail: string }) {
  return (
    <div className="app-card p-4">
      <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
      <div className="mt-2 text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">{detail}</div>
    </div>
  );
}

function Action({ icon: Icon, label, to }: { icon: typeof Share2; label: string; to: string }) {
  return (
    <Link to={to} className="app-card flex min-h-24 flex-col justify-between p-4 transition hover:border-primary-200 hover:shadow-app-lg">
      <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
      <span className="text-sm font-black text-gray-950">{label}</span>
    </Link>
  );
}
