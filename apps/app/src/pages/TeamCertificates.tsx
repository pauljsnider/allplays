import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Award, Download, ExternalLink, Loader2, RefreshCw, Send, Sparkles } from 'lucide-react';
import { renderCertificate } from '../lib/adapters/legacyCertificates';
import { getCertificateFilename, renderNodeToPngBlob } from '../lib/adapters/legacyCertificateExport';
import { buildCertificateAwardDraftsForApp, generateCertificateAwardNarrativesForApp, publishCertificateAwardsForApp, type CertificateAwardDraft } from '../lib/certificateAwardService';
import { getCertificateStudioUrl, loadCertificateDraftComposer, saveCertificateDraftsForApp, type CertificateDraftComposerModel, type CertificateDraftPlayer, type CertificateDraftSharedState } from '../lib/certificateDraftService';
import { exportCertificatePngFile, openPublicUrl } from '../lib/publicActions';
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
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exportingDraftId, setExportingDraftId] = useState('');
  const [drafts, setDrafts] = useState<CertificateAwardDraft[]>([]);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
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
          setDrafts([]);
          setReviewConfirmed(false);
          setSelectedPlayerIds(nextModel.players.map((player) => player.id));
          setPreviewPlayerId(nextModel.players[0]?.id || '');
        },
        onError: () => {
          if (loadId !== activeLoadIdRef.current) return;
          setModel(null);
          setShared(null);
          setDrafts([]);
          setReviewConfirmed(false);
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

  const previewDraft = useMemo(() => {
    if (!drafts.length) return null;
    return drafts.find((draft) => draft.playerId === previewPlayerId) || drafts[0] || null;
  }, [drafts, previewPlayerId]);

  const exportableDrafts = useMemo(() => drafts.filter((draft) => draft.includeInExport !== false), [drafts]);
  const blockedPublishDrafts = useMemo(() => exportableDrafts.filter((draft) => draft.descriptionStatus !== 'ready'), [exportableDrafts]);
  const canPublishDrafts = reviewConfirmed && !generating && !publishing && exportableDrafts.length > 0 && blockedPublishDrafts.length === 0;
  const certificateStudioUrl = useMemo(() => {
    const batchId = drafts[0]?.batchId || '';
    return getCertificateStudioUrl(teamId, batchId);
  }, [drafts, teamId]);

  useEffect(() => {
    if (!previewRef.current || !shared || !model || (!previewPlayer && !previewDraft)) return;
    previewRef.current.innerHTML = '';
    const previewNode = renderCertificate({
      shared,
      team: model.team,
      draft: previewDraft || {
        recipientName: previewPlayer?.name || 'Player',
        playerNumber: previewPlayer?.number || '',
        awardTitle: shared.awardTitle,
        description: 'Preview only. Create drafts before generating AI narratives, publishing, or exporting.',
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
  }, [model, previewDraft, previewPlayer, shared]);

  useEffect(() => {
    const previewIds = drafts.length ? drafts.map((draft) => draft.playerId) : selectedPlayers.map((player) => player.id);
    if (!previewIds.includes(previewPlayerId)) {
      setPreviewPlayerId(previewIds[0] || '');
    }
  }, [drafts, previewPlayerId, selectedPlayers]);

  if (!teamId) return <Navigate to="/teams" replace />;

  const onTogglePlayer = (playerId: string, checked: boolean) => {
    setSelectedPlayerIds((current) => checked
      ? Array.from(new Set([...current, playerId]))
      : current.filter((id) => id !== playerId));
  };

  const onOpenWebsite = async () => {
    if (!teamId) return;
    await openPublicUrl(certificateStudioUrl);
  };

  const updateDraft = (draftId: string, patch: Partial<CertificateAwardDraft>) => {
    setDrafts((current) => current.map((draft) => draft.id === draftId ? { ...draft, ...patch } : draft));
    setReviewConfirmed(false);
  };

  const mergeGeneratedDrafts = (generatedDrafts: CertificateAwardDraft[]) => {
    setDrafts((current) => {
      const generatedById = new Map(generatedDrafts.map((draft) => [draft.id, draft]));
      if (!current.length) return generatedDrafts;
      return current.map((draft) => generatedById.get(draft.id) || draft);
    });
  };

  const runNarrativeGeneration = async (targetDrafts: CertificateAwardDraft[]) => {
    if (!teamId || !shared || !targetDrafts.length) return;
    setGenerating(true);
    setError('');
    setSuccess('');
    setReviewConfirmed(false);
    try {
      const generatedDrafts = await generateCertificateAwardNarrativesForApp({
        teamId,
        user: auth.user,
        shared,
        drafts: targetDrafts
      });
      mergeGeneratedDrafts(generatedDrafts);
      const errorCount = generatedDrafts.filter((draft) => draft.descriptionStatus === 'error').length;
      setSuccess(errorCount
        ? `${generatedDrafts.length - errorCount} narrative${generatedDrafts.length - errorCount === 1 ? '' : 's'} ready; ${errorCount} need manual review.`
        : `${generatedDrafts.length} AI narrative${generatedDrafts.length === 1 ? '' : 's'} ready for review.`);
    } catch (generationError: any) {
      setError(generationError?.message || 'Unable to generate certificate narratives.');
    } finally {
      setGenerating(false);
    }
  };

  const onSaveDrafts = async () => {
    if (!teamId || !shared) return;
    setSaving(true);
    setError('');
    setSuccess('');
    setDrafts([]);
    setReviewConfirmed(false);
    try {
      const result = await saveCertificateDraftsForApp({
        teamId,
        user: auth.user,
        shared,
        selectedPlayers
      });
      const nextDrafts = buildCertificateAwardDraftsForApp({
        batchId: result.batchId,
        certificateIds: result.certificateIds,
        players: selectedPlayers,
        shared
      });
      setDrafts(nextDrafts);
      setPreviewPlayerId(nextDrafts[0]?.playerId || '');
      setSuccess(`Created ${result.certificateIds.length} draft${result.certificateIds.length === 1 ? '' : 's'}. Generating AI narratives for review.`);
      await runNarrativeGeneration(nextDrafts);
    } catch (saveError: any) {
      setError(saveError?.message || 'Unable to create certificate drafts.');
    } finally {
      setSaving(false);
    }
  };

  const onRegenerateDraft = async (draft: CertificateAwardDraft) => {
    updateDraft(draft.id, {
      descriptionStatus: 'pending',
      errorMessage: null
    });
    await runNarrativeGeneration([{ ...draft, descriptionStatus: 'pending', errorMessage: null }]);
  };

  const onRegenerateAllDrafts = async () => {
    const pendingDrafts = drafts.map((draft) => ({
      ...draft,
      descriptionStatus: 'pending' as const,
      errorMessage: null
    }));
    setDrafts(pendingDrafts);
    setReviewConfirmed(false);
    await runNarrativeGeneration(pendingDrafts);
  };

  const onPublishDrafts = async () => {
    if (!teamId || !shared) return;
    const publishDrafts = exportableDrafts;
    if (!publishDrafts.length) {
      setError('Select at least one certificate before publishing.');
      return;
    }
    if (blockedPublishDrafts.length) {
      setError('Review or fix certificates marked Needs review or Error before publishing.');
      return;
    }
    if (!window.confirm(`Publish ${publishDrafts.length} certificate${publishDrafts.length === 1 ? '' : 's'} for parent viewing?`)) {
      return;
    }

    setPublishing(true);
    setError('');
    setSuccess('');
    try {
      const result = await publishCertificateAwardsForApp({
        teamId,
        user: auth.user,
        shared,
        drafts,
        reviewConfirmed
      });
      const publishedIds = new Set(result.publishedCertificateIds);
      setDrafts((current) => current.map((draft) => publishedIds.has(draft.certificateId) ? { ...draft, status: 'published' } : draft));
      setSuccess(`Published ${result.publishedCertificateIds.length} certificate${result.publishedCertificateIds.length === 1 ? '' : 's'} for parent viewing.`);
    } catch (publishError: any) {
      setError(publishError?.message || 'Unable to publish certificates.');
    } finally {
      setPublishing(false);
    }
  };

  const onExportDraft = async (draft: CertificateAwardDraft) => {
    if (!shared || !model) return;
    setExportingDraftId(draft.id);
    setError('');
    setSuccess('');
    const root = ensureCertificateExportRoot();
    const node = renderCertificate({ shared, team: model.team, draft });
    node.style.width = '2050px';
    node.style.height = '1153px';
    root.appendChild(node);
    try {
      const blob = await renderNodeToPngBlob(node);
      const result = await exportCertificatePngFile(getCertificateFilename({
        teamName: shared.teamNameOverride || model.team.name,
        recipientName: draft.recipientName,
        seasonLabel: shared.seasonLabel || 'season',
        extension: 'png'
      }), blob);
      setSuccess(result === 'shared' ? 'Certificate export opened in the share sheet.' : 'Certificate PNG downloaded.');
    } catch (exportError: any) {
      setError(exportError?.message || 'Unable to export certificate.');
    } finally {
      node.remove();
      setExportingDraftId('');
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
          <h1 className="mt-2 text-2xl font-black text-gray-950">Awards studio</h1>
          <p className="mt-1 text-sm font-semibold text-gray-500">Create drafts, generate AI narratives, review, publish, and export certificates.</p>
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
              <div className="mt-1 text-sm font-semibold text-gray-500">Drafts save first. Parents see nothing until you review and publish.</div>
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
            <label className="block md:col-span-2">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Frame purchase link</span>
              <input
                type="url"
                value={shared.framePurchaseLink}
                onChange={(event) => setShared((current) => current ? { ...current, framePurchaseLink: event.target.value } : current)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                placeholder="https://frames.example.com/team-store"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Narrative tone</span>
              <input
                value={shared.descriptionTone}
                onChange={(event) => setShared((current) => current ? { ...current, descriptionTone: event.target.value } : current)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                placeholder="celebratory and specific"
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
            {drafts.length
              ? 'AI narratives are editable. Confirm review before publishing to parents.'
              : 'Create drafts first, then AI narratives will appear here for review before publish.'}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className="primary-button" disabled={saving || generating || publishing || selectedPlayers.length === 0} onClick={() => void onSaveDrafts()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Award className="h-4 w-4" aria-hidden="true" />}
              Create drafts & AI narratives
            </button>
          </div>

          {drafts.length ? (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-black text-gray-950">Review narratives</div>
                  <div className="mt-1 text-sm font-semibold text-gray-500">{exportableDrafts.length} selected for publish/export</div>
                </div>
                <button
                  type="button"
                  className="ghost-button !min-h-9 text-xs"
                  disabled={generating || publishing}
                  onClick={() => void onRegenerateAllDrafts()}
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                  Regenerate all
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {drafts.map((draft) => (
                  <div key={draft.id} className="rounded-2xl border border-gray-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex min-w-0 items-center gap-3 text-sm font-black text-gray-950">
                        <input
                          type="checkbox"
                          checked={draft.includeInExport !== false}
                          onChange={(event) => updateDraft(draft.id, { includeInExport: event.target.checked })}
                        />
                        <span className="truncate">{draft.recipientName}</span>
                      </label>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${draft.status === 'published' ? 'bg-emerald-100 text-emerald-700' : draft.descriptionStatus === 'error' ? 'bg-rose-100 text-rose-700' : draft.descriptionStatus === 'ready' ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-800'}`}>
                        {draft.status === 'published' ? 'Published' : draft.descriptionStatus === 'pending' ? 'Writing' : draft.descriptionStatus === 'needs-review' ? 'Review' : draft.descriptionStatus === 'error' ? 'Needs review' : 'Ready'}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                      <label className="block">
                        <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Award title</span>
                        <input
                          value={draft.awardTitle}
                          onChange={(event) => updateDraft(draft.id, { awardTitle: event.target.value })}
                          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Narrative</span>
                        <textarea
                          value={draft.description}
                          maxLength={350}
                          onChange={(event) => updateDraft(draft.id, {
                            description: event.target.value,
                            descriptionSource: 'manual',
                            descriptionStatus: 'ready',
                            errorMessage: null
                          })}
                          className="mt-1 min-h-28 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold leading-5 text-gray-900"
                          placeholder={draft.descriptionStatus === 'pending' ? 'AI narrative is being written...' : 'Add certificate narrative'}
                        />
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs font-bold text-gray-500">
                          <span>{draft.description.length}/350</span>
                          {draft.errorMessage ? <span className="text-rose-700">{draft.errorMessage}</span> : null}
                        </div>
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="ghost-button !min-h-9 text-xs" disabled={generating || publishing} onClick={() => void onRegenerateDraft(draft)}>
                        <RefreshCw className={`h-4 w-4 ${generating && draft.descriptionStatus === 'pending' ? 'animate-spin' : ''}`} aria-hidden="true" />
                        Regenerate
                      </button>
                      <button type="button" className="ghost-button !min-h-9 text-xs" disabled={exportingDraftId === draft.id || generating} onClick={() => void onExportDraft(draft)}>
                        {exportingDraftId === draft.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                        Export PNG
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <label className="flex items-start gap-3 text-sm font-bold text-emerald-950">
                  <input
                    type="checkbox"
                    checked={reviewConfirmed}
                    onChange={(event) => setReviewConfirmed(event.target.checked)}
                    className="mt-1"
                  />
                  <span>I reviewed these certificate descriptions and they are ready for parents.</span>
                </label>
                {blockedPublishDrafts.length ? (
                  <div className="mt-2 text-xs font-bold text-amber-900">
                    Fix or manually review {blockedPublishDrafts.length} selected certificate{blockedPublishDrafts.length === 1 ? '' : 's'} marked Needs review or Error before publishing.
                  </div>
                ) : null}
                <button type="button" className="primary-button mt-3" disabled={!canPublishDrafts} onClick={() => void onPublishDrafts()}>
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                  Publish selected
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="app-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Preview</div>
              <div className="mt-1 text-sm font-semibold text-gray-500">Uses the same certificate renderer as the website studio.</div>
            </div>
            <select
              value={previewDraft?.playerId || previewPlayer?.id || ''}
              onChange={(event) => setPreviewPlayerId(event.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
              disabled={(drafts.length ? drafts : selectedPlayers).length === 0}
            >
              {drafts.length
                ? drafts.map((draft) => <option key={draft.id} value={draft.playerId}>{draft.recipientName}</option>)
                : (selectedPlayers.length ? selectedPlayers : model.players).map((player) => (
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

function ensureCertificateExportRoot() {
  let root = document.getElementById('app-certificate-export-root') as HTMLDivElement | null;
  if (root) return root;
  root = document.createElement('div');
  root.id = 'app-certificate-export-root';
  root.style.position = 'fixed';
  root.style.left = '-10000px';
  root.style.top = '0';
  root.style.width = '2050px';
  root.style.height = '1153px';
  root.style.pointerEvents = 'none';
  root.setAttribute('aria-hidden', 'true');
  document.body.appendChild(root);
  return root;
}
