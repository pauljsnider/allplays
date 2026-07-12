import { useEffect, useState } from 'react';
import { Loader2, MapPin, ShieldCheck, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import { getPublicTeamDetail, type PublicTeamProfile } from '../lib/publicTeamsService';

export function PublicTeamDetail() {
  const { teamId = '' } = useParams();
  const [team, setTeam] = useState<PublicTeamProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setTeam(null);
    setError('');
    getPublicTeamDetail(teamId)
      .then((item) => { if (active) setTeam(item); })
      .catch((loadError: any) => { if (active) { setTeam(null); setError(loadError?.message || 'Unable to load this public team.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [teamId]);

  if (loading) return <div className="app-card p-10 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" /></div>;
  if (!team) return <Status tone="error" message={error || 'Public team not found.'} />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap gap-3 text-sm font-black"><Link to="/discover?tab=teams" className="text-primary-700">← Find teams</Link><Link to="/discover" className="text-primary-700">Browse opportunities</Link></div>
      <section className="app-card overflow-hidden">
        <div className="bg-gradient-to-br from-primary-700 to-primary-950 p-6 text-white sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-2xl bg-white/15 ring-1 ring-white/20">
              {team.photoUrl ? <img src={team.photoUrl} alt="" className="h-full w-full object-cover" /> : <Users className="h-8 w-8" aria-hidden="true" />}
            </div>
            <div className="min-w-0"><div className="text-xs font-black uppercase tracking-[0.08em] text-primary-100">Public team</div><h1 className="mt-1 text-3xl font-black">{team.name}</h1><div className="mt-2 flex flex-wrap gap-3 text-sm font-bold text-primary-50">{team.sport ? <span>{team.sport}</span> : null}{team.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{team.location}</span> : null}</div></div>
          </div>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div><div className="app-label">About</div><p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-gray-700">{team.description || 'This team has not added a public description yet.'}</p></div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900"><div className="flex items-center gap-2 font-black"><ShieldCheck className="h-5 w-5" />Public-safe profile</div><p className="mt-1">This page shows team identity and general location only. Rosters, private schedules, contacts, and member data are not loaded.</p></div>
        </div>
      </section>
    </div>
  );
}
