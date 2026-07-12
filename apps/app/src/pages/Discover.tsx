import { FormEvent, useEffect, useState } from 'react';
import { BriefcaseBusiness, Loader2, Plus, Search, ShieldCheck, Users } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { OpportunityCard } from '../components/OpportunityCard';
import { PublicTeamSearch } from '../components/PublicTeamSearch';
import { Status } from '../components/TeamSummaryPrimitives';
import {
  compensationOptions,
  opportunityKinds,
  type CompensationType,
  type OpportunityFilters,
  type OpportunityKind,
  type PublicOpportunity
} from '../lib/opportunityLogic';
import { listPublicOpportunities } from '../lib/opportunityService';
import type { AuthState } from '../lib/types';

export function Discover({ auth, initialTab }: { auth: AuthState; initialTab?: 'opportunities' | 'teams' }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = initialTab || (searchParams.get('tab') === 'teams' ? 'teams' : 'opportunities');
  const [filters, setFilters] = useState<OpportunityFilters>({});
  const [submittedFilters, setSubmittedFilters] = useState<OpportunityFilters>({});
  const [items, setItems] = useState<PublicOpportunity[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(tab === 'opportunities');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextFilters: OpportunityFilters, cursor: string | null = null, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    try {
      const result = await listPublicOpportunities(nextFilters, cursor);
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load public opportunities.');
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (tab === 'opportunities') void load(submittedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, submittedFilters]);

  const selectTab = (nextTab: 'opportunities' | 'teams') => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    setSearchParams(next);
  };

  const submitFilters = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedFilters({ ...filters });
  };

  return (
    <div className="space-y-4">
      <section className="app-card overflow-hidden">
        <div className="bg-gradient-to-br from-primary-700 via-primary-600 to-indigo-700 p-5 text-white sm:p-7">
          <div className="text-xs font-black uppercase tracking-[0.08em] text-primary-100">Discover ALL PLAYS</div>
          <h1 className="mt-2 text-2xl font-black sm:text-4xl">Find a team or your next sports opportunity</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-primary-50">Browse public team openings, coaching and staff jobs, officials and volunteer roles, and guardian-safe player listings.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {auth.user ? <Link to="/discover/new" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-primary-700"><Plus className="h-4 w-4" aria-hidden="true" />Post an opportunity</Link> : <Link to="/auth?next=%2Fdiscover%2Fnew" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-primary-700">Sign in to post</Link>}
            {auth.user ? <Link to="/discover/manage" className="inline-flex min-h-10 items-center rounded-xl bg-primary-950/25 px-4 text-sm font-black text-white ring-1 ring-white/25">Manage listings &amp; inquiries</Link> : null}
          </div>
        </div>
        {!initialTab ? <div className="grid grid-cols-2 border-t border-gray-100 p-1.5">
          <button type="button" className={`min-h-11 rounded-xl text-sm font-black ${tab === 'opportunities' ? 'bg-primary-50 text-primary-700' : 'text-gray-600'}`} onClick={() => selectTab('opportunities')}><BriefcaseBusiness className="mr-2 inline h-4 w-4" aria-hidden="true" />Opportunities</button>
          <button type="button" className={`min-h-11 rounded-xl text-sm font-black ${tab === 'teams' ? 'bg-primary-50 text-primary-700' : 'text-gray-600'}`} onClick={() => selectTab('teams')}><Users className="mr-2 inline h-4 w-4" aria-hidden="true" />Teams</button>
        </div> : null}
      </section>

      {tab === 'teams' ? <PublicTeamSearch autoBrowseOnMount /> : (
        <>
          <form className="app-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" onSubmit={submitFilters}>
            <FilterSelect label="Category" value={filters.kind || ''} onChange={(value) => setFilters((current) => ({ ...current, kind: value as OpportunityKind | '' }))} options={[{ id: '', label: 'All categories' }, ...opportunityKinds]} />
            <FilterInput label="Sport" value={filters.sport || ''} onChange={(value) => setFilters((current) => ({ ...current, sport: value }))} placeholder="Basketball" />
            <FilterInput label="Age group" value={filters.ageGroup || ''} onChange={(value) => setFilters((current) => ({ ...current, ageGroup: value }))} placeholder="12U" />
            <FilterSelect label="Compensation" value={filters.compensationType || ''} onChange={(value) => setFilters((current) => ({ ...current, compensationType: value as CompensationType | '' }))} options={[{ id: '', label: 'Any' }, ...compensationOptions]} />
            <FilterInput label="Location" value={filters.location || ''} onChange={(value) => setFilters((current) => ({ ...current, location: value }))} placeholder="City, state, or ZIP" />
            <div className="flex items-end"><button type="submit" className="primary-button w-full justify-center !min-h-11"><Search className="h-4 w-4" aria-hidden="true" />Search</button></div>
          </form>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-900"><ShieldCheck className="mr-1 inline h-4 w-4" aria-hidden="true" />Listings are community posts, not ALL PLAYS employment verification, background-check approval, or endorsement. Keep communication in the private inquiry thread.</div>
          {error ? <Status tone="error" message={error} /> : null}
          {loading ? <div className="app-card p-8 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" /><div className="mt-2 text-sm font-black text-gray-700">Loading opportunities</div></div> : items.length ? (
            <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => <OpportunityCard key={item.id} item={item} />)}</div>
          ) : <div className="app-card p-8 text-center"><BriefcaseBusiness className="mx-auto h-8 w-8 text-gray-300" /><div className="mt-3 text-sm font-black text-gray-900">No active opportunities found</div><div className="mt-1 text-xs font-semibold text-gray-500">Try broader filters or post a new opportunity.</div></div>}
          {nextCursor ? <button type="button" className="ghost-button mx-auto !min-h-10 !px-4" onClick={() => void load(submittedFilters, nextCursor, true)} disabled={loadingMore}>{loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Load more</button> : null}
        </>
      )}
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="block"><span className="app-label">{label}</span><input className="auth-input mt-1 !min-h-11" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ id: string; label: string }> }) {
  return <label className="block"><span className="app-label">{label}</span><select className="auth-input mt-1 !min-h-11" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
}
