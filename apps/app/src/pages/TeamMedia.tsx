import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, useParams } from 'react-router-dom';
import { isSupportedTeamMediaDocument } from '../../../../js/team-media-utils.js';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Download,
  ExternalLink,
  Edit3,
  File,
  ImageIcon,
  LinkIcon,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Upload,
  Video
} from 'lucide-react';
import { openPublicUrl, sharePublicUrl } from '../lib/publicActions';
import { sendTeamChatMessage, type ChatAttachment } from '../lib/chatService';
import { DEFAULT_TEAM_CONVERSATION_ID } from '../lib/chatLogic';
import {
  addParentTeamMediaLink,
  createTeamMediaAlbumForApp,
  loadTeamMediaForApp,
  uploadParentTeamMediaFile,
  uploadParentTeamMediaPhoto,
  deleteTeamMediaItemForApp,
  bulkDeleteTeamMediaItemsForApp,
  updateTeamMediaItemForApp,
  moveTeamMediaItemForApp,
  setTeamMediaAlbumCoverForApp,
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
  const [selectedMediaType, setSelectedMediaType] = useState<MediaTypeFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [albumName, setAlbumName] = useState('');
  const [albumVisibility, setAlbumVisibility] = useState<'team' | 'private'>('team');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState('');
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState('');
  const [renamingItemId, setRenamingItemId] = useState('');
  const [movingItemId, setMovingItemId] = useState('');
  const [coverItemId, setCoverItemId] = useState('');
  const [postingItemId, setPostingItemId] = useState('');
  const postingItemIdRef = useRef('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async ({ showLoading = model === null, preferredFolderId = '' }: { showLoading?: boolean; preferredFolderId?: string } = {}) => {
    if (!teamId) return;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const nextModel = await loadTeamMediaForApp(auth.user, teamId);
      setModel(nextModel);
      setActiveFolderId((current) => {
        if (preferredFolderId && nextModel.folders.some((folder) => folder.id === preferredFolderId)) return preferredFolderId;
        if (current && nextModel.folders.some((folder) => folder.id === current)) return current;
        return nextModel.folders[0]?.id || '';
      });
      setSelectedIds((current) => current.filter((itemId) => nextModel.folders.some((folder) => folder.items.some((item) => item.id === itemId))));
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load media.');
      if (showLoading) setModel(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleRenameItem = async (item: TeamMediaItem, nextTitle: string) => {
    if (!teamId || !item?.id) return;

    const cleanTitle = nextTitle.trim();
    if (!cleanTitle) {
      setError('Media item title cannot be empty.');
      setMessage('');
      return;
    }

    setRenamingItemId(item.id);
    setError('');
    setMessage('');
    try {
      await updateTeamMediaItemForApp(teamId, item.id, cleanTitle);
      setModel((current) => current ? {
        ...current,
        folders: current.folders.map((folder) => ({
          ...folder,
          items: folder.items.map((folderItem) => folderItem.id === item.id ? { ...folderItem, title: cleanTitle } : folderItem)
        }))
      } : current);
      setMessage('Media item renamed.');
    } catch (renameError: any) {
      setError(renameError?.message || 'Unable to rename media item.');
    } finally {
      setRenamingItemId('');
    }
  };

  const handleDeleteItem = async (item: TeamMediaItem) => {
    if (!teamId || !item?.id) return;
    if (!window.confirm(`Are you sure you want to delete ${item.title || 'this media item'}? This cannot be undone.`)) {
      return;
    }

    setDeletingItemId(item.id);
    setError('');
    setMessage('');
    try {
      await deleteTeamMediaItemForApp(teamId, item);
      setMessage('Media item deleted.');
      await refresh({ showLoading: false });
    } catch (deleteError: any) {
      setError(deleteError?.message || 'Unable to delete media item.');
    } finally {
      setDeletingItemId('');
    }
  };

  const handleMoveItem = async (item: TeamMediaItem, targetFolderId: string) => {
    if (!teamId || !item?.id) return;
    if (!targetFolderId || targetFolderId === activeFolder?.id) {
      setError('Choose a different album to move this item.');
      setMessage('');
      return;
    }

    setMovingItemId(item.id);
    setError('');
    setMessage('');
    try {
      await moveTeamMediaItemForApp(teamId, item.id, targetFolderId);
      await refresh({ showLoading: false, preferredFolderId: targetFolderId });
      const destinationName = model?.folders.find((folder) => folder.id === targetFolderId)?.name || 'the selected album';
      setMessage(`Media item moved to ${destinationName}.`);
    } catch (moveError: any) {
      setError(moveError?.message || 'Unable to move media item.');
    } finally {
      setMovingItemId('');
    }
  };

  const handleSetAlbumCover = async (item: TeamMediaItem) => {
    if (!teamId || !activeFolder?.id || !item?.id) return;

    setCoverItemId(item.id);
    setError('');
    setMessage('');
    try {
      await setTeamMediaAlbumCoverForApp(teamId, activeFolder.id, item);
      setModel((current) => current ? {
        ...current,
        folders: current.folders.map((folder) => folder.id === activeFolder.id ? {
          ...folder,
          coverPhotoId: item.id,
          coverPhotoUrl: item.url,
          coverPhotoTitle: item.title || 'Album cover'
        } : folder)
      } : current);
      setMessage('Album cover saved.');
      await refresh({ showLoading: false, preferredFolderId: activeFolder.id });
    } catch (coverError: any) {
      setError(coverError?.message || 'Unable to save album cover.');
    } finally {
      setCoverItemId('');
    }
  };

  const handlePostItemToChat = async (item: TeamMediaItem, caption = '') => {
    if (!teamId || !auth.user || !item?.id || postingItemIdRef.current) return false;

    postingItemIdRef.current = item.id;
    setPostingItemId(item.id);
    setError('');
    setMessage('');
    try {
      const attachment: ChatAttachment = {
        type: 'image',
        url: item.url,
        name: item.title || 'Team media photo',
        mimeType: null,
        size: null,
        path: null,
        thumbnailUrl: item.url
      };
      await sendTeamChatMessage({
        teamId,
        user: auth.user,
        profile: auth.profile || {},
        text: caption.trim(),
        attachments: [attachment],
        selectedConversation: null,
        selectedConversationId: DEFAULT_TEAM_CONVERSATION_ID,
        selectedRecipientTarget: 'full_team',
        selectedRecipientIds: []
      });
      setMessage('Photo posted to team chat.');
      return true;
    } catch (postError: any) {
      setError(postError?.message || 'Unable to post photo to team chat. Try again.');
      return false;
    } finally {
      postingItemIdRef.current = '';
      setPostingItemId('');
    }
  };

  useEffect(() => {
    void refresh({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, teamId]);

  const activeFolder = useMemo(() => model?.folders.find((folder) => folder.id === activeFolderId) || model?.folders[0] || null, [activeFolderId, model]);
  const allItems = useMemo(() => model?.folders.flatMap((folder) => folder.items.map((item) => ({ ...item, folderName: folder.name || 'Album' }))) || [], [model]);
  const mediaTypeCounts = useMemo(() => getMediaTypeCounts(activeFolder?.items || []), [activeFolder]);
  const filteredItems = useMemo(() => (activeFolder?.items || []).filter((item) => matchesMediaTypeFilter(item, selectedMediaType)), [activeFolder, selectedMediaType]);
  const visibleItemIds = useMemo(() => filteredItems.map((item) => item.id).filter(Boolean), [filteredItems]);
  const selectedItems = useMemo(() => filteredItems.filter((item) => selectedIds.includes(item.id)), [filteredItems, selectedIds]);
  const selectedCount = selectedItems.length;
  const selectedMediaTypeLabel = MEDIA_TYPE_FILTERS.find((filter) => filter.id === selectedMediaType)?.label || 'All';
  const emptyStateLabel = selectedMediaType === 'all' ? 'media' : selectedMediaTypeLabel.toLowerCase();
  const featured = activeFolder ? getFolderCoverMedia(activeFolder) || allItems[0] || null : allItems[0] || null;

  useEffect(() => {
    setSelectedIds((current) => current.filter((itemId) => visibleItemIds.includes(itemId)));
  }, [visibleItemIds]);

  const toggleItemSelection = (itemId: string, checked: boolean) => {
    if (!itemId || !model?.canManage) return;
    setSelectedIds((current) => checked ? current.includes(itemId) ? current : [...current, itemId] : current.filter((selectedId) => selectedId !== itemId));
  };

  const handleBulkDelete = async () => {
    if (!teamId || !selectedItems.length) return;
    const deleteCount = selectedItems.length;
    const confirmed = window.confirm(`Are you sure you want to delete ${deleteCount} media item${deleteCount === 1 ? '' : 's'}? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingItemId('__bulk__');
    setError('');
    setMessage('');
    try {
      await bulkDeleteTeamMediaItemsForApp(teamId, selectedItems);
      setSelectedIds([]);
      await refresh({ showLoading: false, preferredFolderId: activeFolder?.id || '' });
      setMessage(`${deleteCount} media item${deleteCount === 1 ? '' : 's'} deleted.`);
    } catch (deleteError: any) {
      setError(deleteError?.message || 'Unable to delete selected media items.');
    } finally {
      setDeletingItemId('');
    }
  };

  const updateUploadQueueItem = (id: string, nextStatus: UploadQueueItem['status'], errorMessage = '') => {
    setUploadQueue((current) => current.map((item) => item.id === id ? { ...item, status: nextStatus, errorMessage } : item));
  };

  const uploadPhotos = async (files: File[]) => {
    if (!files.length || !activeFolder || creatingAlbum) return;
    const queueItems = files.map((file, index) => createUploadQueueItem(file, 'photo', index));
    flushSync(() => {
      setUploadQueue((current) => [...queueItems, ...current].slice(0, 12));
    });
    setUploading('photo');
    setError('');
    setMessage(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}...`);
    let uploaded = 0;
    let failed = 0;
    try {
      await runWithConcurrency(queueItems, PHOTO_UPLOAD_CONCURRENCY, async (queueItem, index) => {
        const file = files[index];
        if (!isSupportedPhotoUpload(file)) {
          failed += 1;
          updateUploadQueueItem(queueItem.id, 'error', 'Unsupported image or file exceeds 10 MB.');
          return;
        }
        try {
          await uploadParentTeamMediaPhoto(teamId, activeFolder.id, file);
          uploaded += 1;
          updateUploadQueueItem(queueItem.id, 'success');
        } catch {
          failed += 1;
          updateUploadQueueItem(queueItem.id, 'error', 'Upload failed.');
        }
      });

      if (uploaded > 0) {
        const resultMessage = getPhotoUploadMessage(uploaded, failed);
        await refresh({ showLoading: false, preferredFolderId: activeFolder.id });
        if (failed > 0) {
          setError(resultMessage);
          setMessage('');
        } else {
          setMessage(resultMessage);
        }
      } else {
        setMessage('');
        setError(failed > 0 ? 'No photos uploaded. Choose image files that are 10 MB or smaller.' : 'Photo upload failed.');
      }
    } finally {
      setUploading('');
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length || !activeFolder || creatingAlbum) return;
    const queueItems = files.map((file, index) => createUploadQueueItem(file, 'file', index));
    flushSync(() => {
      setUploadQueue((current) => [...queueItems, ...current].slice(0, 12));
    });
    setUploading('file');
    setError('');
    setMessage(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}...`);
    let uploaded = 0;
    let failed = 0;
    try {
      for (const [index, queueItem] of queueItems.entries()) {
        const file = files[index];
        if (!isSupportedTeamMediaDocument(file)) {
          failed += 1;
          updateUploadQueueItem(queueItem.id, 'error', 'Unsupported file or file exceeds 10 MB.');
          continue;
        }
        try {
          await uploadParentTeamMediaFile(teamId, activeFolder.id, file);
          uploaded += 1;
          updateUploadQueueItem(queueItem.id, 'success');
        } catch (uploadError: any) {
          failed += 1;
          updateUploadQueueItem(queueItem.id, 'error', uploadError?.message || 'Upload failed.');
        }
      }

      if (uploaded > 0) {
        await refresh({ showLoading: false, preferredFolderId: activeFolder.id });
        const resultMessage = getFileUploadMessage(uploaded, failed);
        if (failed > 0) {
          setError(resultMessage);
          setMessage('');
        } else {
          setMessage(resultMessage);
        }
      } else {
        setMessage('');
        setError(failed > 0 ? 'No files uploaded. Choose supported documents that are 10 MB or smaller.' : 'File upload failed.');
      }
    } finally {
      setUploading('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const createAlbum = async (event: FormEvent) => {
    event.preventDefault();
    const name = albumName.trim();
    if (!name || creatingAlbum) return;
    setCreatingAlbum(true);
    setError('');
    setMessage('');
    try {
      const folderId = await createTeamMediaAlbumForApp(teamId, { name, visibility: albumVisibility });
      setMessage('Album created. You can add photos, files, or links now.');
      setAlbumName('');
      await refresh({ showLoading: false, preferredFolderId: String(folderId || '') });
    } catch (albumError: any) {
      setError(albumError?.message || 'Unable to create album. Check your connection and permissions, then try again.');
    } finally {
      setCreatingAlbum(false);
    }
  };

  const addLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeFolder || creatingAlbum) return;
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
            {isPhotoMediaItem(featured) ? <img src={featured.url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5" aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="app-label">Team media</div>
            <h1 className="truncate text-xl font-black leading-tight text-gray-950">{model.team.name || 'Team'} media</h1>
            <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">{model.folders.length} albums - {allItems.length} items</p>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0 sm:!w-auto sm:!px-3 text-xs" onClick={() => refresh({ showLoading: false })} disabled={Boolean(uploading) || creatingAlbum} aria-label="Refresh media" title="Refresh media">
            <RefreshCw className={`h-4 w-4 ${uploading || creatingAlbum ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-t border-gray-100 px-3 py-2 sm:px-4">
          {model.folders.length ? model.folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={`flex min-h-9 flex-none items-center gap-2 rounded-full border px-2 py-1 text-xs font-black ${activeFolder?.id === folder.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
              onClick={() => {
                setActiveFolderId(folder.id);
                setSelectedMediaType('all');
                setSelectedIds([]);
              }}
              aria-pressed={activeFolder?.id === folder.id}
            >
              <FolderCoverThumb folder={folder} active={activeFolder?.id === folder.id} />
              {folder.name || 'Album'}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeFolder?.id === folder.id ? 'bg-white/20 text-white' : 'bg-white text-gray-600'}`}>{folder.itemCount}</span>
            </button>
          )) : <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black text-gray-600">No albums</span>}
        </div>
      </section>

      {error ? <Status tone="error" message={error} /> : null}
      {message ? <Status tone="success" message={message} /> : null}

      {model.canManage ? (
        <section className="app-card p-4">
          <form className="space-y-3" onSubmit={createAlbum}>
            <div>
              <div className="text-sm font-black text-gray-950">Create album</div>
              <div className="mt-0.5 text-xs font-semibold text-gray-500">{model.folders.length ? 'Add another album for this team.' : 'Start this media library with a team-visible or private album.'}</div>
            </div>
            <label className="block text-xs font-black uppercase tracking-wide text-gray-600" htmlFor="team-media-album-name">Album name</label>
            <input
              id="team-media-album-name"
              className="auth-input min-h-11 w-full"
              value={albumName}
              onChange={(event) => setAlbumName(event.target.value)}
              placeholder="Album name"
              disabled={creatingAlbum}
              aria-label="Album name"
            />
            <label className="block text-xs font-black uppercase tracking-wide text-gray-600" htmlFor="team-media-album-visibility">Visibility</label>
            <select
              id="team-media-album-visibility"
              className="auth-input min-h-11 w-full"
              value={albumVisibility}
              onChange={(event) => setAlbumVisibility(event.target.value === 'private' ? 'private' : 'team')}
              disabled={creatingAlbum}
              aria-label="Album visibility"
            >
              <option value="team">Team-visible</option>
              <option value="private">Private/admins only</option>
            </select>
            <button type="submit" className="primary-button min-h-11 w-full justify-center" disabled={creatingAlbum || !albumName.trim()} aria-disabled={creatingAlbum || !albumName.trim()}>
              {creatingAlbum ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Create album
            </button>
          </form>
        </section>
      ) : !model.folders.length ? (
        <section className="app-card p-4 text-sm font-semibold text-gray-600">
          No albums are available yet. A coach or team admin can create the first media album.
        </section>
      ) : null}

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
            <button type="button" className="secondary-button justify-center" onClick={() => photoInputRef.current?.click()} disabled={Boolean(uploading) || creatingAlbum}>
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
              Photo
            </button>
            <button type="button" className="secondary-button justify-center" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading) || creatingAlbum}>
              <File className="h-4 w-4" aria-hidden="true" />
              File
            </button>
          </div>
          <input ref={photoInputRef} className="hidden" type="file" accept="image/*" multiple onChange={(event) => uploadPhotos(Array.from(event.target.files || []))} />
          <input ref={fileInputRef} className="hidden" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx" multiple onChange={(event) => uploadFiles(Array.from(event.target.files || []))} />
          {uploadQueue.length ? (
            <div className="mt-3 space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3" aria-live="polite" aria-label="Upload progress list">
              <div className="text-xs font-black uppercase tracking-wide text-gray-600">Upload progress</div>
              {uploadQueue.map((item) => (
                <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-gray-950">{item.name}</div>
                      <div className={`text-[11px] font-semibold ${item.status === 'error' ? 'text-rose-700' : item.status === 'success' ? 'text-emerald-700' : 'text-gray-500'}`}>
                        {item.status === 'uploading' ? 'Uploading…' : item.status === 'success' ? 'Uploaded' : item.errorMessage || 'Upload failed.'}
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${item.kind === 'photo' ? 'bg-primary-50 text-primary-700' : 'bg-amber-50 text-amber-700'}`}>{item.kind}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    <div className={`h-full rounded-full transition-all ${item.status === 'success' ? 'w-full bg-emerald-500' : item.status === 'error' ? 'w-full bg-rose-500' : 'w-2/3 bg-primary-500'}`} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={addLink}>
            <input className="auth-input" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Video or link title" />
            <input className="auth-input" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://..." inputMode="url" />
            <button type="submit" className="primary-button justify-center" disabled={Boolean(uploading) || creatingAlbum || !linkTitle.trim() || !linkUrl.trim()}>
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
        <div className="mt-3 flex gap-1.5 overflow-x-auto" aria-label="Media type filters">
          {MEDIA_TYPE_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`flex min-h-9 flex-none items-center gap-2 rounded-full border px-3 text-xs font-black ${selectedMediaType === filter.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
              onClick={() => {
                setSelectedMediaType(filter.id);
                setSelectedIds([]);
              }}
              aria-pressed={selectedMediaType === filter.id}
            >
              {filter.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${selectedMediaType === filter.id ? 'bg-white/20 text-white' : 'bg-white text-gray-600'}`}>{mediaTypeCounts[filter.id]}</span>
            </button>
          ))}
        </div>
        {model.canManage ? (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-3" aria-label="Selected media actions">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-gray-600">Bulk actions</div>
                <div className="text-sm font-semibold text-gray-700">{selectedCount} selected in this view</div>
              </div>
              <button
                type="button"
                className="ghost-button justify-center text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                onClick={handleBulkDelete}
                disabled={!selectedCount || deletingItemId === '__bulk__'}
                aria-disabled={!selectedCount || deletingItemId === '__bulk__'}
              >
                {deletingItemId === '__bulk__' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {deletingItemId === '__bulk__' ? 'Deleting selected' : 'Delete selected'}
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.length ? filteredItems.map((item) => (
            <TeamMediaItemCard
              key={item.id}
              item={item}
              onStatus={(tone, msg) => tone === 'error' ? setError(msg) : setMessage(msg)}
              canManage={model.canManage}
              canPostToChat={model.canPostChat && model.canContribute && Boolean(auth.user)}
              currentUserId={auth.user?.uid || ''}
              folders={model.folders}
              currentFolderId={activeFolder?.id || ''}
              deleting={deletingItemId === item.id}
              selectable={model.canManage}
              selected={selectedIds.includes(item.id)}
              renaming={renamingItemId === item.id}
              moving={movingItemId === item.id}
              settingCover={coverItemId === item.id}
              posting={postingItemId === item.id}
              onToggleSelected={toggleItemSelection}
              onRenameItem={handleRenameItem}
              onDeleteItem={handleDeleteItem}
              onMoveItem={handleMoveItem}
              onSetAlbumCover={handleSetAlbumCover}
              onPostToChat={handlePostItemToChat}
            />
          )) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No {emptyStateLabel} in this album.</div>
          )}
        </div>
      </section>
    </div>
  );
}

type MediaTypeFilter = 'all' | 'photos' | 'videos' | 'files';
type UploadQueueItem = {
  id: string;
  kind: 'photo' | 'file';
  name: string;
  status: 'uploading' | 'success' | 'error';
  errorMessage: string;
};

const MEDIA_TYPE_FILTERS: { id: MediaTypeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'photos', label: 'Photos' },
  { id: 'videos', label: 'Videos' },
  { id: 'files', label: 'Files' }
];
const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;
const PHOTO_UPLOAD_CONCURRENCY = 3;

function isSupportedPhotoUpload(file: File) {
  return Boolean(file?.type?.startsWith('image/')) && Number(file.size || 0) > 0 && Number(file.size || 0) <= MAX_PHOTO_UPLOAD_BYTES;
}

function getPhotoUploadMessage(uploaded: number, failed: number) {
  const uploadedLabel = `${uploaded} photo${uploaded === 1 ? '' : 's'} uploaded`;
  if (failed > 0) return `${uploadedLabel}; ${failed} failed.`;
  return `${uploadedLabel}.`;
}

function getFileUploadMessage(uploaded: number, failed: number) {
  const uploadedLabel = `${uploaded} file${uploaded === 1 ? '' : 's'} uploaded`;
  if (failed > 0) return `${uploadedLabel}; ${failed} failed.`;
  return `${uploadedLabel}.`;
}

function createUploadQueueItem(file: File, kind: 'photo' | 'file', index: number): UploadQueueItem {
  return {
    id: `${kind}-${file.name || 'upload'}-${file.size || 0}-${index}`,
    kind,
    name: file.name || `Untitled ${kind}`,
    status: 'uploading',
    errorMessage: ''
  };
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  const maxConcurrency = Math.max(1, Math.floor(concurrency) || 1);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  };

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
}

function isPhotoMediaItem(item: TeamMediaItem | null | undefined) {
  const type = String(item?.type || '').toLowerCase();
  return type === 'photo' || type.includes('image');
}

function isVideoMediaItem(item: TeamMediaItem) {
  return String(item.type || '').toLowerCase() === 'video_link';
}

function isFileMediaItem(item: TeamMediaItem) {
  return String(item.type || '').toLowerCase() === 'file';
}

function matchesMediaTypeFilter(item: TeamMediaItem, filter: MediaTypeFilter) {
  if (filter === 'photos') return isPhotoMediaItem(item);
  if (filter === 'videos') return isVideoMediaItem(item);
  if (filter === 'files') return isFileMediaItem(item);
  return true;
}

function getMediaTypeCounts(items: TeamMediaItem[]) {
  return {
    all: items.length,
    photos: items.filter((item) => matchesMediaTypeFilter(item, 'photos')).length,
    videos: items.filter((item) => matchesMediaTypeFilter(item, 'videos')).length,
    files: items.filter((item) => matchesMediaTypeFilter(item, 'files')).length
  };
}

function getFolderCoverMedia(folder: TeamMediaFolder | null) {
  if (!folder) return null;

  const coverPhotoUrl = String(folder.coverPhotoUrl || '').trim();
  if (coverPhotoUrl) {
    return {
      id: String(folder.coverPhotoId || 'album-cover').trim() || 'album-cover',
      url: coverPhotoUrl,
      title: String(folder.coverPhotoTitle || folder.name || 'Album cover').trim() || 'Album cover',
      type: 'photo'
    };
  }

  return folder.items[0] || null;
}

function FolderCoverThumb({ folder, active }: { folder: TeamMediaFolder; active: boolean }) {
  const cover = getFolderCoverMedia(folder);

  return (
    <span className={`flex h-6 w-6 flex-none items-center justify-center overflow-hidden rounded-full ${active ? 'bg-white/20 text-white' : 'bg-white text-gray-500'}`} aria-hidden="true">
      {isPhotoMediaItem(cover) ? <img src={cover.url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />}
    </span>
  );
}

function TeamMediaItemCard({
  item,
  onStatus,
  canManage,
  canPostToChat,
  currentUserId,
  folders,
  currentFolderId,
  deleting,
  selectable,
  selected,
  renaming,
  moving,
  settingCover,
  posting,
  onToggleSelected,
  onRenameItem,
  onDeleteItem,
  onMoveItem,
  onSetAlbumCover,
  onPostToChat
}: {
  item: TeamMediaItem;
  onStatus: (tone: 'error' | 'success', message: string) => void;
  canManage: boolean;
  canPostToChat: boolean;
  currentUserId: string;
  folders: TeamMediaFolder[];
  currentFolderId: string;
  deleting: boolean;
  selectable: boolean;
  selected: boolean;
  renaming: boolean;
  moving: boolean;
  settingCover: boolean;
  posting: boolean;
  onToggleSelected: (itemId: string, checked: boolean) => void;
  onRenameItem: (item: TeamMediaItem, title: string) => Promise<void>;
  onDeleteItem: (item: TeamMediaItem) => void;
  onMoveItem: (item: TeamMediaItem, targetFolderId: string) => Promise<void>;
  onSetAlbumCover: (item: TeamMediaItem) => Promise<void>;
  onPostToChat: (item: TeamMediaItem, caption: string) => Promise<boolean>;
}) {
  const Icon = getItemIcon(item);
  const isPhoto = isPhotoMediaItem(item);
  const title = item.title || 'Team media';
  const [isRenaming, setIsRenaming] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [postCaption, setPostCaption] = useState('');
  const [moveFolderId, setMoveFolderId] = useState('');
  const alternateFolders = folders.filter((folder) => folder.id && folder.id !== currentFolderId);
  const canMove = canManage && alternateFolders.length > 0;
  const selectedMoveFolderId = moveFolderId && moveFolderId !== currentFolderId ? moveFolderId : '';
  const canRename = canManage || item.uploadedBy === currentUserId;
  const canDelete = canManage || (['photo', 'file'].includes(String(item.type || '').toLowerCase()) && item.uploadedBy === currentUserId);
  const canPostToTeamChat = canPostToChat && isPhoto && Boolean(item.url);

  const startRename = () => {
    setDraftTitle(title);
    setIsRenaming(true);
  };

  const saveRename = async () => {
    const cleanTitle = draftTitle.trim();
    if (!cleanTitle) {
      onStatus('error', 'Media item title cannot be empty.');
      return;
    }
    await onRenameItem(item, cleanTitle);
    setIsRenaming(false);
  };

  const moveItem = async () => {
    if (!selectedMoveFolderId || moving) return;
    await onMoveItem(item, selectedMoveFolderId);
    setMoveFolderId('');
  };

  const postToTeamChat = async () => {
    if (posting) return;
    const posted = await onPostToChat(item, postCaption);
    if (!posted) return;
    setPostCaption('');
    setIsPosting(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      onStatus('success', 'Media link copied.');
    } catch {
      onStatus('error', 'Unable to copy media link.');
    }
  };

  const shareItem = async () => {
    const result = await sharePublicUrl({
      title,
      text: `Check out ${title}`,
      url: item.url
    });
    if (result === 'shared') onStatus('success', 'Share sheet opened.');
    if (result === 'copied') onStatus('success', 'Share unavailable here. Link copied instead.');
    if (result === 'failed') onStatus('error', 'Sharing is unavailable in this browser.');
  };

  const downloadItem = () => {
    const link = document.createElement('a');
    link.href = item.url;
    link.download = getMediaDownloadName(item);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <article className={`overflow-hidden rounded-xl border bg-white transition hover:border-primary-200 hover:shadow-app ${selected ? 'border-primary-500 ring-2 ring-primary-100' : 'border-gray-200'}`}>
      <div className="relative aspect-video bg-gray-100">
        {selectable ? (
          <label className="absolute left-2 top-2 z-10 flex items-center gap-2 rounded-full bg-white/95 px-2 py-1 text-[11px] font-black text-gray-700 shadow-sm">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onToggleSelected(item.id, event.target.checked)}
              aria-label={`Select ${title}`}
            />
            Select
          </label>
        ) : null}
        {isPhoto ? (
          <img src={item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-500">
            <Icon className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-black text-gray-950">{title}</span>
        </div>
        {isRenaming ? (
          <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50 p-2">
            <label className="sr-only" htmlFor={`rename-media-${item.id}`}>Media item title</label>
            <input
              id={`rename-media-${item.id}`}
              className="auth-input min-h-10 w-full bg-white"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              disabled={renaming}
              aria-label="Media item title"
            />
            <div className="mt-2 flex gap-2">
              <button type="button" className="primary-button !h-8 !min-h-8 !px-2 !text-xs" onClick={saveRename} disabled={renaming}>
                {renaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                Save
              </button>
              <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={() => setIsRenaming(false)} disabled={renaming}>Cancel</button>
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="secondary-button !h-8 !min-h-8 !px-2 !text-xs" onClick={() => openPublicUrl(item.url)} aria-label={`Open ${title}`}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open
          </button>
          <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={shareItem}>
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            Share
          </button>
          <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={downloadItem}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Save
          </button>
          <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={copyLink}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Copy
          </button>
          {canRename && (
            <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={startRename} disabled={renaming} aria-label={`Rename ${title}`}>
              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
              Rename
            </button>
          )}
          {canPostToTeamChat && (
            <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={() => setIsPosting((current) => !current)} disabled={posting} aria-label={`Post ${title} to team chat`}>
              {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              Post to team chat
            </button>
          )}
          {canManage && isPhoto && (
            <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={() => onSetAlbumCover(item)} disabled={settingCover} aria-label={`Set ${title} as album cover`}>
              {settingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />}
              {settingCover ? 'Saving cover' : 'Set as cover'}
            </button>
          )}
          {canMove && (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-2">
              <label className="sr-only" htmlFor={`move-media-${item.id}`}>Move media item to album</label>
              <select
                id={`move-media-${item.id}`}
                className="auth-input min-h-8 flex-1 py-1 text-xs"
                value={selectedMoveFolderId}
                onChange={(event) => setMoveFolderId(event.target.value)}
                disabled={moving}
                aria-label={`Move ${title} to album`}
              >
                <option value="">Move to album...</option>
                {alternateFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name || 'Album'}</option>
                ))}
              </select>
              <button type="button" className="primary-button !h-8 !min-h-8 !px-2 !text-xs" onClick={moveItem} disabled={moving || !selectedMoveFolderId} aria-label={`Move ${title}`}>
                {moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                {moving ? 'Moving' : 'Move'}
              </button>
            </div>
          )}
          {canDelete && (
            <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-60" onClick={() => onDeleteItem(item)} disabled={deleting} aria-label={`Delete ${title}`}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              {deleting ? 'Deleting' : 'Delete'}
            </button>
          )}
        </div>
        {isPosting ? (
          <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50 p-2">
            <label className="sr-only" htmlFor={`post-media-caption-${item.id}`}>Caption for team chat</label>
            <input
              id={`post-media-caption-${item.id}`}
              className="auth-input min-h-10 w-full bg-white"
              value={postCaption}
              onChange={(event) => setPostCaption(event.target.value)}
              disabled={posting}
              placeholder="Add an optional caption"
              aria-label="Caption for team chat"
            />
            <div className="mt-2 flex gap-2">
              <button type="button" className="primary-button !h-8 !min-h-8 !px-2 !text-xs" onClick={postToTeamChat} disabled={posting}>
                {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                {posting ? 'Posting' : 'Send to chat'}
              </button>
              <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={() => setIsPosting(false)} disabled={posting}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function getMediaDownloadName(item: TeamMediaItem) {
  const baseName = String(item.title || item.id || 'team-media').trim() || 'team-media';
  return baseName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'team-media';
}

function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
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
