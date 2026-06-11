import { getConfigs, getGame, getPlayers, getTeam, uploadStatSheetPhoto } from '../../../../js/db.js';
import { db, collection, deleteDoc, doc, getDocs, writeBatch } from '../../../../js/firebase.js';
import { getApp } from '../../../../js/vendor/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from '../../../../js/vendor/firebase-ai.js';
import { acquireProfilePhoto, type ProfilePhotoSource } from './profileService';
import { buildTrackStatsheetApplyPlan, validateTrackStatsheetApplyRows } from '../../../../js/track-statsheet-apply.js';
import type { AuthUser } from './types';

const defaultTrackStatsheetColumns = ['PTS', 'REB', 'AST', 'STL', 'TO'];

export type TrackStatsheetRosterPlayer = {
    id: string;
    name: string;
    number?: string | number | null;
    active?: boolean;
    archived?: boolean;
    status?: string | null;
};

export type TrackStatsheetReviewRow = {
    number: string;
    name: string;
    fouls: number;
    totalPoints: number;
    include: boolean;
    mappedPlayerId: string;
};

export type TrackStatsheetGameContext = {
    teamId: string;
    gameId: string;
    teamName: string;
    opponent: string;
    date: Date | string | null;
    currentPhotoUrl?: string | null;
    columns: string[];
    roster: TrackStatsheetRosterPlayer[];
};

export type TrackStatsheetAnalysisResult = {
    homeRows: TrackStatsheetReviewRow[];
    visitorRows: TrackStatsheetReviewRow[];
    homeScore: number;
    awayScore: number;
    isSwapped: boolean;
    homeMatches: number;
    visitorMatches: number;
};

export type TrackStatsheetApplyResult = {
    cancelled: boolean;
    statSheetPhotoUrl: string | null;
};

export async function loadTrackStatsheetGameContext(teamId: string, gameId: string): Promise<TrackStatsheetGameContext> {
    if (!teamId || !gameId) {
        throw new Error('Team and game are required.');
    }

    const [team, game, players, configs] = await Promise.all([
        getTeam(teamId, { includeInactive: true }),
        getGame(teamId, gameId),
        getPlayers(teamId, { includeInactive: true }),
        getConfigs(teamId).catch(() => [])
    ]);

    if (!team) {
        throw new Error('Team not found.');
    }
    if (!game) {
        throw new Error('Game not found.');
    }

    const resolvedConfig = Array.isArray(configs)
        ? configs.find((entry: any) => String(entry?.id || '') === String(game?.statTrackerConfigId || ''))
        : null;

    return {
        teamId,
        gameId,
        teamName: String(team.name || 'Team'),
        opponent: String(game.opponent || 'Opponent'),
        date: game.date || null,
        currentPhotoUrl: game.statSheetPhotoUrl ? String(game.statSheetPhotoUrl) : '',
        columns: Array.isArray(resolvedConfig?.columns) && resolvedConfig.columns.length ? resolvedConfig.columns : defaultTrackStatsheetColumns,
        roster: (Array.isArray(players) ? players : []).filter(isActiveRosterPlayer).map((player: any) => ({
            id: String(player.id || ''),
            name: String(player.name || 'Player'),
            number: player.number ?? ''
        }))
    };
}

export async function acquireTrackStatsheetPhoto(source: ProfilePhotoSource): Promise<File> {
    return acquireProfilePhoto(source);
}

export async function analyzeTrackStatsheetPhoto(file: File, roster: TrackStatsheetRosterPlayer[]): Promise<TrackStatsheetAnalysisResult> {
    const model = getTrackStatsheetModel();
    const imagePart = await fileToGenerativePart(file);
    const result = await model.generateContent([buildTrackStatsheetPrompt(), imagePart]);
    const responseText = compactText(result?.response?.text?.() || '');
    const response = JSON.parse(responseText || '{}');

    const parsedHomeRows = (Array.isArray(response.homePlayers) ? response.homePlayers : [])
        .map((row) => sanitizeTrackStatsheetRow(row))
        .filter((row) => row.name || row.number || row.totalPoints || row.fouls);
    const parsedVisitorRows = (Array.isArray(response.visitorPlayers) ? response.visitorPlayers : [])
        .map((row) => sanitizeTrackStatsheetRow(row))
        .filter((row) => row.name || row.number || row.totalPoints || row.fouls);

    const homeMatches = countRosterMatches(parsedHomeRows, roster);
    const visitorMatches = countRosterMatches(parsedVisitorRows, roster);
    const shouldSwap = visitorMatches > homeMatches;

    return {
        homeRows: autoAssignRosterMatches(shouldSwap ? parsedVisitorRows : parsedHomeRows, roster),
        visitorRows: shouldSwap ? parsedHomeRows : parsedVisitorRows,
        homeScore: toNumber(response?.scores?.homeFinal),
        awayScore: toNumber(response?.scores?.visitorFinal),
        isSwapped: shouldSwap,
        homeMatches,
        visitorMatches
    };
}

