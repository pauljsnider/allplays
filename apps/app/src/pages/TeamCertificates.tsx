import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Award, ExternalLink, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { renderCertificate } from '../../../../js/certificates/renderer.js';
import { loadCertificateDraftComposer, saveCertificateDraftsForApp, type CertificateDraftComposerModel, type CertificateDraftPlayer, type CertificateDraftSharedState } from '../lib/certificateDraftService';
import { openPublicUrl } from '../lib/publicActions';
import { useAsyncOperation } from '../lib/useAsyncOperation';
import type { AuthState } from '../lib/types';

export function TeamCertificates({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const [model, setModel] = useState<CertificateDraftComposerModel | null>(null);
  const [shared, setShared] = useState<CertificateDraftSharedState | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [previewPlayerId, setPreviewPlayerId] = useState('');
  const [hasResolvedInitialLoad, setHasResolvedInitialLoad] = useState(false);
  const { loading, error, setError, run: runPrimaryLoad } = useAsyncOperation();
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const previewRef = useRef<HTMLDivElement | null>(null);
  const activeLoadIdRef = useRef(0);

  const loadComposer = useCallback(async () => {
    if (!teamId) return null;

    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;
    setSuccess('');

    return runPrimaryLoad(
      () => loadCertificateDraftComposer(teamId, auth.user),
      {
        errorMessage: 'Unable to load certificate drafting.',
        rethrow: false,
        onSuccess: (nextModel) => {
          if (loadId !== activeLoadIdRef.current) return;
          setModel(nextModel);
          setShared(nextModel.shared);
          setSelectedPlayerIds(nextModel.players.map((player) => player.id));
          setPreviewPlayerId(nextModel.players[0]?.id || '');
        },
        onError: () => {
          if (loadId !== activeLoadIdRef.current) return;
          setModel(null);
          setShared(null);
          setSelectedPlayerIds([]);
          setPreviewPlayerId('');
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
    void loadComposer();

    return () => {
      activeLoadIdRef.current += 1;
    };
  }, [loadComposer]);

  const selectedPlayers = useMemo(() => {
    if (!model) return [];
    const selectedIds = new Set(selectedPlayerIds);
    return model.players.filter((player) => selectedIds.has(player.id));
  }, [model, selectedPlayerIds]);

  const previewPlayer = useMemo(() => {
    if (!selectedPlayers.length) return model?.players[0] || null;
    return selectedPlayers.find((player) => player.id === previewPlayerId) || selectedPlayers[0] || null;
  }, [model, previewPlayerId, selectedPlayers]);

  useEffect(() => {
    if (!previewRef.current || !shared || !model || !previewPlayer) return;
    previewRef.current.innerHTML = '';
    const previewNode = renderCertificate({
      shared,
      team: model.team,
      draft: {
        recipientName: previewPlayer.name,
        playerNumber: previewPlayer.number,
        awardTitle: shared.awardTitle,
        description: 'Preview only. Save the draft to continue editing in the full web studio.',
        descriptionStatus: 'ready',
        status: 'draft'
      }
    });
    previewNode.style.width = '100%';
    previewNode.style.height = 'auto';
    previewNode.style.aspectRatio = '2050 / 1153';
    previewNode.style.transform = 'none';
    previewNode.style.transformOrigin = 'top left';
    previewRef.current.appendChild(previewNode);
  }, [model, previewPlayer, shared]);

  useEffect(() => {
    if (!selectedPlayers.some((player) => player.id === previewPlayerId)) {
      setPreviewPlayerId(selectedPlayers[0]?.id || '');
    }
  }, [previewPlayerId, selectedPlayers]);

  if (!teamId) return <Navigate to="/teams" replace />;

  const onTogglePlayer = (playerId: string, checked: boolean) => {
    setSelectedPlayerIds((current) => checked
      ? Array.from(new Set([...current, playerId]))
      : current.filter((id) => id !== playerId));
  };

  const onOpenWebsite = async () => {
    if (!teamId) return;
    const url = new URL('certificates.html', 'https://allplays.ai');
    url.hash = new URLSearchParams({ teamId }).toString();
    await openPublicUrl(url.toString());
  };

  const onSaveDrafts = async () => {
    if (!teamId || !shared) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await saveCertificateDraftsForApp({
        teamId,
        user: auth.user,
        shared,
        selectedPlayers
      });
      setSuccess(`Created ${result.certificateIds.length} draft${result.certificateIds.length === 1 ? '' : 's'} and opened the web studio for final edits.`);
      await openPublicUrl(result.webUrl);
    } catch (saveError: any) {
      setError(saveError?.message || 'Unable to create certificate drafts.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !hasResolvedInitialLoad) {
    return (
      <div className="app-card flex min-h-[240px] items-center justify-center gap-3 p-5 text-sm font-semibold text-gray-600">
        <Loader2 className="h-5 w-5 animate-spin text-primary-600" aria-hidden="true" />
        Loading certificate drafting…
      </div>
    );
  }

  if (error && !model) {
    return (
      <div className="space-y-4">
        <Link to={`/teams/${encodeURIComponent(teamId)}`} className="text-sm font-black text-primary-700">← Back to team</Link>
        <div className="app-card p-5">
          <div className="text-base font-black text-gray-950">Certificate drafting unavailable</div>
          <div className="mt-2 text-sm font-semibold text-rose-700">{error}</div>
          <button type="button" className="primary-button mt-4" onClick={() => void loadComposer()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!model || !shared) {
    return <Navigate to={`/teams/${encodeURIComponent(teamId)}`} replace />;
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link to={`/teams/${encodeURIComponent(teamId)}`} className="text-sm font-black text-primary-700">← Back to team</Link>
          <h1 className="mt-2 text-2xl font-black text-gray-950">Awards drafts</h1>
          <p className="mt-1 text-sm font-semibold text-gray-500">Pick a template, choose players, preview, then continue in the full web studio for AI, publish, and print.</p>
        </div>
        <button type="button" className="ghost-button !min-h-10" onClick={() => void onOpenWebsite()}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open website
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{success}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="app-card p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-2xl bg-primary-50 p-2 text-primary-700"><Award className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <div className="text-sm font-black text-gray-950">Draft setup</div>
              <div className="mt-1 text-sm font-semibold text-gray-500">This saves draft certificates only. Parents still see nothing until publish is finished on the website.</div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Award title</span>
              <input
                value={shared.awardTitle}
                onChange={(event) => setShared((current) => current ? { ...current, awardTitle: event.target.value } : current)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                placeholder="Most Improved Player"
              />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Season label</span>
              <input
                value={shared.seasonLabel}
                onChange={(event) => setShared((current) => current ? { ...current, seasonLabel: event.target.value } : current)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                placeholder="Spring 2026"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Footer URL</span>
              <input
                value={shared.footerUrl}
                onChange={(event) => setShared((current) => current ? { ...current, footerUrl: event.target.value } : current)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                placeholder="www.allplays.ai"
              />
            </label>
          </div>

          <div className="mt-5">
            <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Template</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {model.templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`rounded-2xl border px-4 py-3 text-left text-sm font-black transition ${shared.templateId === template.id ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700 hover:border-primary-200 hover:bg-primary-50/60'}`}
                  onClick={() => setShared((current) => current ? { ...current, templateId: template.id } : current)}
                >
                  {template.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Players</div>
                <div className="mt-1 text-sm font-semibold text-gray-500">{selectedPlayers.length} selected</div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="ghost-button !min-h-9 text-xs" onClick={() => setSelectedPlayerIds(model.players.map((player) => player.id))}>Select all</button>
                <button type="button" className="ghost-button !min-h-9 text-xs" onClick={() => setSelectedPlayerIds([])}>Clear</button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {model.players.map((player) => (
                <label key={player.id} className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-semibold ${selectedPlayerIds.includes(player.id) ? 'border-primary-200 bg-primary-50/70 text-primary-900' : 'border-gray-200 bg-white text-gray-700'}`}>
                  <input
                    type="checkbox"
                    checked={selectedPlayerIds.includes(player.id)}
                    onChange={(event) => onTogglePlayer(player.id, event.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black text-gray-950">{player.name}</span>
                    <span className="block text-xs text-gray-500">{player.number ? `#${player.number}` : 'No number'}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            AI narratives, publish, and print stay in the website flow for now.
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className="primary-button" disabled={saving || selectedPlayers.length === 0} onClick={() => void onSaveDrafts()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Award className="h-4 w-4" aria-hidden="true" />}
              Create drafts
            </button>
          </div>
        </section>

        <section className="app-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Preview</div>
              <div className="mt-1 text-sm font-semibold text-gray-500">Uses the same certificate renderer as the website studio.</div>
            </div>
            <select
              value={previewPlayer?.id || ''}
              onChange={(event) => setPreviewPlayerId(event.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
              disabled={selectedPlayers.length === 0}
            >
              {(selectedPlayers.length ? selectedPlayers : model.players).map((player) => (
                <option key={player.id} value={player.id}>{player.name}</option>
              ))}
            </select>
          </div>
          <div className="mt-4 rounded-[28px] border border-gray-200 bg-gray-50 p-3">
            <div ref={previewRef} className="overflow-hidden rounded-[22px] bg-white shadow-sm" />
          </div>
        </section>
      </div>
    </div>
  );
}
