import { ArrowLeft, Camera, ImagePlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    acquireTrackStatsheetPhoto,
    analyzeTrackStatsheetPhoto,
    applyTrackStatsheetImportForApp,
    loadTrackStatsheetGameContext,
    type TrackStatsheetGameContext,
    type TrackStatsheetReviewRow
} from '../lib/trackStatsheetService';
import type { AuthState } from '../lib/types';

export function TrackStatsheetImport({ auth }: { auth: AuthState }) {
    const { teamId = '', eventId = '' } = useParams();
    const navigate = useNavigate();
    const [context, setContext] = useState<TrackStatsheetGameContext | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statSheetFile, setStatSheetFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisReady, setAnalysisReady] = useState(false);
    const [homeRows, setHomeRows] = useState<TrackStatsheetReviewRow[]>([]);
    const [visitorRows, setVisitorRows] = useState<TrackStatsheetReviewRow[]>([]);
    const [homeScore, setHomeScore] = useState(0);
    const [awayScore, setAwayScore] = useState(0);
    const [matchHint, setMatchHint] = useState('Scores default to the stat sheet totals. Edit if needed.');
    const [applyStatus, setApplyStatus] = useState('');
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        void loadTrackStatsheetGameContext(teamId, eventId)
            .then((nextContext) => {
                if (!active) return;
                setContext(nextContext);
            })
            .catch((loadError: any) => {
                if (!active) return;
                setError(loadError?.message || 'Unable to load this game.');
            })
            .finally(() => {
                if (!active) return;
                setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [teamId, eventId]);

    useEffect(() => {
        if (!previewUrl) return undefined;
        return () => URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    const rosterOptions = useMemo(() => context?.roster || [], [context]);

    const setSelectedFile = (file: File | null) => {
        setStatSheetFile(file);
        setAnalysisReady(false);
        setApplyStatus('');
        setHomeRows([]);
        setVisitorRows([]);
        setHomeScore(0);
        setAwayScore(0);
        setMatchHint('Scores default to the stat sheet totals. Edit if needed.');
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl('');
        }
        if (file) {
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleAcquirePhoto = async (source: 'camera' | 'photos') => {
        try {
            const file = await acquireTrackStatsheetPhoto(source);
            setSelectedFile(file);
        } catch (acquireError: any) {
            setError(acquireError?.message || 'Unable to get a stat sheet photo.');
        }
    };

    const handleAnalyze = async () => {
        if (!statSheetFile || !context) {
            setError('Choose a stat sheet image first.');
            return;
        }
        setAnalyzing(true);
        setError(null);
        setApplyStatus('');
        try {
            const analysis = await analyzeTrackStatsheetPhoto(statSheetFile, context.roster);
            setHomeRows(analysis.homeRows);
            setVisitorRows(analysis.visitorRows);
            setHomeScore(analysis.homeScore);
            setAwayScore(analysis.awayScore);
            setAnalysisReady(true);
            setMatchHint(
                analysis.homeMatches || analysis.visitorMatches
                    ? `Roster matches: home ${analysis.homeMatches}, visitor ${analysis.visitorMatches}.`
                    : 'No confident roster matches yet. Review every row before applying.'
            );
        } catch (analysisError: any) {
            setError(analysisError?.message || 'Unable to analyze the stat sheet.');
        } finally {
            setAnalyzing(false);
        }
    };

    const updateHomeRow = (index: number, patch: Partial<TrackStatsheetReviewRow>) => {
        setHomeRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
    };

    const updateVisitorRow = (index: number, patch: Partial<TrackStatsheetReviewRow>) => {
        setVisitorRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
    };

    const handleApply = async () => {
        if (!context) return;
        setApplying(true);
        setError(null);
        setApplyStatus('Applying stats…');
        try {
            const result = await applyTrackStatsheetImportForApp({
                teamId: context.teamId,
                gameId: context.gameId,
                roster: context.roster,
                columns: context.columns,
                homeRows,
                visitorRows,
                homeScore,
                awayScore,
                statSheetFile,
                currentPhotoUrl: context.currentPhotoUrl
            });
            if (result.cancelled) {
                setApplyStatus('Cancelled.');
                return;
            }
            setApplyStatus('Stats saved. Returning to the game hub…');
            navigate(`/schedule/${context.teamId}/${context.gameId}`, {
                replace: true,
                state: {
                    statsheetImported: true
                }
            });
        } catch (applyError: any) {
            setError(applyError?.message || 'Unable to apply stats.');
            setApplyStatus('');
        } finally {
            setApplying(false);
        }
    };

    if (loading) {
        return <div className="app-card p-4 text-sm font-semibold text-gray-600">Loading statsheet import…</div>;
    }

    if (error && !context) {
        return <div className="app-card p-4 text-sm font-semibold text-rose-700">{error}</div>;
    }

    if (!context) {
        return <div className="app-card p-4 text-sm font-semibold text-rose-700">Game not found.</div>;
    }

    return (
        <div className="space-y-4">
            <Link to={`/schedule/${context.teamId}/${context.gameId}`} className="ghost-button">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to game
            </Link>

            <section className="app-card p-4">
                <div className="text-xs font-black uppercase tracking-[0.04em] text-primary-700">Photo Score Sheet</div>
                <h1 className="mt-2 text-2xl font-black text-gray-950">{context.teamName} vs {context.opponent}</h1>
                <div className="mt-1 text-sm font-semibold text-gray-500">Capture or choose a score sheet, review every row, then apply the same statsheet logic used on the web flow.</div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="primary-button" onClick={() => void handleAcquirePhoto('camera')}>
                        <Camera className="h-4 w-4" aria-hidden="true" />
                        Take photo
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleAcquirePhoto('photos')}>
                        <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        Choose from library
                    </button>
                    <label className="secondary-button cursor-pointer">
                        Upload file
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                        />
                    </label>
                </div>

                {previewUrl ? (
                    <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-3">
                        <img src={previewUrl} alt="Stat sheet preview" className="max-h-[420px] w-full rounded-xl object-contain" />
                    </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button type="button" className="primary-button" onClick={() => void handleAnalyze()} disabled={!statSheetFile || analyzing}>
                        {analyzing ? 'Analyzing photo' : 'Analyze photo'}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setSelectedFile(null)} disabled={!statSheetFile || analyzing || applying}>
                        Clear
                    </button>
                    <span className="text-sm font-semibold text-gray-500">{analyzing ? 'Extracting rows from the score sheet…' : matchHint}</span>
                </div>
                {error ? <div className="mt-3 text-sm font-semibold text-rose-700">{error}</div> : null}
            </section>

            {analysisReady ? (
                <>
                    <section className="app-card p-4">
                        <h2 className="text-lg font-black text-gray-950">Review scores</h2>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="text-sm font-semibold text-gray-700">
                                Home final
                                <input type="number" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" value={homeScore} onChange={(event) => setHomeScore(Number(event.target.value || 0))} />
                            </label>
                            <label className="text-sm font-semibold text-gray-700">
                                Visitor final
                                <input type="number" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" value={awayScore} onChange={(event) => setAwayScore(Number(event.target.value || 0))} />
                            </label>
                        </div>
                    </section>

                    <ReviewTable title={context.teamName} rows={homeRows} roster={rosterOptions} onChange={updateHomeRow} homeSide />
                    <ReviewTable title={context.opponent || 'Visitor'} rows={visitorRows} roster={[]} onChange={updateVisitorRow} homeSide={false} />

                    <section className="app-card p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-gray-500">{applyStatus || 'Applying replaces any existing tracked data for this game, matching the legacy flow.'}</div>
                            <button type="button" className="primary-button" onClick={() => void handleApply()} disabled={applying}>
                                {applying ? 'Applying stats' : 'Apply to game'}
                            </button>
                        </div>
                    </section>
                </>
            ) : null}
        </div>
    );
}

function ReviewTable({
    title,
    rows,
    roster,
    onChange,
    homeSide
}: {
    title: string;
    rows: TrackStatsheetReviewRow[];
    roster: TrackStatsheetGameContext['roster'];
    onChange: (index: number, patch: Partial<TrackStatsheetReviewRow>) => void;
    homeSide: boolean;
}) {
    return (
        <section className="app-card p-4">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-gray-950">{title}</h2>
                <div className="text-xs font-semibold text-gray-500">{homeSide ? 'Map every included row to a roster player or exclude it.' : 'Visitor rows save into opponent stats.'}</div>
            </div>
            <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                    <thead className="bg-gray-50 text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">
                        <tr>
                            <th className="px-3 py-3 text-left">Include</th>
                            <th className="px-3 py-3 text-left">#</th>
                            <th className="px-3 py-3 text-left">Name</th>
                            <th className="px-3 py-3 text-center">PTS</th>
                            <th className="px-3 py-3 text-center">Fouls</th>
                            {homeSide ? <th className="px-3 py-3 text-left">Roster match</th> : null}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {rows.map((row, index) => (
                            <tr key={`${title}-${index}`}>
                                <td className="px-3 py-3">
                                    <input type="checkbox" checked={row.include} onChange={(event) => onChange(index, { include: event.target.checked })} />
                                </td>
                                <td className="px-3 py-3">
                                    <input type="text" className="w-16 rounded-lg border border-gray-200 px-2 py-1" value={row.number} onChange={(event) => onChange(index, { number: event.target.value })} />
                                </td>
                                <td className="px-3 py-3">
                                    <input type="text" className="w-full rounded-lg border border-gray-200 px-2 py-1" value={row.name} onChange={(event) => onChange(index, { name: event.target.value })} />
                                </td>
                                <td className="px-3 py-3 text-center">
                                    <input type="number" className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-center" value={row.totalPoints} onChange={(event) => onChange(index, { totalPoints: Number(event.target.value || 0) })} />
                                </td>
                                <td className="px-3 py-3 text-center">
                                    <input type="number" className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-center" value={row.fouls} onChange={(event) => onChange(index, { fouls: Number(event.target.value || 0) })} />
                                </td>
                                {homeSide ? (
                                    <td className="px-3 py-3">
                                        <select className="w-full rounded-lg border border-gray-200 px-2 py-1" value={row.mappedPlayerId} onChange={(event) => onChange(index, { mappedPlayerId: event.target.value })}>
                                            <option value="">Unmatched</option>
                                            {roster.map((player) => (
                                                <option key={player.id} value={player.id}>{`#${player.number || '-'} ${player.name}`}</option>
                                            ))}
                                        </select>
                                    </td>
                                ) : null}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
