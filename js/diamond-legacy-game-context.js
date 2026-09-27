import {
    DIAMOND_PLAYER_STAT_CATALOG,
    getDiamondPublicPlayerStatsCollectionPath,
    isDiamondV2Game,
    readCoverageAwareStatDocument,
    resolveDiamondPublicStatDocuments
} from './diamond-stat-presentation.js?v=7';
import { loadCompleteDiamondReportEvents } from './diamond-report-events.js?v=1';

const MAX_PUBLIC_PLAYER_DOCUMENTS = 50;
const MAX_DIAMOND_LOAD_ATTEMPTS = 2;
const DEFAULT_EVENT_LIMIT = 40;
const DIAMOND_DERIVED_STAT_IDS = new Set(
    DIAMOND_PLAYER_STAT_CATALOG
        .filter((definition) => definition.formula)
        .map((definition) => definition.id)
);

function requireResourceId(value, label) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || id !== value || id.length > 128 || id.includes('/')) {
        throw new TypeError(`${label} must be nonempty, slash-free, and at most 128 characters.`);
    }
    return id;
}

function requireGame(game) {
    const gameId = requireResourceId(game?.id, 'Game ID');
    return { game, gameId };
}

function normalizeEventLimit(value) {
    const limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return DEFAULT_EVENT_LIMIT;
    return limit;
}

async function defaultLoadPublicDocuments({ collectionPath }) {
    const {
        collection,
        db,
        getDocs,
        limit: limitQuery,
        query
    } = await import('./firebase.js?v=33');
    const snapshot = await getDocs(query(
        collection(db, collectionPath),
        limitQuery(MAX_PUBLIC_PLAYER_DOCUMENTS + 1)
    ));
    return {
        documents: snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            data: docSnapshot.data()
        })),
        loadStatus: snapshot.metadata?.fromCache === true ? 'partial' : 'complete'
    };
}

async function defaultLoadCanonicalGame({ teamId, gameId }) {
    const { db, doc, getDoc } = await import('./firebase.js?v=33');
    const snapshot = await getDoc(doc(db, `teams/${teamId}/games`, gameId));
    return {
        game: snapshot.exists()
            ? { id: snapshot.id, ...(snapshot.data() || {}) }
            : null,
        loadStatus: snapshot.metadata?.fromCache === true ? 'partial' : 'complete'
    };
}

async function defaultCallableInvoker(name, payload) {
    const { functions, httpsCallable } = await import('./firebase.js?v=33');
    const response = await httpsCallable(functions, name)(payload);
    return response?.data;
}

function buildPlayerProjection(entry, game) {
    const data = entry.data;
    const view = readCoverageAwareStatDocument(data, game);
    const completeStatKeys = Object.keys(view.completeValues).sort();
    const omittedOrIncompleteStatKeys = data.publicStatIds
        .filter((key) => !completeStatKeys.includes(key))
        .sort();
    return Object.freeze({
        playerId: entry.id,
        playerName: data.playerName,
        playerNumber: data.playerNumber || null,
        participated: data.participated,
        participationStatus: data.participationStatus,
        stats: Object.freeze({ ...view.completeValues }),
        completeStatKeys: Object.freeze(completeStatKeys),
        omittedOrIncompleteStatKeys: Object.freeze(omittedOrIncompleteStatKeys),
        sourceRevision: view.sourceRevision,
        visibility: 'public'
    });
}

function completeDiamondStatsError(gameId, reason, cause = null) {
    const normalizedReason = reason || 'unknown';
    const inaccessible = normalizedReason === 'shared-game-source-not-owned';
    const error = new Error(inaccessible
        ? 'Player stats for this shared Diamond game belong to the other team’s scorebook and are unavailable for this team.'
        : `Unable to load complete public Diamond stats for game ${gameId}. Please retry.`);
    error.code = inaccessible ? 'diamond-public-stats-inaccessible' : 'diamond-public-stats-incomplete';
    error.reason = normalizedReason;
    error.retryable = !inaccessible;
    error.evidence = Object.freeze({
        complete: false,
        accessible: false,
        absenceConfirmed: false,
        visibility: 'unavailable',
        reason: error.reason,
        instructions: 'Unavailable Diamond stats are unknown. Do not infer absence or zero values.'
    });
    if (cause) error.cause = cause;
    return error;
}

