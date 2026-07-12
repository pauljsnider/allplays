import { BriefcaseBusiness, CalendarClock, MapPin, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  formatOpportunityDate,
  formatOpportunityLocation,
  getOpportunityKindLabel,
  type PublicOpportunity
} from '../lib/opportunityLogic';

export function OpportunityCard({ item }: { item: PublicOpportunity }) {
  const location = formatOpportunityLocation(item);
  return (
    <article className="app-card overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">
          {item.kind === 'player_seeking_team' ? <UsersRound className="h-5 w-5" aria-hidden="true" /> : <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-primary-700">{getOpportunityKindLabel(item.kind)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${item.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{item.status}</span>
            {item.compensationType !== 'not_applicable' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-amber-700">{item.compensationType.replace('_', ' ')}</span> : null}
          </div>
          <h2 className="mt-2 text-base font-black leading-5 text-gray-950">{item.title}</h2>
          <p className="mt-1 line-clamp-3 text-sm font-semibold leading-5 text-gray-600">{item.description}</p>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-gray-500">
            <span>{item.sport}</span>
            {item.ageGroup ? <span>{item.ageGroup}</span> : null}
            {location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{location}</span> : null}
            {item.expiresAt ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />Ends {formatOpportunityDate(item.expiresAt)}</span> : null}
          </div>
          {item.teamName ? <div className="mt-2 text-xs font-black text-gray-700">Posted for {item.teamName}</div> : null}
        </div>
      </div>
      <Link to={`/discover/opportunities/${encodeURIComponent(item.id)}`} className="primary-button mt-4 w-full justify-center !min-h-10 !px-4 text-sm">
        View opportunity
      </Link>
    </article>
  );
}
