import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Loader2, RefreshCw, Save } from 'lucide-react';
import { loadParentTeamDetail, updateTeamSettingsForApp } from '../lib/teamDetailService';
import { normalizeOptionalHttpUrl, parseTeamLivestreamInput } from '../lib/teamLinks';
import { useAsyncOperation } from '../lib/useAsyncOperation';
import type { AuthState } from '../lib/types';

export function TeamSettings({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoPreviewUrlRef = useRef('');
  const activeLoadIdRef = useRef(0);
  const { loading, error, run: runPrimaryLoad } = useAsyncOperation();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [nameError, setNameError] = useState('');
  const [leagueUrlError, setLeagueUrlError] = useState('');
  const [streamUrlError, setStreamUrlError] = useState('');
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [hasResolvedInitialLoad, setHasResolvedInitialLoad] = useState(false);
  const [teamName, setTeamName] = useState('Team');
  const [form, setForm] = useState({
    name: '',
    sport: '',
    zip: '',
    isPublic: true,
    photoUrl: '',
    leagueUrl: '',
    streamUrl: ''
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');

  useEffect(() => {
    photoPreviewUrlRef.current = photoPreviewUrl;
  }, [photoPreviewUrl]);

  const loadSettings = useCallback(async () => {
    if (!teamId) return null;

    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;

    return runPrimaryLoad(
      () => loadParentTeamDetail(teamId, auth.user, { includeDeferredData: false }),
      {
        errorMessage: 'Unable to load team settings.',
        rethrow: false,
        onSuccess: (model) => {
          if (loadId !== activeLoadIdRef.current) return;
          setCanManageTeam(model.canManageTeam);
          setTeamName(model.team.name || 'Team');
          setForm({
            name: model.team.name || '',
            sport: model.team.sport === 'Sport not set' ? '' : model.team.sport,
            zip: model.team.zip || '',
            isPublic: model.team.isPublic !== false,
            photoUrl: model.team.photoUrl || '',
            leagueUrl: model.team.leagueUrl || '',
            streamUrl: model.team.streamUrl || ''
          });
          setPhotoPreviewUrl(model.team.photoUrl || '');
        },
        onError: () => {
          if (loadId !== activeLoadIdRef.current) return;
          setCanManageTeam(false);
          setTeamName('Team');
          setForm({
            name: '',
            sport: '',
            zip: '',
            isPublic: true,
            photoUrl: '',
            leagueUrl: '',
            streamUrl: ''
          });
          setPhotoFile(null);
          setPhotoPreviewUrl('');
        },
        onFinally: () => {
          if (loadId !== activeLoadIdRef.current) return;
          setHasResolvedInitialLoad(true);
        }
      }
    );
  }, [auth.user, runPrimaryLoad, teamId]);

  useEffect(() => {
    setHasResolvedInitialLoad(false);
    void loadSettings();

    return () => {
      activeLoadIdRef.current += 1;
      if (photoPreviewUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(photoPreviewUrlRef.current);
      }
    };
  }, [loadSettings]);

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setPhotoFile(file);
    if (photoPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoPreviewUrl(file ? URL.createObjectURL(file) : form.photoUrl || '');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = form.name.trim();
    setNameError('');
    setLeagueUrlError('');
    setStreamUrlError('');
    setSaveError('');

    if (!trimmedName) {
      setNameError('Team name is required.');
      return;
    }

    const rawLeagueUrl = form.leagueUrl.trim();
    if (rawLeagueUrl && !normalizeOptionalHttpUrl(rawLeagueUrl)) {
      setLeagueUrlError('League link must be a valid http:// or https:// URL.');
      return;
    }

    const rawStreamUrl = form.streamUrl.trim();
    if (rawStreamUrl && !parseTeamLivestreamInput(rawStreamUrl)) {
      setStreamUrlError('Livestream link must be a valid YouTube or Twitch URL.');
      return;
    }

    setSaving(true);
    try {
      await updateTeamSettingsForApp(teamId, auth.user, {
        name: trimmedName,
        sport: form.sport,
        zip: form.zip,
        isPublic: form.isPublic,
        leagueUrl: rawLeagueUrl,
        streamUrl: rawStreamUrl,
        photoFile
      });
      navigate(`/teams/${encodeURIComponent(teamId)}`, { replace: true });
    } catch (saveFailure: any) {
      const message = saveFailure?.message || 'Unable to save team settings.';
      if (message === 'Team name is required.') {
        setNameError(message);
      } else if (message === 'League link must be a valid http:// or https:// URL.') {
        setLeagueUrlError(message);
      } else if (message === 'Livestream link must be a valid YouTube or Twitch URL.') {
        setStreamUrlError(message);
      } else {
        setSaveError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading || !hasResolvedInitialLoad) {
    return (
      <div className="app-card flex min-h-[240px] items-center justify-center p-5 text-center">
        <div className="flex items-center gap-3 text-sm font-semibold text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
          Loading team settings…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <section className="app-card p-4">
        <Link to={teamId ? `/teams/${encodeURIComponent(teamId)}` : '/teams'} className="ghost-button w-fit">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
        <div className="mt-4 text-lg font-black text-gray-950">Team settings unavailable</div>
        <div className="mt-2 text-sm font-semibold text-rose-700">{error}</div>
        <button type="button" className="primary-button mt-4" onClick={() => void loadSettings()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Retry
        </button>
      </section>
    );
  }

  if (!canManageTeam) {
    return (
      <section className="app-card p-4">
        <Link to={teamId ? `/teams/${encodeURIComponent(teamId)}` : '/teams'} className="ghost-button w-fit">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to team
        </Link>
        <h1 className="mt-4 text-2xl font-black text-gray-950">Team settings</h1>
        <p className="mt-2 text-sm font-semibold text-gray-600">Only team staff can edit this team.</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <Link to={`/teams/${encodeURIComponent(teamId)}`} className="ghost-button w-fit">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to team
      </Link>

      <section className="app-card p-4 sm:p-5">
        <div>
          <h1 className="text-2xl font-black text-gray-950">Edit team</h1>
          <p className="mt-2 text-sm font-semibold text-gray-600">Update the basics for {teamName} without leaving the app.</p>
        </div>

        <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
              {photoPreviewUrl ? <img src={photoPreviewUrl} alt="Team" className="h-full w-full object-cover" /> : <Camera className="h-8 w-8 text-gray-400" aria-hidden="true" />}
            </div>
            <div>
              <input ref={fileInputRef} className="hidden" type="file" accept="image/*" onChange={handlePhotoChange} />
              <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                <Camera className="h-4 w-4" aria-hidden="true" />
                {photoPreviewUrl ? 'Change photo' : 'Upload photo'}
              </button>
              <div className="mt-2 text-xs font-semibold text-gray-500">JPG, PNG, or HEIC from camera or library.</div>
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-black text-gray-950">Team name</span>
            <input
              value={form.name}
              onChange={(event) => {
                setForm((current) => ({ ...current, name: event.target.value }));
                if (nameError) setNameError('');
              }}
              className={`mt-1 w-full rounded-xl border px-3 py-3 text-sm font-semibold text-gray-950 shadow-sm outline-none ${nameError ? 'border-rose-400 bg-rose-50' : 'border-gray-200 bg-white focus:border-primary-500'}`}
              placeholder="Team name"
            />
            {nameError ? <span className="mt-1 block text-xs font-semibold text-rose-700">{nameError}</span> : null}
          </label>

          <label className="block">
            <span className="text-sm font-black text-gray-950">Sport</span>
            <input
              value={form.sport}
              onChange={(event) => setForm((current) => ({ ...current, sport: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-950 shadow-sm outline-none focus:border-primary-500"
              placeholder="Basketball"
            />
          </label>

          <label className="block">
            <span className="text-sm font-black text-gray-950">ZIP</span>
            <input
              value={form.zip}
              onChange={(event) => setForm((current) => ({ ...current, zip: event.target.value }))}
              inputMode="numeric"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-950 shadow-sm outline-none focus:border-primary-500"
              placeholder="66210"
            />
          </label>

          <label className="block">
            <span className="text-sm font-black text-gray-950">League link</span>
            <input
              value={form.leagueUrl}
              onChange={(event) => {
                setForm((current) => ({ ...current, leagueUrl: event.target.value }));
                if (leagueUrlError) setLeagueUrlError('');
              }}
              className={`mt-1 w-full rounded-xl border px-3 py-3 text-sm font-semibold text-gray-950 shadow-sm outline-none ${leagueUrlError ? 'border-rose-400 bg-rose-50' : 'border-gray-200 bg-white focus:border-primary-500'}`}
              placeholder="https://league.example.com/standings"
            />
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-gray-500">Shows up as the league page on the native team detail screen.</span>
              {form.leagueUrl.trim() ? <button type="button" className="text-xs font-black text-rose-700" onClick={() => {
                setForm((current) => ({ ...current, leagueUrl: '' }));
                setLeagueUrlError('');
              }}>Remove</button> : null}
            </div>
            {leagueUrlError ? <span className="mt-1 block text-xs font-semibold text-rose-700">{leagueUrlError}</span> : null}
          </label>

          <label className="block">
            <span className="text-sm font-black text-gray-950">Livestream link</span>
            <input
              value={form.streamUrl}
              onChange={(event) => {
                setForm((current) => ({ ...current, streamUrl: event.target.value }));
                if (streamUrlError) setStreamUrlError('');
              }}
              className={`mt-1 w-full rounded-xl border px-3 py-3 text-sm font-semibold text-gray-950 shadow-sm outline-none ${streamUrlError ? 'border-rose-400 bg-rose-50' : 'border-gray-200 bg-white focus:border-primary-500'}`}
              placeholder="https://youtu.be/... or https://twitch.tv/..."
            />
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-gray-500">Accepts YouTube watch, live, channel, embed, and Twitch channel links.</span>
              {form.streamUrl.trim() ? <button type="button" className="text-xs font-black text-rose-700" onClick={() => {
                setForm((current) => ({ ...current, streamUrl: '' }));
                setStreamUrlError('');
              }}>Remove</button> : null}
            </div>
            {streamUrlError ? <span className="mt-1 block text-xs font-semibold text-rose-700">{streamUrlError}</span> : null}
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <input
              type="checkbox"
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

          <button type="submit" className="primary-button w-full justify-center" disabled={saving} aria-disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            Save team
          </button>
        </form>
      </section>
    </div>
  );
}