function completeDiamondEventsError(gameId, cause = null) {
    const reason = cause?.reason || 'public-read-incomplete';
    const inaccessible = reason === 'shared-game-source-not-owned';
    const error = new Error(inaccessible
        ? 'The public replay for this shared Diamond game belongs to the other team’s scorebook and is unavailable for this team.'
        : `Unable to load complete public Diamond events for game ${gameId}. Please retry.`);
    error.code = inaccessible ? 'diamond-public-events-inaccessible' : 'diamond-public-events-incomplete';
    error.reason = reason;
    error.retryable = !inaccessible;
    error.evidence = Object.freeze({
        complete: false,
        accessible: false,
        absenceConfirmed: false,
        visibility: 'unavailable',
        reason: error.reason,
        instructions: 'Unavailable Diamond events are unknown. Do not infer absence.'
    });
    if (cause) error.cause = cause;
    return error;
}

function canonicalDiamondGameError(gameId, reason, cause = null) {
    const normalizedReason = reason || 'unknown';
    const inaccessible = normalizedReason === 'shared-game-source-not-owned';
    const error = new Error(inaccessible
        ? 'This shared Diamond game is backed by the other team’s scorebook.'
        : `Unable to resolve the authoritative Diamond game ${gameId}. Please retry.`);
    error.code = inaccessible ? 'diamond-authoritative-game-inaccessible' : 'diamond-authoritative-game-incomplete';
    error.reason = normalizedReason;
    error.retryable = !inaccessible;
    error.evidence = Object.freeze({
        complete: false,
        accessible: false,
        absenceConfirmed: false,
        visibility: 'unavailable',
        reason: error.reason
    });
    if (cause) error.cause = cause;
    return error;
}

async function resolveDiamondReadTarget({
    teamId,
    game,
    loadCanonicalGame = defaultLoadCanonicalGame
}) {
    const { gameId: requestedGameId } = requireGame(game);
    if (!isDiamondV2Game(game)) throw new TypeError('A Diamond game is required.');
    if (game?.isSharedGame !== true) {
        return Object.freeze({
            requestedGameId,
            teamId,
            gameId: requestedGameId,
            game
        });
    }

    const sourceTeamId = requireResourceId(game?.diamondSourceTeamId, 'Diamond source team ID');
    const sourceGameId = requireResourceId(game?.diamondSourceGameId, 'Diamond source game ID');
    if (sourceTeamId !== teamId) {
        throw canonicalDiamondGameError(requestedGameId, 'shared-game-source-not-owned');
    }
    if (typeof loadCanonicalGame !== 'function') {
        throw new TypeError('A canonical Diamond game loader is required.');
    }

    let lastReason = 'canonical-game-read-incomplete';
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_DIAMOND_LOAD_ATTEMPTS; attempt += 1) {
        try {
            const loaded = await loadCanonicalGame({ teamId: sourceTeamId, gameId: sourceGameId });
            if (loaded?.loadStatus !== 'complete') {
                lastReason = 'canonical-game-read-incomplete';
                continue;
            }
            const canonicalGame = loaded?.game;
            if (!canonicalGame || typeof canonicalGame !== 'object' || Array.isArray(canonicalGame)) {
                lastReason = 'canonical-game-missing';
                continue;
            }
            if (canonicalGame.id !== sourceGameId || !isDiamondV2Game(canonicalGame)) {
                lastReason = 'canonical-game-binding-mismatch';
                continue;
            }
            const collectionPath = getDiamondPublicPlayerStatsCollectionPath({
                teamId: sourceTeamId,
                gameId: sourceGameId,
                game: canonicalGame
            });
            if (!collectionPath) {
                lastReason = 'canonical-game-head-unavailable';
                continue;
            }
            return Object.freeze({
                requestedGameId,
                teamId: sourceTeamId,
                gameId: sourceGameId,
                game: canonicalGame,
                collectionPath
            });
        } catch (error) {
            lastError = error;
            lastReason = error?.reason || 'canonical-game-read-failed';
        }
    }
    throw canonicalDiamondGameError(requestedGameId, lastReason, lastError);
}

