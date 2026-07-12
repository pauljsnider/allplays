import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, Save, Shield, Users } from 'lucide-react';
import { createTeamForApp, getCreateTeamSportOptions } from '../lib/teamCreationService';
import type { AuthState } from '../lib/types';

export function CreateTeam({ auth }: { auth: AuthState }) {
  const navigate = useNavigate();
  const sportOptions = useMemo(() => getCreateTeamSportOptions(), []);
  const [form, setForm] = useState({
    name: '',
    sport: sportOptions[0] || 'Basketball',
    zip: '',
    isPublic: true
  });
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [sportError, setSportError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [statConfigWarning, setStatConfigWarning] = useState('');
  const [createdTeamId, setCreatedTeamId] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameError('');
    setSportError('');
    setSaveError('');
    setStatConfigWarning('');
    setCreatedTeamId('');

    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setNameError('Team name is required.');
      return;
    }

    const trimmedSport = form.sport.trim();
    if (!trimmedSport) {
      setSportError('Sport is required.');
      return;
    }

    setSaving(true);
    try {
      const result = await createTeamForApp(auth.user, {
        name: trimmedName,
        sport: trimmedSport,
        zip: form.zip,
        isPublic: form.isPublic
      });
      if (result.defaultStatConfigError) {
        setCreatedTeamId(result.teamId);
        setStatConfigWarning(`Team created, but the default stat config could not be added: ${result.defaultStatConfigError}`);
        return;
      }
      navigate(`/teams/${encodeURIComponent(result.teamId)}`, { replace: true });
    } catch (failure: any) {
      const message = failure?.message || 'Unable to create team.';
      if (message === 'Team name is required.') {
        setNameError(message);
      } else if (message === 'Sport is required.') {
        setSportError(message);
      } else {
        setSaveError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!auth.user?.uid) {
    return (
      <section className="app-card p-5">
        <Link to="/teams" className="ghost-button w-fit">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to teams
        </Link>
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <Shield className="mt-0.5 h-5 w-5 flex-none text-amber-700" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-black text-amber-950">Sign in to create a team</h1>
            <p className="mt-1 text-sm font-semibold text-amber-800">Team ownership is tied to the signed-in coach account.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <Link to="/teams" className="ghost-button w-fit">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to teams
      </Link>

      <section className="app-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="app-label">My Teams</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950">Create team</h1>
            <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">Start a team with owner access and a sport stat template.</p>
          </div>
        </div>

        <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <label className="block">
            <span className="text-sm font-black text-gray-950">Team name</span>
            <input
              value={form.name}
              onChange={(event) => {
                setForm((current) => ({ ...current, name: event.target.value }));
                if (nameError) setNameError('');
              }}
              className={`auth-input mt-1 ${nameError ? '!border-rose-400 !bg-rose-50' : ''}`}
              placeholder="Team name"
              autoFocus
            />
            {nameError ? <span className="mt-1 block text-xs font-semibold text-rose-700">{nameError}</span> : null}
          </label>

          <label className="block">
            <span className="text-sm font-black text-gray-950">Sport</span>
            <select
              value={form.sport}
              onChange={(event) => {
                setForm((current) => ({ ...current, sport: event.target.value }));
                if (sportError) setSportError('');
              }}
              className={`auth-input mt-1 ${sportError ? '!border-rose-400 !bg-rose-50' : ''}`}
            >
              {sportOptions.map((sport) => <option key={sport} value={sport}>{sport}</option>)}
            </select>
            {sportError ? <span className="mt-1 block text-xs font-semibold text-rose-700">{sportError}</span> : null}
          </label>

          <label className="block">
            <span className="text-sm font-black text-gray-950">ZIP</span>
            <input
              value={form.zip}
              onChange={(event) => setForm((current) => ({ ...current, zip: event.target.value }))}
              inputMode="numeric"
              className="auth-input mt-1"
              placeholder="66210"
            />
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <input
              type="checkbox"
              aria-label="Public team"
              checked={form.isPublic}
              onChange={(event) => setForm((current) => ({ ...current, isPublic: event.target.checked }))}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600"
            />
            <span>
              <span className="block text-sm font-black text-gray-950">Public team</span>
              <span className="mt-1 block text-xs font-semibold leading-5 text-gray-500">If unchecked, the team is hidden from Browse Teams but still works by direct link.</span>
            </span>
          </label>

          {saveError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{saveError}</div> : null}
          {statConfigWarning ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              <div>{statConfigWarning}</div>
              {createdTeamId ? <Link to={`/teams/${encodeURIComponent(createdTeamId)}`} className="mt-2 inline-flex font-black text-amber-950">Open team</Link> : null}
            </div>
          ) : null}

          <button type="submit" className="primary-button w-full justify-center" disabled={saving} aria-disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            Create team
          </button>
        </form>
      </section>

      <section className="app-card p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-primary-700" aria-hidden="true" />
          <div>
            <div className="text-sm font-black text-gray-950">Creator access</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">The team is created under {auth.user.email || 'this account'} with coach access.</div>
          </div>
        </div>
      </section>
    </div>
  );
}
