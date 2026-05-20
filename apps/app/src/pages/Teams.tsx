import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, MessageCircle, Shield, Trophy, Users } from 'lucide-react';
import { RoleBadge } from '../components/Badges';
import { mockGames, mockTeams } from '../data/mockData';
import type { AuthState } from '../lib/types';

export function Teams({ auth }: { auth: AuthState }) {
  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="app-label">My Teams</div>
        <h1 className="mt-1 text-2xl font-black text-gray-950">Teams, roles, roster summary</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
          Parent-first team cards with linked players, staff role badges, roster counts, next game, unread chat, and admin/coach lite controls.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {auth.roles.map((role) => (
            <RoleBadge key={role} role={role} />
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {mockTeams.map((team) => {
          const nextGame = mockGames.find((game) => game.id === team.nextGameId);
          return (
            <Link key={team.id} to={`/teams/${team.id}`} className="app-card block p-4 transition hover:border-primary-200 hover:shadow-app-lg">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <Trophy className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-black text-gray-950">{team.name}</h2>
                    <RoleBadge role={team.role} />
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-600">{team.sport} · {team.record}</div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <MiniStat icon={Users} label="Roster" value={String(team.rosterSize)} />
                    <MiniStat icon={CalendarDays} label="Next" value={nextGame?.dateLabel.split(',')[0] || 'None'} />
                    <MiniStat icon={MessageCircle} label="Unread" value={String(team.unreadCount)} />
                  </div>
                </div>
                <ChevronRight className="mt-1 h-5 w-5 flex-none text-gray-400" aria-hidden="true" />
              </div>
            </Link>
          );
        })}
      </section>

      {auth.isCoach || auth.isAdmin ? (
        <section className="app-card p-4">
          <div className="flex items-center gap-2 text-sm font-black text-primary-800">
            <Shield className="h-4 w-4" aria-hidden="true" />
            Coach/admin lite scope
          </div>
          <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
            The first app pass supports roster visibility, schedule visibility, RSVP summaries, and sending chat. Editing teams, roster, schedule, fees, and advanced moderation stays in later milestones.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
      <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
      <div className="mt-1 truncate text-sm font-black text-gray-950">{value}</div>
      <div className="truncate text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
    </div>
  );
}