/**
 * Loads one generation-bound public Diamond player projection as an atomic
 * completeness unit. Partial results are discarded and retried; this helper
 * deliberately has no cache so a later unforced load can expand recovered data.
 */
export async function loadCompleteDiamondPublicPlayerStats({
    teamId,
    game,
    loadCanonicalGame = defaultLoadCanonicalGame,
    loadPublicDocuments = defaultLoadPublicDocuments
} = {}) {
    const normalizedTeamId = requireResourceId(teamId, 'Team ID');
    const { gameId: requestedGameId } = requireGame(game);
    if (!isDiamondV2Game(game)) throw new TypeError('A Diamond game is required.');
    if (typeof loadPublicDocuments !== 'function') throw new TypeError('A public Diamond stat loader is required.');

    let target;
    try {
        target = await resolveDiamondReadTarget({
            teamId: normalizedTeamId,
            game,
            loadCanonicalGame
        });
    } catch (error) {
        throw completeDiamondStatsError(requestedGameId, error?.reason || 'authoritative-head-unavailable', error);
    }
    const collectionPath = target.collectionPath || getDiamondPublicPlayerStatsCollectionPath({
        teamId: target.teamId,
        gameId: target.gameId,
        game: target.game
    });
    if (!collectionPath) throw completeDiamondStatsError(requestedGameId, 'authoritative-head-unavailable');

    let lastReason = 'public-read-incomplete';
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_DIAMOND_LOAD_ATTEMPTS; attempt += 1) {
        try {
            const loaded = await loadPublicDocuments({
                teamId: target.teamId,
                gameId: target.gameId,
                game: target.game,
                collectionPath,
                maximumDocuments: MAX_PUBLIC_PLAYER_DOCUMENTS
            });
            const resolved = resolveDiamondPublicStatDocuments({
                teamId: target.teamId,
                gameId: target.gameId,
                game: target.game,
                documents: loaded?.documents,
                loadStatus: loaded?.loadStatus
            });
            if (resolved.status === 'complete') {
                return Object.freeze({
                    gameId: target.requestedGameId,
                    canonicalGameId: target.gameId,
                    sourceTeamId: target.teamId,
                    players: Object.freeze(resolved.documents.map((entry) => buildPlayerProjection(entry, target.game))),
                    absenceConfirmed: resolved.absenceConfirmed,
                    complete: true,
                    visibility: 'public',
                    source: 'diamond-public-projection',
                    identity: resolved.identity
                });
            }
            lastReason = resolved.reason;
        } catch (error) {
            lastError = error;
            lastReason = 'public-read-failed';
        }
    }
    throw completeDiamondStatsError(requestedGameId, lastReason, lastError);
}

async function loadCompleteDiamondEvents({
    teamId,
    game,
    eventLimit,
    loadCanonicalGame,
    loadDiamondReportEvents
}) {
    const { gameId: requestedGameId } = requireGame(game);
    let target;
    try {
        target = await resolveDiamondReadTarget({ teamId, game, loadCanonicalGame });
    } catch (error) {
        throw completeDiamondEventsError(requestedGameId, error);
    }
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_DIAMOND_LOAD_ATTEMPTS; attempt += 1) {
        try {
            const result = await loadDiamondReportEvents({
                teamId: target.teamId,
                gameId: target.gameId,
                game: target.game,
                requestedVisibility: 'public',
                invoke: defaultCallableInvoker
            });
            if (!Array.isArray(result?.events) || result?.visibility !== 'public') {
                throw new Error('The Diamond public replay was incomplete.');
            }
            const bounded = result.events.slice(-eventLimit).reverse();
            return Object.freeze({
                events: Object.freeze(bounded),
                evidence: Object.freeze({
                    complete: true,
                    truncated: result.events.length > bounded.length,
                    absenceConfirmed: result.events.length === 0,
                    visibility: 'public',
                    source: result.source || 'public-sanitized'
                })
            });
        } catch (error) {
            lastError = error;
        }
    }
    throw completeDiamondEventsError(requestedGameId, lastError);
}

