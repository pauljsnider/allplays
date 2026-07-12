import { FormEvent, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import {
  compensationOptions,
  emptyOpportunityInput,
  opportunityKinds,
  opportunityToInput,
  type ManagedOpportunityTeam,
  type OpportunityInput,
  type OpportunityKind
} from '../lib/opportunityLogic';
import {
  createPublicOpportunity,
  getPublicOpportunity,
  listManagedPublicOpportunityTeams,
  updatePublicOpportunity
} from '../lib/opportunityService';
import type { AuthState } from '../lib/types';

export function OpportunityForm({ auth }: { auth: AuthState }) {
  const { listingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(listingId);
  const requestedKind = opportunityKinds.some((entry) => entry.id === searchParams.get('kind')) ? searchParams.get('kind') as OpportunityKind : 'team_seeking_players';
  const [input, setInput] = useState<OpportunityInput>(() => emptyOpportunityInput(requestedKind));
  const [teams, setTeams] = useState<ManagedOpportunityTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      listManagedPublicOpportunityTeams(),
      editing ? getPublicOpportunity(listingId) : Promise.resolve(null)
    ]).then(([managedTeams, item]) => {
      if (!active) return;
      setTeams(managedTeams);
      if (item) setInput(opportunityToInput(item));
    }).catch((loadError: any) => {
      if (active) setError(loadError?.message || 'Unable to prepare the opportunity form.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [editing, listingId]);

  const set = <K extends keyof OpportunityInput>(key: K, value: OpportunityInput[K]) => setInput((current) => ({ ...current, [key]: value }));
  const chooseTeam = (teamId: string) => {
    const team = teams.find((entry) => entry.id === teamId);
    setInput((current) => ({
      ...current,
      teamId,
      sport: current.sport || team?.sport || '',
      city: current.city || team?.city || '',
      state: current.state || team?.state || '',
      zip: current.zip || team?.zip || ''
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const item = editing ? await updatePublicOpportunity(listingId, input) : await createPublicOpportunity(input);
      navigate(`/discover/opportunities/${encodeURIComponent(item.id)}`);
    } catch (saveError: any) {
      setError(saveError?.message || 'Unable to publish this opportunity.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="app-card p-8 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" /><div className="mt-2 text-sm font-black">Preparing form</div></div>;
  const isPlayerListing = input.kind === 'player_seeking_team';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div><Link to="/discover" className="text-sm font-black text-primary-700">← Back to Discover</Link></div>
      <form className="app-card overflow-hidden" onSubmit={submit}>
        <div className="border-b border-gray-100 p-5"><div className="app-label">Public opportunities</div><h1 className="mt-1 text-2xl font-black text-gray-950">{editing ? 'Edit opportunity' : 'Post an opportunity'}</h1><p className="mt-1 text-sm font-semibold text-gray-600">Listings publish immediately and expire after 30 days.</p></div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {error ? <div className="sm:col-span-2"><Status tone="error" message={error} /></div> : null}
          <Field label="Listing type"><select className="auth-input" value={input.kind} disabled={editing} onChange={(event) => setInput(emptyOpportunityInput(event.target.value as OpportunityKind))}>{opportunityKinds.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select></Field>
          {!isPlayerListing ? <Field label="Public team"><select className="auth-input" value={input.teamId} disabled={editing} onChange={(event) => chooseTeam(event.target.value)} required><option value="">Choose a team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>{!teams.length ? <span className="mt-1 block text-xs font-semibold text-amber-700">Only public teams you own or administer are eligible.</span> : null}</Field> : null}
          <Field label="Title" wide><input className="auth-input" value={input.title} onChange={(event) => set('title', event.target.value)} maxLength={100} required placeholder={isPlayerListing ? '12U basketball player looking for a team' : 'Assistant coach wanted'} /></Field>
          <Field label="Description" wide><textarea className="auth-input min-h-32" value={input.description} onChange={(event) => set('description', event.target.value)} maxLength={1500} required placeholder="Describe the opportunity without email, phone, exact addresses, school details, birth information, or a minor’s name." /></Field>
          <Field label="Sport"><input className="auth-input" value={input.sport} onChange={(event) => set('sport', event.target.value)} required /></Field>
          <Field label={isPlayerListing ? 'Positions or role' : 'Role / position'}><input className="auth-input" value={input.role} onChange={(event) => set('role', event.target.value)} /></Field>
          <Field label="Age group"><input className="auth-input" value={input.ageGroup} onChange={(event) => set('ageGroup', event.target.value)} required={isPlayerListing} placeholder="12U" /></Field>
          <Field label="Competitive level"><input className="auth-input" value={input.competitiveLevel} onChange={(event) => set('competitiveLevel', event.target.value)} placeholder="Recreational, travel, varsity" /></Field>
          <Field label="Division"><input className="auth-input" value={input.division} onChange={(event) => set('division', event.target.value)} /></Field>
          <Field label="Availability"><input className="auth-input" value={input.availability} onChange={(event) => set('availability', event.target.value)} placeholder="Weeknights and weekends" /></Field>
          <Field label="City"><input className="auth-input" value={input.city} onChange={(event) => set('city', event.target.value)} required /></Field>
          <Field label="State"><input className="auth-input" value={input.state} onChange={(event) => set('state', event.target.value)} required /></Field>
          <Field label="ZIP"><input className="auth-input" value={input.zip} onChange={(event) => set('zip', event.target.value)} inputMode="numeric" /></Field>
          <Field label="Start date"><input type="date" className="auth-input" value={input.startDate} onChange={(event) => set('startDate', event.target.value)} /></Field>
          <Field label="Compensation"><select className="auth-input" value={input.compensationType} onChange={(event) => set('compensationType', event.target.value as OpportunityInput['compensationType'])}>{compensationOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
          <Field label="Compensation summary"><input className="auth-input" value={input.compensationSummary} onChange={(event) => set('compensationSummary', event.target.value)} placeholder="Optional; do not add contact details" /></Field>
          {isPlayerListing ? <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4"><input type="checkbox" className="mt-1 h-4 w-4" checked={input.guardianAttested} onChange={(event) => set('guardianAttested', event.target.checked)} required /><span><span className="block text-sm font-black text-blue-950"><ShieldCheck className="mr-1 inline h-4 w-4" />Adult/guardian confirmation</span><span className="mt-1 block text-xs font-semibold leading-5 text-blue-900">I am at least 18 or the player’s legal guardian, and this listing contains no minor name, birth date, school, contact details, or exact address.</span></span></label> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 p-4"><Link to="/discover" className="ghost-button">Cancel</Link><button type="submit" className="primary-button" disabled={saving || (!isPlayerListing && !input.teamId) || !auth.user?.emailVerified}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{editing ? 'Save changes' : 'Publish for 30 days'}</button></div>
      </form>
      {!auth.user?.emailVerified ? <Status tone="error" message="Verify your email before publishing a public opportunity." /> : null}
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="app-label">{label}</span><span className="mt-1 block">{children}</span></label>;
}
