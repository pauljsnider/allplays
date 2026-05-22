import { Link } from 'react-router-dom';
import { BarChart3, CalendarDays, Car, ChevronRight, ClipboardList, Dumbbell, MessageCircle, Trophy, UserRound, Users } from 'lucide-react';
import { GameCard } from '../components/GameCard';
import { mockGames, mockMessages, mockPlayers, mockTeams } from '../data/mockData';
import type { AuthState } from '../lib/types';

export function Home({ auth }: { auth: AuthState }) {
  const nextGames = mockGames.slice(0, 3);
  const rsvpNeeded = mockGames.filter((game) => game.availability === 'needed').length;
  const unreadMessages = mockMessages.reduce((total, message) => total + message.unreadCount, 0);

  return (
    <div className="home-page space-y-4">
      <section className="home-hero rounded-2xl border border-primary-100 bg-white p-4 shadow-app">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="app-label">Home</div>
            <h1 className="mt-1 text-2xl font-black leading-tight text-gray-950">Today for your players</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-gray-600">
              A mobile-first version of the current parent dashboard: schedule, RSVP, rideshare, assignments, fees, packets, teams, and messages.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-right">
            <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Signed in</div>
            <div className="text-sm font-black text-gray-950">{auth.user?.displayName || 'ALL PLAYS User'}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric icon={UserRound} label="Players" value={String(mockPlayers.length)} />
          <Metric icon={Users} label="Teams" value={String(mockTeams.length)} />
          <Metric icon={ClipboardList} label="RSVP" value={String(rsvpNeeded)} />
          <Metric icon={MessageCircle} label="Unread" value={String(unreadMessages)} />
        </div>
      </section>

      <section className="home-schedule-section space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="app-section-title">Schedule</h2>
          <Link to="/schedule" className="text-sm font-black text-primary-700">View all</Link>
        </div>
        {nextGames.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </section>

      <section className="home-secondary-grid grid gap-3 lg:grid-cols-2">
        <div className="app-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="app-section-title">My Players</h2>
            <UserRound className="h-5 w-5 text-primary-600" aria-hidden="true" />
          </div>
          <div className="mt-3 space-y-2">
            {mockPlayers.map((player) => (
              <Link key={player.id} to={`/players/${player.id}`} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gray-100 text-sm font-black text-gray-700">#{player.number}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-gray-950">{player.name}</div>
                  <div className="truncate text-xs font-semibold text-gray-500">{player.teamName}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>

        <div className="app-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="app-section-title">My Teams</h2>
            <Users className="h-5 w-5 text-primary-600" aria-hidden="true" />
          </div>
          <div className="mt-3 space-y-2">
            {mockTeams.map((team) => (
              <Link key={team.id} to={`/teams/${team.id}`} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <Trophy className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-gray-950">{team.name}</div>
                  <div className="truncate text-xs font-semibold text-gray-500">{team.sport} · {team.role} · {team.record}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="home-quick-grid grid gap-3 sm:grid-cols-3">
        <QuickCard icon={Dumbbell} title="Practice Packet" detail="Home packets, attendance, drills, and parent follow-up." to="/capabilities/drills" />
        <QuickCard icon={Car} title="Rideshare" detail="Seats, requests, and event-level coordination." to="/schedule" />
        <QuickCard icon={BarChart3} title="Performance" detail="Match reports, summaries, stats, clips, and insights." to="/capabilities/player-profile" />
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
      <div className="mt-2 text-2xl font-black text-gray-950">{value}</div>
      <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
    </div>
  );
}

function QuickCard({ icon: Icon, title, detail, to }: { icon: typeof CalendarDays; title: string; detail: string; to: string }) {
  return (
    <Link to={to} className="app-card flex min-h-32 flex-col justify-between p-4 transition hover:border-primary-200 hover:shadow-app-lg">
      <Icon className="h-6 w-6 text-primary-600" aria-hidden="true" />
      <span>
        <span className="block text-sm font-black text-gray-950">{title}</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-gray-600">{detail}</span>
      </span>
    </Link>
  );
}