export async function loadCompleteGameStatsForAi({
    teamId,
    games = [],
    loadClassicAggregatedStats,
    loadCanonicalGame = defaultLoadCanonicalGame,
    loadPublicDocuments = defaultLoadPublicDocuments
} = {}) {
    const normalizedTeamId = requireResourceId(teamId, 'Team ID');
    if (!Array.isArray(games)) throw new TypeError('Games must be an array.');
    if (typeof loadClassicAggregatedStats !== 'function') {
        throw new TypeError('A classic aggregated-stat loader is required.');
    }
    const normalizedGames = games.map(({ ...game }) => requireGame(game).game);
    const classicGames = normalizedGames.filter((game) => !isDiamondV2Game(game));
    const diamondGames = normalizedGames.filter(isDiamondV2Game);
    const [classicTotalsByPlayer, diamondResults] = await Promise.all([
        classicGames.length > 0
            ? loadClassicAggregatedStats(normalizedTeamId, classicGames.map(({ id }) => id))
            : Promise.resolve({}),
        Promise.all(diamondGames.map((game) => loadCompleteDiamondPublicPlayerStats({
            teamId: normalizedTeamId,
            game,
            loadCanonicalGame,
            loadPublicDocuments
        })))
    ]);
    if (!classicTotalsByPlayer || typeof classicTotalsByPlayer !== 'object' || Array.isArray(classicTotalsByPlayer)) {
        throw new Error('The classic aggregated-stat response was malformed.');
    }

    const diamondPlayersByGame = Object.fromEntries(diamondResults.map((result) => [result.gameId, result.players]));
    const diamondEvidenceByGame = Object.fromEntries(diamondResults.map((result) => [result.gameId, Object.freeze({
        complete: true,
        absenceConfirmed: result.absenceConfirmed,
        visibility: result.visibility,
        source: result.source,
        sourceRevision: result.identity?.sourceRevision ?? null
    })]));
    return Object.freeze({
        classicTotalsByPlayer,
        diamondPlayersByGame: Object.freeze(diamondPlayersByGame),
        evidence: Object.freeze({
            complete: true,
            classicGameIds: Object.freeze(classicGames.map(({ id }) => id)),
            diamondGameIds: Object.freeze(diamondGames.map(({ id }) => id)),
            diamondByGame: Object.freeze(diamondEvidenceByGame),
            absenceConfirmed: Object.keys(classicTotalsByPlayer).length === 0
                && diamondResults.every((result) => result.absenceConfirmed),
            instructions: 'Do not combine classic totals with Diamond per-game values unless every required counter is complete. Omitted or incomplete Diamond counters are unknown, never zero.'
        })
    });
}

function numericStatEntries(stats, { excludedStatKeys = null } = {}) {
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return [];
    return Object.entries(stats).filter(([key, value]) => (
        !excludedStatKeys?.has(key)
        && Number.isFinite(Number(value))
    ));
}

function addNumericStats(target, stats, options = {}) {
    numericStatEntries(stats, options).forEach(([key, value]) => {
        target[key] = (Number(target[key]) || 0) + Number(value);
    });
}

function isNonAggregatableDiamondDerivedKey(key, players) {
    return DIAMOND_DERIVED_STAT_IDS.has(key) && players.some((player) => (
        player.completeStatKeys.includes(key)
        || player.omittedOrIncompleteStatKeys.includes(key)
    ));
}

/**
 * Builds the only totals shape accepted by certificate AI. Classic-only calls
 * retain the exact legacy object. Mixed/Diamond calls globally remove a stat
 * when any game in which that player participated lacks complete public
 * evidence for it, then attach an explicit unknown-not-zero boundary.
 */
