import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Shield, Trash2, Upload } from 'lucide-react';
import { DRILL_LEVELS, DRILL_TYPES } from '../../../../js/drill-constants.js';
import { openPublicUrl } from '../lib/publicActions';
import { deleteTeamDrillForApp, loadTeamDrillsManagementModel, saveTeamDrillForApp, type TeamDrillFormInput, type TeamDrillSummary, type TeamDrillsModel } from '../lib/teamDrillsService';
import type { AuthState } from '../lib/types';

const drillTypeOptions = DRILL_TYPES as string[];
const drillLevelOptions = DRILL_LEVELS as string[];

const emptyFormState: TeamDrillFormState = {
  id: '',
  title: '',
  type: 'Technical',
  level: 'All',
  skills: '',
  duration: '15',
  players: '',
  cones: '0',
  description: '',
  instructions: '',
  youtubeUrl: '',
  publishedToCommunity: false,
  existingDiagramUrls: [],
  diagramFiles: []
};

type TeamDrillFormState = TeamDrillFormInput & {
  existingDiagramUrls: string[];
  diagramFiles: File[];
};

export function TeamDrills({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const [model, setModel] = useState<TeamDrillsModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<TeamDrillFormState>(emptyFormState);
  const [editorOpen, setEditorOpen] = useState(false);

  const refresh = async ({ showLoading = model === null } = {}) => {
    if (!teamId) return;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const nextModel = await loadTeamDrillsManagementModel(teamId, auth.user);
      setModel(nextModel);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load team drills.');
      setModel(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, teamId]);

  const heading = useMemo(() => model?.team.name ? `${model.team.name} drills` : 'Team drills', [model?.team.name]);

  if (!teamId) return <Navigate to="/teams" replace />;

  const openCreateForm = () => {
    setDraft(emptyFormState);
    setEditorOpen(true);
    setError('');
    setMessage('');
  };

  const openEditForm = (drill: TeamDrillSummary) => {
    setDraft({
      id: drill.id,
      title: drill.title,
      type: drill.type,
      level: drill.level,
      skills: drill.skills.join(', '),
      duration: String(drill.setup.duration),
      players: drill.setup.players,
      cones: String(drill.setup.cones),
      description: drill.description,
      instructions: drill.instructions,
      youtubeUrl: drill.youtubeUrl,
      publishedToCommunity: drill.publishedToCommunity,
      existingDiagramUrls: [...drill.diagramUrls],
      diagramFiles: []
    });
    setEditorOpen(true);
    setError('');
    setMessage('');
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setDraft(emptyFormState);
  };

  const updateDraft = (patch: Partial<TeamDrillFormState>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const handleDiagramSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files || []);
    const allowedFiles = nextFiles.slice(0, Math.max(0, 5 - draft.existingDiagramUrls.length));
    updateDraft({ diagramFiles: allowedFiles });
    if (nextFiles.length > allowedFiles.length) {
      setError(`Only ${allowedFiles.length} new diagram${allowedFiles.length === 1 ? '' : 's'} fit before the 5-image cap.`);
    }
  };

  const removeExistingDiagram = (index: number) => {
    updateDraft({ existingDiagramUrls: draft.existingDiagramUrls.filter((_, currentIndex) => currentIndex !== index) });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!model) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const title = draft.id ? draft.title.trim() : draft.title.trim() || 'New drill';
      await saveTeamDrillForApp(teamId, auth.user, model.team.sport, draft);
      await refresh({ showLoading: false });
      setEditorOpen(false);
      setDraft(emptyFormState);
      setMessage(draft.id ? `${title} updated.` : `${title} created.`);
    } catch (saveError: any) {
      setError(saveError?.message || 'Unable to save the drill.');
    } finally {
      setSaving(false);
    }
  };

  const deleteDrill = async (drill: TeamDrillSummary) => {
    if (!window.confirm(`Delete ${drill.title}? This matches the website behavior and existing saved practice timelines keep their denormalized copy.`)) return;
    setDeletingId(drill.id);
    setError('');
    setMessage('');
    try {
      await deleteTeamDrillForApp(teamId, auth.user, drill.id);
      await refresh({ showLoading: false });
      setMessage(`${drill.title} deleted.`);
    } catch (deleteError: any) {
      setError(deleteError?.message || 'Unable to delete the drill.');
    } finally {
      setDeletingId('');
    }
  };

  if (loading) {
    return (
      <section className="app-card p-5 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-950">Loading team drills</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Getting custom drills from the shared drill library.</div>
      </section>
    );
  }

  if (error && !model) {
    return <StatusCard title="Team drills unavailable" message={error} backTo={`/teams/${encodeURIComponent(teamId)}`} />;
  }

  if (!model?.canManageDrills) {
    return <StatusCard title="Coach/admin access required" message="Only team owners, team admins, and global admins can create, edit, or delete team drills." backTo={`/teams/${encodeURIComponent(teamId)}`} />;
  }

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link to={`/teams/${encodeURIComponent(teamId)}`} className="ghost-button !min-h-8 px-0 text-xs text-primary-700">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back to team
            </Link>
            <h1 className="mt-2 text-2xl font-black text-gray-950">{heading}</h1>
            <p className="mt-1 text-sm font-semibold text-gray-600">Create, edit, and delete team-scoped drills in the same shared collection the website practice command center uses.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="secondary-button !min-h-9 text-xs" onClick={() => refresh({ showLoading: false })}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
            <button type="button" className="primary-button !min-h-9 text-xs" onClick={openCreateForm}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New drill
            </button>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50 p-3 text-xs font-semibold text-primary-800">
          Team drills saved here appear in the website practice command center automatically, and web-created team drills show up here after refresh.
        </div>
        {message ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-black text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-black text-rose-700">{error}</div> : null}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {model.drills.length ? model.drills.map((drill) => (
          <article key={drill.id} className="app-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-black text-gray-950">{drill.title}</h2>
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-primary-700">Team drill</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-700">{drill.type}</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-gray-500">{drill.level} · {drill.setup.duration} min · {drill.setup.players || 'Players TBD'} · {drill.setup.cones} cones</div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="secondary-button !min-h-8 text-xs" onClick={() => openEditForm(drill)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </button>
                <button type="button" className="secondary-button !min-h-8 !border-rose-200 !bg-rose-50 !text-rose-700 text-xs" onClick={() => void deleteDrill(drill)} disabled={deletingId === drill.id}>
                  {deletingId === drill.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  Delete
                </button>
              </div>
            </div>
            {drill.skills.length ? <div className="mt-3 flex flex-wrap gap-1.5">{drill.skills.map((skill) => <span key={skill} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-gray-700 ring-1 ring-gray-200">{skill}</span>)}</div> : null}
            {drill.description ? <p className="mt-3 text-sm font-semibold leading-6 text-gray-600">{drill.description}</p> : null}
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-gray-500">
              {drill.diagramUrls.length ? <span>{drill.diagramUrls.length} diagram{drill.diagramUrls.length === 1 ? '' : 's'}</span> : null}
              {drill.youtubeUrl ? (
                <button type="button" className="inline-flex items-center gap-1 font-black text-primary-700" onClick={() => openPublicUrl(drill.youtubeUrl)}>
                  Video link
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              {drill.publishedToCommunity ? <span>Published to community</span> : null}
            </div>
          </article>
        )) : (
          <section className="app-card p-5 text-sm font-semibold text-gray-500 lg:col-span-2">
            No custom team drills yet. Create one here and it will appear in the website practice command center.
          </section>
        )}
      </section>

      {editorOpen ? (
        <section className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/60 p-3 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.06em] text-primary-700">{draft.id ? 'Edit drill' : 'New drill'}</div>
                <h2 className="mt-1 text-xl font-black text-gray-950">{draft.id ? draft.title || 'Edit team drill' : 'Create team drill'}</h2>
              </div>
              <button type="button" className="secondary-button !min-h-8 text-xs" onClick={closeEditor} disabled={saving}>Close</button>
            </div>
            <form className="mt-4 space-y-4" onSubmit={submit}>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Title</span>
                <input aria-label="Title" required value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Type</span>
                  <select aria-label="Type" value={draft.type} onChange={(event) => updateDraft({ type: event.target.value })} className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100">
                    {drillTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Level</span>
                  <select aria-label="Level" value={draft.level} onChange={(event) => updateDraft({ level: event.target.value })} className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100">
                    {drillLevelOptions.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Skills</span>
                <input aria-label="Skills" value={draft.skills} onChange={(event) => updateDraft({ skills: event.target.value })} placeholder="passing, shooting, dribbling" className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Duration</span>
                  <input aria-label="Duration" type="number" min="1" max="120" value={draft.duration} onChange={(event) => updateDraft({ duration: event.target.value })} className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Players</span>
                  <input aria-label="Players" value={draft.players} onChange={(event) => updateDraft({ players: event.target.value })} placeholder="8-16" className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Cones</span>
                  <input aria-label="Cones" type="number" min="0" value={draft.cones} onChange={(event) => updateDraft({ cones: event.target.value })} className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Description</span>
                <textarea aria-label="Description" rows={3} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Instructions</span>
                <textarea aria-label="Instructions" rows={6} value={draft.instructions} onChange={(event) => updateDraft({ instructions: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Video link</span>
                <input aria-label="Video link" type="url" value={draft.youtubeUrl} onChange={(event) => updateDraft({ youtubeUrl: event.target.value })} placeholder="https://youtube.com/watch?v=..." className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
              </label>
              <div className="space-y-2 rounded-2xl border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Diagrams</div>
                    <div className="mt-1 text-xs font-semibold text-gray-500">Uploads use the same legacy drill image path builder as the website editor.</div>
                  </div>
                  <label className="secondary-button !min-h-8 cursor-pointer text-xs">
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Add images
                    <input aria-label="Add images" type="file" accept="image/*" multiple className="hidden" onChange={handleDiagramSelection} />
                  </label>
                </div>
                {draft.existingDiagramUrls.length ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {draft.existingDiagramUrls.map((url, index) => (
                      <div key={`${url}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-2">
                        <img src={url} alt={`Existing diagram ${index + 1}`} className="h-24 w-full rounded-lg object-cover" />
                        <button type="button" className="ghost-button mt-2 !min-h-8 px-0 text-xs text-rose-700" onClick={() => removeExistingDiagram(index)} disabled={saving}>Remove</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {draft.diagramFiles.length ? <div className="text-xs font-semibold text-gray-600">{draft.diagramFiles.length} new file{draft.diagramFiles.length === 1 ? '' : 's'} selected.</div> : null}
              </div>
              <label className="flex items-start gap-3 rounded-2xl border border-primary-100 bg-primary-50 p-3">
                <input aria-label="Publish to community" type="checkbox" checked={draft.publishedToCommunity} onChange={(event) => updateDraft({ publishedToCommunity: event.target.checked })} className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span>
                  <span className="block text-sm font-black text-gray-950">Publish to community</span>
                  <span className="mt-1 block text-xs font-semibold leading-5 text-gray-600">Matches the legacy editor flag for shared team-published drills.</span>
                </span>
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="secondary-button !min-h-9 text-xs" onClick={closeEditor} disabled={saving}>Cancel</button>
                <button type="submit" className="primary-button !min-h-9 text-xs" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {draft.id ? 'Save drill' : 'Create drill'}
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatusCard({ title, message, backTo }: { title: string; message: string; backTo: string }) {
  return (
    <section className="app-card p-5">
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 h-5 w-5 flex-none text-rose-600" aria-hidden="true" />
        <div>
          <div className="text-sm font-black text-gray-950">{title}</div>
          <div className="mt-1 text-sm font-semibold text-gray-600">{message}</div>
          <Link to={backTo} className="secondary-button mt-3 !min-h-9 text-xs">Back</Link>
        </div>
      </div>
    </section>
  );
}
