import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  File,
  ImageIcon,
  LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Upload,
  Video
} from 'lucide-react';
import { openPublicUrl } from '../lib/publicActions';
import {
  addParentTeamMediaLink,
  loadTeamMediaForApp,
  uploadParentTeamMediaFile,
  uploadParentTeamMediaPhoto,
  type TeamMediaFolder,
  type TeamMediaItem,
  type TeamMediaModel
} from '../lib/parentToolsService';
import type { AuthState } from '../lib/types';

export function TeamMedia({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [model, setModel] = useState<TeamMediaModel | null>(null);
  const [activeFolderId, setActiveFolderId] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async ({ showLoading = model === null }: { showLoading?: boolean } = {}) => {
    if (!teamId) return;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const nextModel = await loadTeamMediaForApp(auth.user, teamId);
      setModel(nextModel);
      setActiveFolderId((current) => {
        if (current && nextModel.folders.some((folder) => folder.id === current)) return current;
        return nextModel.folders[0]?.id || '';
      });
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load media.');
      if (showLoading) setModel(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, teamId]);

  const activeFolder = useMemo(() => model?.folders.find((folder) => folder.id === activeFolderId) || model?.folders[0] || null, [activeFolderId, model]);
  const allItems = useMemo(() => model?.folders.flatMap((folder) => folder.items.map((item) => ({ ...item, folderName: folder.name || 'Album' }))) || [], [model]);
  const featured = activeFolder?.items[0] || allItems[0] || null;

  const uploadPhoto = async (file: File | null | undefined) => {
    if (!file || !activeFolder) return;
    setUploading('photo');
    setError('');
    setMessage('Uploading photo...');
    try {
      await uploadParentTeamMediaPhoto(teamId, activeFolder.id, file);
      setMessage('Photo uploaded.');
      await refresh({ showLoading: false });
    } catch (uploadError: any) {
      setError(uploadError?.message || 'Photo upload failed.');
      setMessage('');
    } finally {
      setUploading('');
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const uploadFile = async (file: File | null | undefined) => {
    if (!file || !activeFolder) return;
    setUploading('file');
    setError('');
    setMessage('Uploading file...');
    try {
      await uploadParentTeamMediaFile(teamId, activeFolder.id, file);
      setMessage('File uploaded.');
      await refresh({ showLoading: false });
    } catch (uploadError: any) {
      setError(uploadError?.message || 'File upload failed.');
      setMessage('');
    } finally {
      setUploading('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeFolder) return;
    setUploading('link');
    setError('');
    setMessage('');
    try {
      await addParentTeamMediaLink(teamId, activeFolder.id, linkTitle, linkUrl);
      setMessage('Media link added.');
      setLinkTitle('');
      setLinkUrl('');
      await refresh({ showLoading: false });
    } catch (linkError: any) {
      setError(linkError?.message || 'Unable to add media link.');
    } finally {
      setUploading('');
    }
  };

  if (!teamId) return <Navigate to="/teams" replace />;

  if (loading) {
    return (
      <section className="app-card p-6 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">Loading media</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Getting albums, photos, videos, and files.</div>
      </section>
    );
  }

  if (!model) {
    return (
      <div className="space-y-3">
        <Link to="/teams" className="ghost-button min-h-9 px-3 text-xs">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Teams
        </Link>
        <Status tone="error" message={error || 'Media is not available.'} />
      </div>
    );
  }

  return (
    <div className="team-media-page space-y-3">
      <section className="app-card overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <Link to={`/teams/${encodeURIComponent(teamId)}`} className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0" aria-label="Back to team" title="Back to team">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-2xl bg-primary-50 text-primary-700">
            {featured?.type === 'photo' ? <img src={featured.url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5" aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="app-label">Team media</div>
            <h1 className="truncate text-xl font-black leading-tight text-gray-950">{model.team.name || 'Team'} media</h1>
            <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">{model.folders.length} albums - {allItems.length} items</p>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0 sm:!w-auto sm:!px-3 text-xs" onClick={() => refresh({ showLoading: false })} disabled={Boolean(uploading)} aria-label="Refresh media" title="Refresh media">
            <RefreshCw className={`h-4 w-4 ${uploading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-t border-gray-100 px-3 py-2 sm:px-4">
          {model.folders.length ? model.folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={`flex min-h-9 flex-none items-center gap-2 rounded-full border px-3 text-xs font-black ${activeFolder?.id === folder.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
              onClick={() => setActiveFolderId(folder.id)}
              aria-pressed={activeFolder?.id === folder.id}
            >
              {folder.name || 'Album'}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeFolder?.id === folder.id ? 'bg-white/20 text-white' : 'bg-white text-gray-600'}`}>{folder.itemCount}</span>
            </button>
          )) : <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black text-gray-600">No albums</span>}
        </div>
      </section>

      {error ? <Status tone="error" message={error} /> : null}
      {message ? <Status tone="success" message={message} /> : null}

      {model.canContribute && activeFolder ? (
        <section className="app-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Add to {activeFolder.name || 'album'}</div>
              <div className="mt-0.5 text-xs font-semibold text-gray-500">Photos upload directly. Video and website links can be added by URL.</div>
            </div>
            {uploading ? <Loader2 className="h-5 w-5 animate-spin text-primary-600" aria-hidden="true" /> : <Upload className="h-5 w-5 text-primary-600" aria-hidden="true" />}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="button" className="secondary-button justify-center" onClick={() => photoInputRef.current?.click()} disabled={Boolean(uploading)}>
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
              Photo
            </button>
            <button type="button" className="secondary-button justify-center" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading)}>
              <File className="h-4 w-4" aria-hidden="true" />
              File
            </button>
          </div>
          <input ref={photoInputRef} className="hidden" type="file" accept="image/*" onChange={(event) => uploadPhoto(event.target.files?.[0])} />
          <input ref={fileInputRef} className="hidden" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx" onChange={(event) => uploadFile(event.target.files?.[0])} />
          <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={addLink}>
            <input className="auth-input" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Video or link title" />
            <input className="auth-input" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://..." inputMode="url" />
            <button type="submit" className="primary-button justify-center" disabled={Boolean(uploading) || !linkTitle.trim() || !linkUrl.trim()}>
              {uploading === 'link' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Add link
            </button>
          </form>
        </section>
      ) : null}

      <section className="app-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-black text-gray-950">{activeFolder?.name || 'Media'}</div>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">{activeFolder?.items.length || 0} item{activeFolder?.items.length === 1 ? '' : 's'}</div>
          </div>
          {activeFolder?.visibility ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase text-gray-700">{activeFolder.visibility}</span> : null}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeFolder?.items.length ? activeFolder.items.map((item) => <MediaItemCard key={item.id} item={item} />) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No media in this album yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function MediaItemCard({ item }: { item: TeamMediaItem }) {
  const Icon = getItemIcon(item);
  const isPhoto = item.type === 'photo';
  return (
    <button type="button" className="group overflow-hidden rounded-xl border border-gray-200 bg-white text-left transition hover:border-primary-200 hover:shadow-app" onClick={() => openPublicUrl(item.url)}>
      <div className="aspect-video bg-gray-100">
        {isPhoto ? (
          <img src={item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-500">
            <Icon className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 p-3">
        <Icon className="h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-black text-gray-950">{item.title}</span>
        <ExternalLink className="h-4 w-4 flex-none text-gray-300 transition group-hover:text-primary-600" aria-hidden="true" />
      </div>
    </button>
  );
}

function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function getItemIcon(item: TeamMediaItem) {
  const type = String(item.type || '').toLowerCase();
  if (type.includes('video')) return Video;
  if (type === 'photo' || type.includes('image')) return ImageIcon;
  if (type.includes('link')) return LinkIcon;
  return File;
}