export async function loadCompleteCertificateNarrativeStats({
    teamId,
    games = [],
    loadClassicAggregatedStats,
    loadCanonicalGame = defaultLoadCanonicalGame,
    loadPublicDocuments = defaultLoadPublicDocuments
} = {}) {
    const statsContext = await loadCompleteGameStatsForAi({
        teamId,
        games,
        loadClassicAggregatedStats,
        loadCanonicalGame,
        loadPublicDocuments
    });
    if (statsContext.evidence.diamondGameIds.length === 0) {
        return Object.freeze({
            totalsByPlayer: statsContext.classicTotalsByPlayer,
            statsEvidenceByPlayer: Object.freeze({}),
            promptEvidence: null
        });
    }

    const totalsByPlayer = {};
    const playerIds = new Set(Object.keys(statsContext.classicTotalsByPlayer));
    Object.values(statsContext.diamondPlayersByGame).forEach((players) => {
        players.forEach((player) => playerIds.add(player.playerId));
    });

    const statsEvidenceByPlayer = {};
    playerIds.forEach((playerId) => {
        const totals = {};
        addNumericStats(totals, statsContext.classicTotalsByPlayer[playerId]);
        const participatingDiamondPlayers = [];
        Object.values(statsContext.diamondPlayersByGame).forEach((players) => {
            const player = players.find((candidate) => candidate.playerId === playerId);
            if (!player?.participated) return;
            participatingDiamondPlayers.push(player);
            addNumericStats(totals, player.stats, { excludedStatKeys: DIAMOND_DERIVED_STAT_IDS });
        });

        const candidateKeys = new Set(Object.keys(totals));
        participatingDiamondPlayers.forEach((player) => {
            player.completeStatKeys.forEach((key) => candidateKeys.add(key));
            player.omittedOrIncompleteStatKeys.forEach((key) => candidateKeys.add(key));
        });
        const omittedOrIncompleteStatKeys = [...candidateKeys]
            .filter((key) => (
                isNonAggregatableDiamondDerivedKey(key, participatingDiamondPlayers)
                || participatingDiamondPlayers.some((player) => !player.completeStatKeys.includes(key))
            ))
            .sort();
        omittedOrIncompleteStatKeys.forEach((key) => delete totals[key]);

        totalsByPlayer[playerId] = Object.freeze(totals);
        statsEvidenceByPlayer[playerId] = Object.freeze({
            complete: omittedOrIncompleteStatKeys.length === 0,
            visibility: 'public',
            completeStatKeys: Object.freeze(Object.keys(totals).sort()),
            omittedOrIncompleteStatKeys: Object.freeze(omittedOrIncompleteStatKeys),
            instructions: 'Only listed complete totals may be used. Omitted, incomplete, or non-aggregatable per-game Diamond values are unknown, never zero.'
        });
    });

    return Object.freeze({
        totalsByPlayer: Object.freeze(totalsByPlayer),
        statsEvidenceByPlayer: Object.freeze(statsEvidenceByPlayer),
        promptEvidence: Object.freeze({
            complete: true,
            visibility: 'public',
            source: 'mixed-classic-and-diamond-public-projection',
            classicGameIds: statsContext.evidence.classicGameIds,
            diamondGameIds: statsContext.evidence.diamondGameIds,
            diamondByGame: statsContext.evidence.diamondByGame,
            instructions: 'Only complete aggregatable public Diamond counters are included. Omitted, incomplete, and per-game derived values are unknown, never zero, and must not be inferred from missing totals.'
        })
    });
}

