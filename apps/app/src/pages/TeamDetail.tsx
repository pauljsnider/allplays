import { Link, Navigate, useParams } from 'react-router-dom';
import { BarChart3, CalendarDays, ClipboardCheck, LockKeyhole, MessageCircle, Radio, Shield, Ticket, Trophy, Users } from 'lucide-react';
import { GameCard } from '../components/GameCard';
import { RoleBadge } from '../components/Badges';
import { mockGames, mockPlayers, mockTeams } from '../data/mockData';
import type { AuthState } from '../lib/types';

export function TeamDetail({ auth }: { auth: AuthState }) {
  const { teamId } = useParams();
  const team = mockTeams.find((item) => item.id === teamId);

  if (!team) {
    return <Navigate to="/teams" replace />;
  }

  const roster = mockPlayers.filter((player) => player.teamId === team.id);
  const games = mockGames.filter((game) => game.teamId === team.id);
  const canAdmin = auth.isCoach || auth.isAdmin || team.role !== 'Parent';

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="app-label">Team</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950">{team.name}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <RoleBadge role={team.role} />
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-600">{team.sport}</span>
            </div>
          </div>
          <Link to={`/messages/${team.id}`} className="secondary-button">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Chat
          </Link>
        </div>
      </section>

      {canAdmin ? (
        <section className="app-card p-4">
          <div className="flex items-center gap-2 text-sm font-black text-primary-800">
            <Shield className="h-4 w-4" aria-hidden="true" />
            Admin buttons
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {['Roster', 'Schedule', 'Fees', 'Permissions'].map((label) => (
              <Link key={label} to={`/capabilities/${label === 'Roster' ? 'edit-roster' : label === 'Schedule' ? 'edit-schedule' : label === 'Fees' ? 'team-fees' : 'edit-team'}`} className="secondary-button justify-center">
                {label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard icon={Ticket} title="Team Pass" detail="Registration, access, stream, and sponsor links." />
        <InfoCard icon={Trophy} title="Record" detail={team.record} />
        <InfoCard icon={Users} title="Roster size" detail={`${team.rosterSize} players`} />
        <InfoCard icon={Radio} title="Stream" detail="Livestream link ready for game day." />
        <InfoCard icon={ClipboardCheck} title="Availability" detail="RSVP settings and reminders." />
        <InfoCard icon={LockKeyhole} title="Permissions" detail="Team and staff access controls." />
        <InfoCard icon={BarChart3} title="Analytics" detail="Insights, tracking summaries, leaderboards." />
        <InfoCard icon={CalendarDays} title="Standings" detail="League and game day standings." />
      </section>

      <section className="app-card p-4">
        <h2 className="app-section-title">Roster</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {roster.map((player) => (
            <Link key={player.id} to={`/players/${player.id}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
              <div className="text-sm font-black text-gray-950">#{player.number} {player.name}</div>
              <div className="mt-1 text-xs font-semibold text-gray-500">{player.teamName}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="app-section-title">Schedule</h2>
        {games.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </section>
    </div>
  );
}

function InfoCard({ icon: Icon, title, detail }: { icon: typeof Ticket; title: string; detail: string }) {
  return (
    <div className="app-card p-4">
      <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">{detail}</div>
    </div>
  );
}
