import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import {
  applyOpportunityTeamDefaults,
  compensationOptions,
  emptyOpportunityInput,
  getMissingOpportunityRequiredFields,
  getOpportunityRequiredFields,
  opportunityAvailabilityOptions,
  opportunityKinds,
  opportunityToInput,
  switchOpportunityTeamDefaults,
  type ManagedOpportunityTeam,
  type OpportunityInput,
  type OpportunityKind
} from '../lib/opportunityLogic';
import { applyOpportunityAiSuggestion, enhanceOpportunityDraft } from '../lib/opportunityAiService';
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
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const inputVersionRef = useRef(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      listManagedPublicOpportunityTeams(),
      editing ? getPublicOpportunity(listingId) : Promise.resolve(null)
    ]).then(([managedTeams, item]) => {
      if (!active) return;
      setTeams(managedTeams);
      if (item) {
        setInput(opportunityToInput(item));
      } else if (managedTeams.length && requestedKind !== 'player_seeking_team') {
        setInput((current) => applyOpportunityTeamDefaults(current, managedTeams[0]));
      }
    }).catch((loadError: any) => {
      if (active) setError(loadError?.message || 'Unable to prepare the opportunity form.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [editing, listingId, requestedKind]);

  const isPlayerListing = input.kind === 'player_seeking_team';
  const requiredFields = useMemo(() => getOpportunityRequiredFields(input), [input]);
  const missingFields = useMemo(() => getMissingOpportunityRequiredFields(input), [input]);
  const missingFieldKeys = useMemo(() => new Set(missingFields.map((field) => field.key)), [missingFields]);
  const selectedTeam = teams.find((team) => team.id === input.teamId) || null;
  const completedRequiredCount = requiredFields.length - missingFields.length;

  const set = <K extends keyof OpportunityInput>(key: K, value: OpportunityInput[K]) => {
    inputVersionRef.current += 1;
    setStatus('');
    setInput((current) => ({ ...current, [key]: value }));
  };

  const chooseTeam = (teamId: string) => {
    const team = teams.find((entry) => entry.id === teamId);
    inputVersionRef.current += 1;
    setStatus('');
    setInput((current) => switchOpportunityTeamDefaults(
      current,
      teams.find((entry) => entry.id === current.teamId),
      team
    ));
  };

  const chooseKind = (kind: OpportunityKind) => {
    const fresh = emptyOpportunityInput(kind);
    inputVersionRef.current += 1;
    setStatus('');
    setError('');
    setInput(kind === 'player_seeking_team' ? fresh : applyOpportunityTeamDefaults(fresh, teams[0]));
  };

  const focusFirstMissingField = (fields = getMissingOpportunityRequiredFields(input)) => {
    const first = fields[0];
    if (!first) return;
    window.requestAnimationFrame(() => document.getElementById(getOpportunityFieldId(first.key))?.focus());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const missing = getMissingOpportunityRequiredFields(input);
    if (missing.length) {
      setError(`Complete ${missing.map((field) => field.label).join(', ')} before publishing.`);
      focusFirstMissingField(missing);
      return;
    }
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const item = editing ? await updatePublicOpportunity(listingId, input) : await createPublicOpportunity(input);
      navigate(`/discover/opportunities/${encodeURIComponent(item.id)}`);
    } catch (saveError: any) {
      setError(saveError?.message || 'Unable to publish this opportunity.');
    } finally {
      setSaving(false);
    }
  };

  const enhanceWithAi = async () => {
    setEnhancing(true);
    setError('');
    setStatus('');
    const original = input;
    const originalVersion = inputVersionRef.current;
    try {
      const suggestion = await enhanceOpportunityDraft(original, selectedTeam);
      if (inputVersionRef.current !== originalVersion) return;
      setInput((current) => current === original ? applyOpportunityAiSuggestion(current, suggestion) : current);
      setStatus('AI suggestions applied. Review every field before publishing.');
    } catch (enhanceError: any) {
      setError(enhanceError?.message || 'AI could not enhance this draft. Your form was not changed.');
    } finally {
      setEnhancing(false);
    }
  };

  if (loading) return <div className="app-card p-8 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" /><div className="mt-2 text-sm font-black">Preparing form</div></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div><Link to="/discover" className="text-sm font-black text-primary-700">← Back to Discover</Link></div>
      <form className="app-card overflow-hidden" onSubmit={submit} noValidate>
        <div className="border-b border-gray-100 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="app-label">Public opportunities</div>
              <h1 className="mt-1 text-2xl font-black text-gray-950">{editing ? 'Edit opportunity' : 'Post an opportunity'}</h1>
              <p className="mt-1 text-sm font-semibold text-gray-600">Listings publish immediately and expire after 30 days.</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => void enhanceWithAi()} disabled={enhancing || (!isPlayerListing && !input.teamId)}>
              {enhancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {enhancing ? 'Enhancing…' : 'Enhance with AI'}
            </button>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {error ? <div className="sm:col-span-2"><Status tone="error" message={error} /></div> : null}
          {status ? <div className="sm:col-span-2"><Status tone="success" message={status} /></div> : null}

          <section className="sm:col-span-2 rounded-xl border border-primary-100 bg-primary-50 p-4" aria-labelledby="opportunity-required-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="opportunity-required-title" className="text-sm font-black text-primary-950">Required fields</h2>
                <p className="mt-1 text-xs font-semibold text-primary-800">Fields marked <span aria-hidden="true">*</span><span className="sr-only">required</span> must be completed before publishing.</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-primary-800" role="status" aria-live="polite">{completedRequiredCount} of {requiredFields.length} complete</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {requiredFields.map((field) => {
                const missing = missingFieldKeys.has(field.key);
                return <span key={field.key} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${missing ? 'bg-white text-gray-600' : 'bg-emerald-100 text-emerald-800'}`}>{missing ? <Circle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{field.label}</span>;
              })}
            </div>
          </section>

          <Field label="Listing type"><select id={getOpportunityFieldId('kind')} className="auth-input" value={input.kind} disabled={editing} onChange={(event) => chooseKind(event.target.value as OpportunityKind)}>{opportunityKinds.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select></Field>
          {!isPlayerListing ? <Field label="Public team" required><select id={getOpportunityFieldId('teamId')} className="auth-input" value={input.teamId} disabled={editing} onChange={(event) => chooseTeam(event.target.value)} required aria-invalid={missingFieldKeys.has('teamId')}><option value="">Choose a team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>{!teams.length ? <span className="mt-1 block text-xs font-semibold text-amber-700">Only public teams you own or administer are eligible.</span> : <span className="mt-1 block text-xs font-semibold text-gray-500">Team sport and location details are filled automatically.</span>}</Field> : null}
          <Field label="Title" wide required><input id={getOpportunityFieldId('title')} className="auth-input" value={input.title} onChange={(event) => set('title', event.target.value)} maxLength={100} required aria-invalid={missingFieldKeys.has('title')} placeholder={isPlayerListing ? '12U basketball player looking for a team' : 'Assistant coach wanted'} /></Field>
          <Field label="Description" wide required><textarea id={getOpportunityFieldId('description')} className="auth-input min-h-32" value={input.description} onChange={(event) => set('description', event.target.value)} maxLength={1500} required aria-invalid={missingFieldKeys.has('description')} placeholder="Describe the opportunity without email, phone, exact addresses, school details, birth information, or a minor’s name." /></Field>
          <Field label="Sport" required><input id={getOpportunityFieldId('sport')} className="auth-input" value={input.sport} onChange={(event) => set('sport', event.target.value)} required aria-invalid={missingFieldKeys.has('sport')} /></Field>
          <Field label={isPlayerListing ? 'Positions or role' : 'Role / position'}><input id={getOpportunityFieldId('role')} className="auth-input" value={input.role} onChange={(event) => set('role', event.target.value)} /></Field>
          <Field label="Age group" required={isPlayerListing}><input id={getOpportunityFieldId('ageGroup')} className="auth-input" value={input.ageGroup} onChange={(event) => set('ageGroup', event.target.value)} required={isPlayerListing} aria-invalid={missingFieldKeys.has('ageGroup')} placeholder="12U" /></Field>
          <Field label="Competitive level"><input id={getOpportunityFieldId('competitiveLevel')} className="auth-input" value={input.competitiveLevel} onChange={(event) => set('competitiveLevel', event.target.value)} placeholder="Recreational, travel, varsity" /></Field>
          <Field label="Division"><input id={getOpportunityFieldId('division')} className="auth-input" value={input.division} onChange={(event) => set('division', event.target.value)} /></Field>
          <Field label="Availability" required><select id={getOpportunityFieldId('availability')} className="auth-input" value={input.availability} onChange={(event) => set('availability', event.target.value)} required aria-invalid={missingFieldKeys.has('availability')}>{input.availability && !opportunityAvailabilityOptions.includes(input.availability as typeof opportunityAvailabilityOptions[number]) ? <option value={input.availability}>{input.availability}</option> : null}{opportunityAvailabilityOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>
          <Field label="City" required><input id={getOpportunityFieldId('city')} className="auth-input" value={input.city} onChange={(event) => set('city', event.target.value)} required aria-invalid={missingFieldKeys.has('city')} /></Field>
          <Field label="State" required><input id={getOpportunityFieldId('state')} className="auth-input" value={input.state} onChange={(event) => set('state', event.target.value)} required aria-invalid={missingFieldKeys.has('state')} /></Field>
          <Field label="ZIP"><input id={getOpportunityFieldId('zip')} className="auth-input" value={input.zip} onChange={(event) => set('zip', event.target.value)} inputMode="numeric" /></Field>
          <Field label="Start date"><input id={getOpportunityFieldId('startDate')} type="date" className="auth-input" value={input.startDate} onChange={(event) => set('startDate', event.target.value)} /></Field>
          <Field label="Compensation"><select id={getOpportunityFieldId('compensationType')} className="auth-input" value={input.compensationType} onChange={(event) => set('compensationType', event.target.value as OpportunityInput['compensationType'])}>{compensationOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
          <Field label="Compensation summary"><input id={getOpportunityFieldId('compensationSummary')} className="auth-input" value={input.compensationSummary} onChange={(event) => set('compensationSummary', event.target.value)} placeholder="Optional; do not add contact details" /></Field>
          {isPlayerListing ? <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4"><input id={getOpportunityFieldId('guardianAttested')} type="checkbox" className="mt-1 h-4 w-4" checked={input.guardianAttested} onChange={(event) => set('guardianAttested', event.target.checked)} required aria-invalid={missingFieldKeys.has('guardianAttested')} /><span><span className="block text-sm font-black text-blue-950"><ShieldCheck className="mr-1 inline h-4 w-4" />Adult/guardian confirmation <span className="text-rose-600" aria-hidden="true">*</span><span className="sr-only"> required</span></span><span className="mt-1 block text-xs font-semibold leading-5 text-blue-900">I am at least 18 or the player’s legal guardian, and this listing contains no minor name, birth date, school, contact details, or exact address.</span></span></label> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 p-4"><Link to="/discover" className="ghost-button">Cancel</Link><button type="submit" className="primary-button" disabled={saving || !auth.user?.emailVerified}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{editing ? 'Save changes' : 'Publish for 30 days'}</button></div>
      </form>
      {!auth.user?.emailVerified ? <Status tone="error" message="Verify your email before publishing a public opportunity." /> : null}
    </div>
  );
}

function getOpportunityFieldId(key: keyof OpportunityInput) {
  return `opportunity-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function Field({ label, children, wide = false, required = false }: { label: string; children: React.ReactNode; wide?: boolean; required?: boolean }) {
  return <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="app-label">{label}{required ? <><span className="ml-1 text-rose-600" aria-hidden="true">*</span><span className="sr-only"> required</span></> : null}</span><span className="mt-1 block">{children}</span></label>;
}