export async function loadCompleteGameEventsForAi({
    teamId,
    games = [],
    loadClassicGameEvents,
    loadCanonicalGame = defaultLoadCanonicalGame,
    loadDiamondReportEvents = loadCompleteDiamondReportEvents,
    eventLimit = DEFAULT_EVENT_LIMIT
} = {}) {
    const normalizedTeamId = requireResourceId(teamId, 'Team ID');
    if (!Array.isArray(games)) throw new TypeError('Games must be an array.');
    if (typeof loadClassicGameEvents !== 'function') throw new TypeError('A classic game-event loader is required.');
    if (typeof loadDiamondReportEvents !== 'function') throw new TypeError('A Diamond report-event loader is required.');
    const boundedLimit = normalizeEventLimit(eventLimit);

    const entries = await Promise.all(games.map(async (game) => {
        const { gameId } = requireGame(game);
        if (isDiamondV2Game(game)) {
            const result = await loadCompleteDiamondEvents({
                teamId: normalizedTeamId,
                game,
                eventLimit: boundedLimit,
                loadCanonicalGame,
                loadDiamondReportEvents
            });
            return [gameId, result];
        }
        const events = await loadClassicGameEvents(normalizedTeamId, gameId, { limit: boundedLimit });
        if (!Array.isArray(events)) throw new Error(`The classic event response for game ${gameId} was malformed.`);
        return [gameId, Object.freeze({
            events: Object.freeze(events.slice(0, boundedLimit)),
            evidence: Object.freeze({
                complete: null,
                truncated: events.length >= boundedLimit,
                absenceConfirmed: false,
                visibility: 'legacy-authorized',
                source: 'legacy-classic'
            })
        })];
    }));

    return Object.freeze({
        eventsByGame: Object.freeze(Object.fromEntries(entries.map(([gameId, result]) => [gameId, result.events]))),
        evidenceByGame: Object.freeze(Object.fromEntries(entries.map(([gameId, result]) => [gameId, result.evidence]))),
        evidence: Object.freeze({
            complete: true,
            instructions: 'Diamond replays are complete before bounding. A truncated result is not evidence that an omitted play does not exist.'
        })
    });
}

/**
 * Loads stats and events as one AI evidence unit. Callers must assign/cache only
 * this resolved value; any incomplete Diamond branch rejects the whole load.
 */
export async function loadCompleteAiGameContext({
    teamId,
    statsGames = [],
    eventGames = [],
    loadClassicAggregatedStats,
    loadClassicGameEvents,
    loadCanonicalGame = defaultLoadCanonicalGame,
    loadPublicDocuments = defaultLoadPublicDocuments,
    loadDiamondReportEvents = loadCompleteDiamondReportEvents,
    eventLimit = DEFAULT_EVENT_LIMIT
} = {}) {
    const [stats, events] = await Promise.all([
        loadCompleteGameStatsForAi({
            teamId,
            games: statsGames,
            loadClassicAggregatedStats,
            loadCanonicalGame,
            loadPublicDocuments
        }),
        loadCompleteGameEventsForAi({
            teamId,
            games: eventGames,
            loadClassicGameEvents,
            loadCanonicalGame,
            loadDiamondReportEvents,
            eventLimit
        })
    ]);
    return Object.freeze({
        stats,
        events,
        recentGameIds: Object.freeze(statsGames.map((game) => game?.id).filter(Boolean)),
        aggregatedStatsByPlayer: stats.classicTotalsByPlayer,
        diamondPlayerStatsByGame: stats.diamondPlayersByGame,
        recentEventsByGame: events.eventsByGame,
        evidence: Object.freeze({ complete: true, stats: stats.evidence, events: events.evidence })
    });
}