export async function applyTrackStatsheetImportForApp({
    teamId,
    gameId,
    roster,
    columns,
    homeRows,
    visitorRows,
    homeScore,
    awayScore,
    statSheetFile,
    currentPhotoUrl,
    confirmReplace
}: {
    teamId: string;
    gameId: string;
    roster: TrackStatsheetRosterPlayer[];
    columns: string[];
    homeRows: TrackStatsheetReviewRow[];
    visitorRows: TrackStatsheetReviewRow[];
    homeScore: number;
    awayScore: number;
    statSheetFile: File | null;
    currentPhotoUrl?: string | null;
    confirmReplace?: (message: string) => boolean | Promise<boolean>;
}): Promise<TrackStatsheetApplyResult> {
    const includedVisitor = visitorRows.filter((row) => row.include);
    const validation = validateTrackStatsheetApplyRows(homeRows);
    if (!validation.ok) {
        throw new Error(validation.alertMessage || 'Review the home rows before applying stats.');
    }

    let statSheetPhotoUrl = compactText(currentPhotoUrl || '') || null;
    if (statSheetFile) {
        statSheetPhotoUrl = await uploadStatSheetPhoto(teamId, statSheetFile);
    }

    const [eventsSnap, statsSnap] = await Promise.all([
        getDocs(collection(db, `teams/${teamId}/games/${gameId}/events`)),
        getDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`))
    ]);

    if (eventsSnap.size > 0 || statsSnap.size > 0) {
        const approved = await Promise.resolve((confirmReplace || ((message) => window.confirm(message)))(
            'This game already has tracked data. Replace it with the stat sheet results?'
        ));
        if (!approved) {
            return { cancelled: true, statSheetPhotoUrl };
        }
        await Promise.all([
            ...eventsSnap.docs.map((documentSnapshot: any) => deleteDoc(documentSnapshot.ref)),
            ...statsSnap.docs.map((documentSnapshot: any) => deleteDoc(documentSnapshot.ref))
        ]);
    }

    const applyPlan = buildTrackStatsheetApplyPlan({
        includedHome: validation.includedHome,
        includedVisitor,
        roster,
        columns,
        homeScore,
        awayScore,
        statSheetPhotoUrl
    });

    const batch = writeBatch(db);
    applyPlan.aggregatedStatsWrites.forEach(({ playerId, data }: { playerId: string; data: Record<string, unknown> }) => {
        batch.set(doc(db, `teams/${teamId}/games/${gameId}/aggregatedStats`, playerId), data);
    });
    batch.update(doc(db, `teams/${teamId}/games`, gameId), applyPlan.gameUpdate);
    await batch.commit();

    return {
        cancelled: false,
        statSheetPhotoUrl
    };
}

export function autoAssignRosterMatches(rows: TrackStatsheetReviewRow[], roster: TrackStatsheetRosterPlayer[]) {
    const usedIds = new Set<string>();
    return rows.map((row) => {
        const mappedPlayerId = pickRosterMatch(row, roster, usedIds);
        if (mappedPlayerId) {
            usedIds.add(mappedPlayerId);
        }
        return {
            ...row,
            mappedPlayerId
        };
    });
}

export function countRosterMatches(rows: TrackStatsheetReviewRow[], roster: TrackStatsheetRosterPlayer[]) {
    const usedIds = new Set<string>();
    let count = 0;
    rows.forEach((row) => {
        const mappedPlayerId = pickRosterMatch(row, roster, usedIds);
        if (mappedPlayerId) {
            usedIds.add(mappedPlayerId);
            count += 1;
        }
    });
    return count;
}

export function sanitizeTrackStatsheetRow(row: Record<string, any>): TrackStatsheetReviewRow {
    const totalPoints = Number.isFinite(Number(row?.totalPoints))
        ? Number(row.totalPoints)
        : toNumber(row?.firstHalfPoints) + toNumber(row?.secondHalfPoints) + toNumber(row?.otPoints);

    return {
        number: compactText(row?.number),
        name: compactText(row?.name),
        fouls: clampFouls(row?.fouls),
        totalPoints: toNumber(totalPoints),
        include: true,
        mappedPlayerId: ''
    };
}

function pickRosterMatch(row: Pick<TrackStatsheetReviewRow, 'name' | 'number'>, roster: TrackStatsheetRosterPlayer[], usedIds: Set<string>) {
    const normalizedNumber = normalizeNumber(row.number);
    if (normalizedNumber) {
        const matches = roster.filter((player) => normalizeNumber(player.number) === normalizedNumber && !usedIds.has(player.id));
        if (matches.length === 1) {
            return matches[0].id;
        }
    }

    const normalizedName = normalizeName(row.name);
    if (!normalizedName) {
        return '';
    }

    const nameTokens = normalizedName.split(' ').filter(Boolean);
    const lastName = nameTokens[nameTokens.length - 1] || '';
    const matches = roster.filter((player) => {
        if (usedIds.has(player.id)) return false;
        const rosterName = normalizeName(player.name);
        if (!rosterName) return false;
        if (rosterName === normalizedName) return true;
        if (normalizedName.length > 2 && rosterName.includes(normalizedName)) return true;
        if (lastName && rosterName.includes(lastName)) return true;
        return false;
    });

    return matches.length === 1 ? matches[0].id : '';
}

function getTrackStatsheetModel() {
    const firebaseApp = getApp();
    const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    return getGenerativeModel(ai, {
        model: 'gemini-2.5-flash',
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: Schema.object({
                properties: {
                    scores: Schema.object({
                        properties: {
                            homeFinal: Schema.number(),
                            visitorFinal: Schema.number()
                        },
                        optionalProperties: ['homeFinal', 'visitorFinal']
                    }),
                    homePlayers: Schema.array({
                        items: Schema.object({
                            properties: {
                                number: Schema.string(),
                                name: Schema.string(),
                                fouls: Schema.number(),
                                firstHalfPoints: Schema.number(),
                                secondHalfPoints: Schema.number(),
                                otPoints: Schema.number(),
                                totalPoints: Schema.number()
                            },
                            optionalProperties: ['number', 'name', 'fouls', 'firstHalfPoints', 'secondHalfPoints', 'otPoints', 'totalPoints']
                        })
                    }),
                    visitorPlayers: Schema.array({
                        items: Schema.object({
                            properties: {
                                number: Schema.string(),
                                name: Schema.string(),
                                fouls: Schema.number(),
                                firstHalfPoints: Schema.number(),
                                secondHalfPoints: Schema.number(),
                                otPoints: Schema.number(),
                                totalPoints: Schema.number()
                            },
                            optionalProperties: ['number', 'name', 'fouls', 'firstHalfPoints', 'secondHalfPoints', 'otPoints', 'totalPoints']
                        })
                    })
                },
                optionalProperties: ['scores', 'homePlayers', 'visitorPlayers']
            })
        }
    });
}

function buildTrackStatsheetPrompt() {
    return `You are reading a basketball official scoresheet photo. Extract stats in strict JSON.

SHEET LAYOUT RULES:
- The home team roster table is on the LEFT. The visitor team roster table is on the RIGHT.
- Each roster table has columns: No, Name, Fouls, 1st Half Scoring, 2nd Half Scoring, Overtime, Total Pts.
- Fouls are tally marks inside the FOULS column boxes. Count only those marks.
- Fouls per player should be 0-5. If unclear, prefer the lower count.
- Use the Total Pts column when present. If it is blank, sum the 1st half, 2nd half, and overtime tallies.
- The score box includes Final scores for Home and Visitor.
- Ignore running score grids, timeouts, and technicals.

RETURN JSON:
- homePlayers and visitorPlayers should include number, name, fouls, totalPoints.
- scores should include homeFinal and visitorFinal if present.
- Use 0 when a numeric value is blank.`;
}

async function fileToGenerativePart(file: File) {
    const data = await fileToBase64(file);
    return {
        inlineData: {
            data,
            mimeType: file.type || 'image/png'
        }
    };
}

async function fileToBase64(file: File): Promise<string> {
    if (typeof FileReader !== 'undefined') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '');
            reader.onerror = () => reject(new Error('Could not read the stat sheet image.'));
            reader.readAsDataURL(file);
        });
    }

    const buffer = await file.arrayBuffer();
    let binary = '';
    new Uint8Array(buffer).forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

function isActiveRosterPlayer(player: TrackStatsheetRosterPlayer) {
    return player?.active !== false && player?.archived !== true && (!player?.status || player.status === 'active');
}

function normalizeNumber(value: unknown) {
    return compactText(value).replace(/\s+/g, '');
}

function normalizeName(value: unknown) {
    return compactText(value)
        .toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function clampFouls(value: unknown) {
    return Math.min(Math.max(toNumber(value), 0), 5);
}

function toNumber(value: unknown) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function compactText(value: unknown) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