export async function loadCompletePlayerStatsForGames({
    teamId,
    games = [],
    playerId,
    loadClassicPlayerStats,
    loadCanonicalGame = defaultLoadCanonicalGame,
    loadPublicDocuments = defaultLoadPublicDocuments
} = {}) {
    const normalizedTeamId = requireResourceId(teamId, 'Team ID');
    const normalizedPlayerId = requireResourceId(playerId, 'Player ID');
    if (!Array.isArray(games)) throw new TypeError('Games must be an array.');
    if (typeof loadClassicPlayerStats !== 'function') throw new TypeError('A classic player-stat loader is required.');

    return Promise.all(games.map(async (game) => {
        const { gameId } = requireGame(game);
        if (!isDiamondV2Game(game)) {
            const stats = await loadClassicPlayerStats(normalizedTeamId, gameId, normalizedPlayerId);
            if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
                throw new Error(`The classic player-stat response for game ${gameId} was malformed.`);
            }
            return Object.freeze({
                game,
                stats,
                evidence: Object.freeze({
                    complete: true,
                    absenceConfirmed: Object.keys(stats).length === 0,
                    completeStatKeys: Object.freeze(Object.keys(stats).sort()),
                    omittedOrIncompleteStatKeys: Object.freeze([]),
                    source: 'legacy-classic'
                })
            });
        }

        const projection = await loadCompleteDiamondPublicPlayerStats({
            teamId: normalizedTeamId,
            game,
            loadCanonicalGame,
            loadPublicDocuments
        });
        const player = projection.players.find((candidate) => candidate.playerId === normalizedPlayerId);
        return Object.freeze({
            game,
            stats: player?.stats || Object.freeze({}),
            evidence: Object.freeze({
                complete: true,
                absenceConfirmed: !player,
                completeStatKeys: player?.completeStatKeys || Object.freeze([]),
                omittedOrIncompleteStatKeys: player?.omittedOrIncompleteStatKeys || Object.freeze([]),
                source: 'diamond-public-projection',
                visibility: 'public',
                sourceRevision: projection.identity?.sourceRevision ?? null
            })
        });
    }));
}

/**
 * Creates one durable athlete-season stat snapshot. A participating Diamond
 * game must provide complete public evidence for every total retained across
 * the season. Diamond projections intentionally contain no playing time, so a
 * mixed result carries null plus explicit incompleteness rather than zero.
 */
export async function loadCompleteAthleteProfileSeasonStats({
    teamId,
    games = [],
    playerId,
    loadClassicPlayerRecord,
    loadCanonicalGame = defaultLoadCanonicalGame,
    loadPublicDocuments = defaultLoadPublicDocuments
} = {}) {
    const normalizedTeamId = requireResourceId(teamId, 'Team ID');
    const normalizedPlayerId = requireResourceId(playerId, 'Player ID');
    if (!Array.isArray(games)) throw new TypeError('Games must be an array.');
    if (typeof loadClassicPlayerRecord !== 'function') {
        throw new TypeError('A classic player-record loader is required.');
    }
    const normalizedGames = games.map(({ ...game }) => requireGame(game).game);
    const classicGames = normalizedGames.filter((game) => !isDiamondV2Game(game));
    const diamondGames = normalizedGames.filter(isDiamondV2Game);

    const [classicRecords, diamondResults] = await Promise.all([
        Promise.all(classicGames.map(async (game) => {
            const record = await loadClassicPlayerRecord(normalizedTeamId, game.id, normalizedPlayerId);
            if (record === null || record === undefined) return { game, record: null };
            if (typeof record !== 'object' || Array.isArray(record)) {
                throw new Error(`The classic player-stat response for game ${game.id} was malformed.`);
            }
            const stats = record.stats || {};
            if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
                throw new Error(`The classic player-stat response for game ${game.id} was malformed.`);
            }
            return { game, record: { ...record, stats } };
        })),
        Promise.all(diamondGames.map(async (game) => ({
            game,
            projection: await loadCompleteDiamondPublicPlayerStats({
                teamId: normalizedTeamId,
                game,
                loadCanonicalGame,
                loadPublicDocuments
            })
        })))
    ]);

    let gamesPlayed = 0;
    let classicTotalTimeMs = 0;
    const statTotals = {};
    classicRecords.forEach(({ record }) => {
        if (!record) return;
        gamesPlayed += 1;
        classicTotalTimeMs += Number(record.timeMs) || 0;
        addNumericStats(statTotals, record.stats);
    });

    const participatingDiamondPlayers = [];
    const diamondByGame = {};
    diamondResults.forEach(({ game, projection }) => {
        const player = projection.players.find((candidate) => candidate.playerId === normalizedPlayerId) || null;
        diamondByGame[game.id] = Object.freeze({
            complete: true,
            absenceConfirmed: !player,
            participated: player?.participated === true,
            visibility: 'public',
            source: 'diamond-public-projection',
            sourceRevision: projection.identity?.sourceRevision ?? null,
            instanceId: projection.identity?.instanceId || null,
            checkpointHash: projection.identity?.checkpointHash || null,
            statConfigSnapshotHash: projection.identity?.statConfigSnapshotHash || null,
            projectionHash: projection.identity?.projectionHash || null
        });
        if (!player?.participated) return;
        gamesPlayed += 1;
        participatingDiamondPlayers.push({ game, player });
        addNumericStats(statTotals, player.stats, { excludedStatKeys: DIAMOND_DERIVED_STAT_IDS });
    });

    const candidateKeys = new Set(Object.keys(statTotals));
    participatingDiamondPlayers.forEach(({ player }) => {
        player.completeStatKeys.forEach((key) => candidateKeys.add(key));
        player.omittedOrIncompleteStatKeys.forEach((key) => candidateKeys.add(key));
    });
    const incompleteKeys = [...candidateKeys]
        .filter((key) => (
            isNonAggregatableDiamondDerivedKey(
                key,
                participatingDiamondPlayers.map(({ player }) => player)
            )
            || participatingDiamondPlayers.some(({ player }) => !player.completeStatKeys.includes(key))
        ))
        .sort();
    incompleteKeys.forEach((key) => delete statTotals[key]);

    if (diamondGames.length === 0) {
        return Object.freeze({ gamesPlayed, totalTimeMs: classicTotalTimeMs, statTotals });
    }

    const unavailableTimeGameIds = participatingDiamondPlayers.map(({ game }) => game.id);
    const playingTimeComplete = unavailableTimeGameIds.length === 0;
    return Object.freeze({
        gamesPlayed,
        totalTimeMs: playingTimeComplete ? classicTotalTimeMs : null,
        playingTimeComplete,
        statTotals: Object.freeze(statTotals),
        evidence: Object.freeze({
            complete: incompleteKeys.length === 0,
            readComplete: true,
            visibility: 'public',
            source: 'mixed-classic-and-diamond-public-projection',
            completeStatKeys: Object.freeze(Object.keys(statTotals).sort()),
            omittedOrIncompleteStatKeys: Object.freeze(incompleteKeys),
            classicGameIds: Object.freeze(classicGames.map(({ id }) => id)),
            diamondGameIds: Object.freeze(diamondGames.map(({ id }) => id)),
            diamondByGame: Object.freeze(diamondByGame),
            playingTime: Object.freeze({
                complete: playingTimeComplete,
                unavailableGameIds: Object.freeze(unavailableTimeGameIds),
                instructions: playingTimeComplete
                    ? 'Playing time is complete for this season.'
                    : 'Diamond public projections do not expose playing time. Missing minutes are unknown, never zero.'
            })
        })
    });
}

/**
 * Prevents zero-defaulting an observed, private, or otherwise omitted Diamond
 * counter. A projection-confirmed missing player is authoritative absence; a
 * present player requires complete evidence for every requested counter.
 */
export function assertCompletePlayerStatEvidence({
    evidence,
    requiredStatKeys = []
} = {}) {
    if (evidence?.source !== 'diamond-public-projection') return true;
    if (evidence.complete !== true) {
        throw new Error('Complete public Diamond stats are not available yet. Please retry.');
    }
    if (evidence.absenceConfirmed === true) return true;
    const completeKeys = new Set(Array.isArray(evidence.completeStatKeys) ? evidence.completeStatKeys : []);
    const missingKeys = [...new Set((Array.isArray(requiredStatKeys) ? requiredStatKeys : [])
        .map((statKey) => typeof statKey === 'string' ? statKey.trim() : '')
        .filter((statKey) => statKey && !completeKeys.has(statKey)))];
    if (missingKeys.length > 0) {
        throw new Error(`Complete public Diamond stats are unavailable for: ${missingKeys.join(', ')}. Please retry.`);
    }
    return true;
}
