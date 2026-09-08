import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { buildDiamondStatConfigSnapshotHash } from "../../js/diamond-stat-presentation.js";

const STORE_KEY = "__gamePostGameStatEditorStore";

function createScenario() {
  return {
    team: {
      id: "team-1",
      name: "Comets",
      ownerId: "owner-1",
      adminEmails: ["coach@example.com"],
      sport: "Basketball",
    },
    game: {
      id: "game-1",
      opponent: "Rockets",
      date: "2026-04-03",
      status: "completed",
      liveStatus: "completed",
      statTrackerConfigId: "cfg-1",
      homeScore: 38,
      awayScore: 32,
      opponentStats: {},
      summary: "Completed game.",
    },
    players: [
      { id: "p1", name: "Ava Cole", number: "3" },
      { id: "p2", name: "Mia Diaz", number: "5" },
    ],
    config: {
      id: "cfg-1",
      columns: ["PTS", "REB", "AST"],
      statDefinitions: [
        {
          id: "pts",
          label: "PTS",
          scope: "player",
          visibility: "public",
          type: "base",
        },
        {
          id: "reb",
          label: "REB",
          scope: "player",
          visibility: "public",
          type: "base",
        },
        {
          id: "ast",
          label: "AST",
          scope: "player",
          visibility: "public",
          type: "base",
        },
        {
          id: "effort",
          label: "EFFORT",
          scope: "player",
          visibility: "private",
          type: "base",
        },
        {
          id: "turnovers",
          label: "TURNOVERS",
          scope: "team",
          visibility: "public",
          type: "base",
        },
      ],
    },
    aggregatedStats: {
      p1: {
        playerName: "Ava Cole",
        playerNumber: "3",
        stats: { pts: 10, reb: 4, ast: 2 },
        timeMs: 540000,
        didNotPlay: false,
        participated: true,
      },
      p2: {
        playerName: "Mia Diaz",
        playerNumber: "5",
        stats: { pts: 6, reb: 1, ast: 3 },
        timeMs: 420000,
        didNotPlay: false,
        participated: true,
      },
    },
    privatePlayerStats: {
      p1: { stats: { effort: 7 } },
      p2: { stats: { effort: 5 } },
    },
    teamStats: { turnovers: 8 },
    setCompletedGamePlayerStatsCalls: [],
  };
}

function createManagerDiamondScenario() {
  const scenario = createScenario();
  scenario.team.sport = "Baseball";
  scenario.config = {
    id: "cfg-1",
    baseType: "Baseball",
    columns: ["H"],
    statDefinitions: [
      { id: "h", label: "Hits", scope: "player", visibility: "public" },
      { id: "pitches", label: "Pitch count", scope: "player", visibility: "private" },
      { id: "r", label: "Runs", scope: "team", visibility: "public" },
      { id: "lob", label: "Left on base", scope: "team", visibility: "private" },
    ],
  };
  const instanceId = "00000000-0000-4000-8000-000000000001";
  const checkpointHash = `sha256:${"a".repeat(64)}`;
  const configHash = buildDiamondStatConfigSnapshotHash({
    teamId: scenario.team.id,
    configId: scenario.config.id,
    config: scenario.config,
  });
  const projectionHash = `sha256:${"c".repeat(64)}`;
  scenario.game = {
    ...scenario.game,
    teamId: scenario.team.id,
    trackingEngine: "diamond-v2",
    diamondProjectionStatus: "current",
    diamondProjectionRevision: 8,
    diamondProjectionComplete: true,
    diamondScorebookInstanceId: instanceId,
    diamondProjectionCheckpointHash: checkpointHash,
    diamondStatConfigSnapshotHash: configHash,
    diamondProjectionHash: projectionHash,
    diamondPublicTeamStats: {
      trackingEngine: "diamond-v2",
      projectionSchemaVersion: 1,
      sourceRevision: 8,
      checkpointHash,
      coverage: { batting: "complete" },
      publicStatIds: ["r"],
      side: "home",
      complete: true,
      stats: { r: 4 },
      observedStats: {},
      statCoverage: { r: "complete" },
      teamId: scenario.team.id,
      diamondGameId: scenario.game.id,
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      statConfigSnapshotHash: configHash,
      projectionHash,
    },
  };
  const commonPlayer = {
    trackingEngine: "diamond-v2",
    projectionSchemaVersion: 1,
    playerId: "p1",
    playerName: "Ava At Game Time",
    playerNumber: "3",
    participated: true,
    participationStatus: "appeared",
    participationSource: "diamond-v2",
    sourceRevision: 8,
    checkpointHash,
    complete: true,
    coverage: { batting: "complete" },
    teamId: scenario.team.id,
    diamondGameId: scenario.game.id,
    instanceId,
    diamondScorebookInstanceId: instanceId,
    projectionGeneration: instanceId,
    statConfigSnapshotHash: configHash,
    projectionHash,
  };
  scenario.aggregatedStats = {
    p1: {
      schemaVersion: 1,
      ...commonPlayer,
      publicStatIds: ["h"],
      stats: { h: 2 },
      observedStats: {},
      derivedStats: {},
      observedDerivedStats: {},
      statCoverage: { h: "complete" },
      statSources: {},
      sourcePlayIds: [],
      unavailableDerivedStats: [],
      missingStatFamilies: [],
    },
    "manual-private-source-id": {
      schemaVersion: 1,
      ...commonPlayer,
      playerId: "manual-private-source-id",
      playerName: "Guest Public Identity",
      playerNumber: "18",
      publicStatIds: ["h"],
      stats: { h: 1 },
      observedStats: {},
      derivedStats: {},
      observedDerivedStats: {},
      statCoverage: { h: "complete" },
      statSources: {},
      sourcePlayIds: [],
      unavailableDerivedStats: [],
      missingStatFamilies: [],
    },
  };
  const privatePlayer = {
    ...commonPlayer,
    side: "home",
    authoritative: true,
    stats: { h: 2, pitches: 73 },
    observedStats: {},
    derivedStats: {},
    observedDerivedStats: {},
    statCoverage: { h: "complete", pitches: "complete" },
    unavailableDerivedStats: [],
    missingStatFamilies: [],
    statSources: {},
    sourcePlayIds: [],
  };
  const privateTeam = {
    trackingEngine: "diamond-v2",
    teamId: scenario.team.id,
    diamondGameId: scenario.game.id,
    side: "home",
    complete: true,
    projectionSchemaVersion: 1,
    instanceId,
    diamondScorebookInstanceId: instanceId,
    projectionGeneration: instanceId,
    sourceRevision: 8,
    checkpointHash,
    statConfigSnapshotHash: configHash,
    projectionHash,
    stats: { r: 4, lob: 5 },
    observedStats: {},
    statCoverage: { r: "complete", lob: "complete" },
    coverage: { batting: "complete" },
    inningLines: { home: [1, 0, 3], away: [0, 1, 0] },
  };
  scenario.managerStatsResponse = {
    schemaVersion: 1,
    trackingEngine: "diamond-v2",
    visibility: "manager-internal",
    status: "complete",
    complete: true,
    truncated: false,
    requestedGameCount: 1,
    requestedPlayerCount: 2,
    expectedDocumentCount: 2,
    documentCount: 2,
    missingDocumentCount: 0,
    absenceConfirmed: false,
    documents: [
      {
        gameId: scenario.game.id,
        playerId: "p1",
        data: { ...privatePlayer, timeMs: 540_000 },
      },
      {
        gameId: scenario.game.id,
        playerId: "manual-private-source-id",
        data: {
          ...privatePlayer,
          playerId: "manual-private-source-id",
          playerName: "Guest Private Identity",
          playerNumber: "18",
          stats: { h: 1, pitches: 41 },
          timeMs: 300_000,
        },
      },
    ],
    expectedTeamDocumentCount: 1,
    teamDocumentCount: 1,
    missingTeamDocumentCount: 0,
    teamDocuments: [{ gameId: scenario.game.id, data: privateTeam }],
    responseByteLimit: 7_000_000,
    responseByteCount: 2_048,
  };
  scenario.diamondReplay = {
    instanceId,
    game: { trackingEngine: "diamond-v2" },
    events: [{
      id: "event-8",
      revision: 8,
      inning: 4,
      half: "top",
      description: "Authorized replay event",
      createdAt: "2026-04-03T20:00:00.000Z",
      isCorrection: false,
      isScoringPlay: false,
      score: { home: 4, away: 1 },
    }],
    nextCursor: null,
    complete: true,
    truncated: false,
    sourceRevision: 8,
    projectionToken: `current:8:${projectionHash}`,
    diamondStats: { status: "complete" },
  };
  return scenario;
}

async function installMocks(
  page,
  scenario,
  {
    delayedAuth = false,
    controllableAuth = false,
    accessLevel = "full",
    directAccess = true,
  } = {},
) {
  await page.addInitScript(
    ({ storeKey, value }) => {
      localStorage.setItem(storeKey, JSON.stringify(value));
    },
    { storeKey: STORE_KEY, value: scenario },
  );

  await page.route("https://www.googletagmanager.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }),
  );

  const dbModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        }

        function saveStore(store) {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
        }

        function clone(value) {
            return JSON.parse(JSON.stringify(value));
        }

        function currentActorUid() {
            return String(window.__GAME_TEST_AUTH_UID__ || '');
        }

        function gateDataLoad() {
            const store = loadStore();
            if (store.holdDataLoads === true) return new Promise(() => {});
            if (store.failDataLoads === true) throw new Error('replacement load failed');
            return null;
        }

        export async function getTeam() {
            await gateDataLoad();
            const team = clone(loadStore().team);
            if (!${JSON.stringify(directAccess)}) team.__denyTestAccess = true;
            return team;
        }

        export async function getDelegatedTeamContext() {
            const store = loadStore();
            return clone(store.delegatedTeam || store.team);
        }

        export async function getGame() {
            await gateDataLoad();
            const store = loadStore();
            store.getGameCalls = [...(store.getGameCalls || []), {
                actorUid: currentActorUid(),
                failed: store.failNextGameRead === true
            }];
            if (store.failNextGameRead === true) {
                store.failNextGameRead = false;
                saveStore(store);
                throw new Error('authoritative game read unavailable');
            }
            saveStore(store);
            const game = clone(store.game);
            const linkedAt = game?.replayVideo?.linkedAt;
            if (typeof linkedAt === 'string' && !Number.isNaN(Date.parse(linkedAt))) {
                const millis = Date.parse(linkedAt);
                game.replayVideo.linkedAt = {
                    seconds: Math.floor(millis / 1000),
                    nanoseconds: (millis % 1000) * 1000000,
                    toDate() {
                        return new Date(millis);
                    }
                };
            }
            window.__GAME_LAST_LOADED_GAME__ = game;
            return game;
        }

        export async function getPlayers() {
            await gateDataLoad();
            return clone(loadStore().players || []);
        }

        export async function getUnreadChatCounts() {
            return {};
        }

        export async function getUserProfile() {
            return { isAdmin: false };
        }

        export async function updateGame(_teamId, _gameId, patch) {
            const store = loadStore();
            store.updateGameCalls = [...(store.updateGameCalls || []), {
                actorUid: currentActorUid(),
                patch: clone(patch)
            }];
            const mode = String(store.nextUpdateGameMode || '');
            delete store.nextUpdateGameMode;
            const commitsBeforeResponse = mode === 'commit-then-reject'
                || mode === 'hold-commit-then-reject';
            if (!mode || commitsBeforeResponse) {
                store.game = { ...(store.game || {}), ...clone(patch) };
            }
            if (mode === 'reject-unknown') {
                store.failNextGameRead = true;
            }
            saveStore(store);
            if (mode === 'hold-commit-then-reject' || mode === 'hold-reject') {
                return new Promise((_resolve, reject) => {
                    window.__GAME_RELEASE_UPDATE_GAME__ = () => reject(new Error('update response unavailable'));
                });
            }
            if (mode === 'commit-then-reject' || mode === 'reject' || mode === 'reject-unknown') {
                throw new Error('update response unavailable');
            }
            if (mode === 'return-false') return false;
        }

        export async function uploadStatSheetPhoto() {
            const store = loadStore();
            const sequence = (store.statSheetUploadCalls || []).length + 1;
            const upload = {
                url: 'https://cdn.example.com/stat-sheet-' + sequence + '.png',
                path: 'teams/team-1/games/game-1/stat-sheet-' + sequence + '.png',
                storage: { name: 'mock-storage' }
            };
            store.statSheetUploadCalls = [...(store.statSheetUploadCalls || []), {
                actorUid: currentActorUid(),
                path: upload.path
            }];
            const shouldHold = store.holdNextStatSheetUpload === true;
            store.holdNextStatSheetUpload = false;
            saveStore(store);
            if (shouldHold) {
                return new Promise((resolve) => {
                    window.__GAME_RELEASE_STAT_SHEET_UPLOAD__ = () => resolve(upload);
                });
            }
            return upload;
        }

        export async function deleteUploadedMediaObjects(targets) {
            const store = loadStore();
            store.deletedUploadCalls = [...(store.deletedUploadCalls || []), {
                actorUid: currentActorUid(),
                paths: (targets || []).map((target) => target?.path || '')
            }];
            saveStore(store);
        }

        export async function getTeamStatsForGame() {
            return clone(loadStore().teamStats || {});
        }

        export async function setCompletedGameTeamStats(_teamId, _gameId, payload) {
            const store = loadStore();
            store.setCompletedGameTeamStatsCalls = [...(store.setCompletedGameTeamStatsCalls || []), {
                actorUid: currentActorUid(),
                payload: clone(payload)
            }];
            store.teamStats = clone(payload.stats || {});
            saveStore(store);
        }

        export async function setCompletedGamePlayerStats(teamId, gameId, playerId, payload) {
            const store = loadStore();
            store.setCompletedGamePlayerStatsCalls = store.setCompletedGamePlayerStatsCalls || [];
            store.setCompletedGamePlayerStatsCalls.push({
                actorUid: currentActorUid(),
                teamId,
                gameId,
                playerId,
                payload: clone(payload)
            });
            saveStore(store);
        }
    `;

  const firebaseModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};
        const DELETE_FIELD_SENTINEL = { __deleteField: true };

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        }

        function clone(value) {
            return JSON.parse(JSON.stringify(value));
        }

        function saveStore(store) {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
        }

        function createSnapshot(entries) {
            const docs = entries.map(([id, data, path]) => ({
                id,
                ref: { path },
                data() {
                    return clone(data);
                }
            }));
            return {
                docs,
                size: docs.length,
                forEach(callback) {
                    docs.forEach((doc) => callback(doc));
                }
            };
        }

        function collectionPath(teamId, gameId, name, docId = '') {
            return 'teams/' + teamId + '/games/' + gameId + '/' + name + (docId ? '/' + docId : '');
        }

        function buildSnapshot(path) {
            const store = loadStore();

            if (path.endsWith('/aggregatedStats') || path.endsWith('/publicPlayerStats')) {
                return createSnapshot(Object.entries(store.aggregatedStats || {}).map(([id, data]) => [
                    id,
                    data,
                    path + '/' + id
                ]));
            }

            if (path.endsWith('/privatePlayerStats')) {
                return createSnapshot(Object.entries(store.privatePlayerStats || {}).map(([id, data]) => [
                    id,
                    data,
                    collectionPath(store.team.id, store.game.id, 'privatePlayerStats', id)
                ]));
            }

            if (path.endsWith('/teamStats')) {
                return createSnapshot(store.teamStatsDocument ? [[
                    'team',
                    store.teamStatsDocument,
                    collectionPath(store.team.id, store.game.id, 'teamStats', 'team')
                ]] : []);
            }

            if (path.endsWith('/statTrackerConfigs')) {
                store.configReadCount = (store.configReadCount || 0) + 1;
                saveStore(store);
                return createSnapshot(store.config ? [[
                    store.config.id,
                    store.config,
                    'teams/' + store.team.id + '/statTrackerConfigs/' + store.config.id
                ]] : []);
            }

            if (path.endsWith('/events')) {
                store.eventReadPaths = [...(store.eventReadPaths || []), path];
                saveStore(store);
                if (store.game?.trackingEngine === 'diamond-v2') {
                    throw new Error('Diamond reports must not read the legacy event collection.');
                }
                return createSnapshot([]);
            }

            return createSnapshot([]);
        }

        export const db = {};
        export const functions = {};

        export function httpsCallable(_functions, name) {
            return async (payload) => {
                const store = loadStore();
                store.callableCalls = [...(store.callableCalls || []), { name, payload: clone(payload) }];
                saveStore(store);
                if (name === 'getPublicDiamondGame' && store.diamondReplay) {
                    return { data: clone(store.diamondReplay) };
                }
                if (name === 'getDiamondManagerStats' && store.managerStatsResponse) {
                    return { data: clone(store.managerStatsResponse) };
                }
                return { data: { status: 'unavailable' } };
            };
        }

        export function doc(_db, ...segments) {
            return { path: segments.join('/') };
        }

        export function collection(_db, path) {
            return { path };
        }

        export function query(ref) {
            return ref;
        }

        export function orderBy() {
            return null;
        }

        export function deleteField() {
            return DELETE_FIELD_SENTINEL;
        }

        export async function getDocs(ref) {
            const store = loadStore();
            if (ref.path.endsWith('/privatePlayerStats')) {
                const snapshot = buildSnapshot(ref.path);
                const shouldHold = store.holdNextPrivatePlayerStatsRead === true;
                store.holdNextPrivatePlayerStatsRead = false;
                store.privatePlayerStatsReadCalls = [...(store.privatePlayerStatsReadCalls || []), {
                    actorUid: String(window.__GAME_TEST_AUTH_UID__ || ''),
                    held: shouldHold
                }];
                saveStore(store);
                if (shouldHold) {
                    return new Promise((resolve) => {
                        window.__GAME_RELEASE_PRIVATE_PLAYER_STATS_READ__ = () => resolve(snapshot);
                    });
                }
                return snapshot;
            }
            return buildSnapshot(ref.path);
        }

        export async function runTransaction(_db, callback) {
            const startingStore = loadStore();
            startingStore.runTransactionCalls = [...(startingStore.runTransactionCalls || []), {
                actorUid: String(window.__GAME_TEST_AUTH_UID__ || '')
            }];
            saveStore(startingStore);
            const transaction = {
                async get() {
                    const game = clone(loadStore().game);
                    const linkedAt = game?.replayVideo?.linkedAt;
                    if (typeof linkedAt === 'string' && !Number.isNaN(Date.parse(linkedAt))) {
                        const millis = Date.parse(linkedAt);
                        game.replayVideo.linkedAt = {
                            seconds: Math.floor(millis / 1000),
                            nanoseconds: (millis % 1000) * 1000000,
                            toDate() {
                                return new Date(millis);
                            }
                        };
                    }
                    return {
                        exists() {
                            return Boolean(game);
                        },
                        data() {
                            return game;
                        }
                    };
                },
                update(_ref, patch) {
                    const store = loadStore();
                    store.replayTransactionUpdateCalls = [...(store.replayTransactionUpdateCalls || []), {
                        actorUid: String(window.__GAME_TEST_AUTH_UID__ || '')
                    }];
                    store.game = { ...(store.game || {}) };
                    Object.entries(patch).forEach(([key, value]) => {
                        if (value?.__deleteField === true) {
                            delete store.game[key];
                        } else {
                            store.game[key] = clone(value);
                        }
                    });
                    saveStore(store);
                }
            };
            return callback(transaction);
        }
    `;

  const utilsModule = `
        export function renderHeader(container) {
            if (container) container.innerHTML = '<div data-testid="header"></div>';
        }

        export function renderFooter(container) {
            if (container) container.innerHTML = '<div data-testid="footer"></div>';
        }

        export function getUrlParams() {
            const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.search.slice(1);
            return Object.fromEntries(new URLSearchParams(raw));
        }

        export function formatDate(value) {
            return String(value || '');
        }

        export function formatShortDate(value) {
            return String(value || '');
        }

        export function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        export async function shareOrCopy(input) {
            window.__GAME_SHARE_PAYLOADS__ = window.__GAME_SHARE_PAYLOADS__ || [];
            window.__GAME_SHARE_PAYLOADS__.push(input);
            return { status: 'copied' };
        }
    `;

  const authModule = controllableAuth
    ? `
        export function checkAuth(callback) {
            window.__GAME_AUTH_CALLBACK__ = (user) => {
                window.__GAME_TEST_AUTH_UID__ = user?.uid || '';
                callback(user);
            };
            window.__GAME_AUTH_CALLBACK__({ uid: 'coach-1', email: 'coach@example.com' });
        }
    `
    : delayedAuth
    ? `
        export function checkAuth(callback) {
            window.__GAME_AUTH_EVENTS__ = ['pending'];
            setTimeout(() => {
                window.__GAME_AUTH_EVENTS__.push('authenticated');
                callback({ uid: 'coach-1', email: 'coach@example.com' });
            }, 4000);
        }
    `
    : `
        export function checkAuth(callback) {
            window.__GAME_TEST_AUTH_UID__ = 'coach-1';
            callback({ uid: 'coach-1', email: 'coach@example.com' });
        }
    `;

  const bannerModule = `
        export function renderTeamAdminBanner(container) {
            if (container) container.innerHTML = '<div data-testid="team-banner"></div>';
        }

        export function getTeamAccessInfo(_user, team) {
            if (team?.__denyTestAccess) {
                return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
            }
            return { hasAccess: true, accessLevel: ${JSON.stringify(accessLevel)}, exitUrl: 'team.html#teamId=team-1' };
        }
    `;

  const insightsModule = `
        export function generateGameInsights({ players = [], timeMap = {} } = {}) {
            return {
                teamInsights: [{ title: 'Manager insight', body: 'Authorized report insight', tone: 'neutral' }],
                playerInsightsById: Object.fromEntries(players
                    .map((player) => [player.id, [{ title: 'Workload', body: player.name + ' recorded time.', tone: 'neutral' }]])),
                emptyMessage: ''
            };
        }
    `;

  const liveGameStateModule = `
        export function resolveLiveStatConfig({ configs = [], game = {} } = {}) {
            return configs.find((config) => config.id === game.statTrackerConfigId) || configs[0] || null;
        }
    `;

  const liveGameVideoModule = `
        export function buildHighlightShareUrl() {
            return '';
        }

        export function normalizeGameRecapHighlightClips() {
            return [];
        }

        export function resolveReplayVideoOptions({ game } = {}) {
            const replay = game?.replayVideo;
            if (replay?.provider === 'youtube' && replay?.status === 'ready' && replay?.videoId) {
                return {
                    mode: 'embed',
                    isRecordedReplay: true,
                    hasVideo: true,
                    sourceUrl: replay.embedUrl,
                    publicUrl: replay.publicUrl,
                    replayState: null
                };
            }
            const attachedClip = Array.isArray(game?.highlightClips)
                ? game.highlightClips.find((clip) => clip?.type === 'score-linked' && clip?.mediaUrl)
                : null;
            if (attachedClip) {
                return {
                    mode: 'recorded',
                    isRecordedReplay: false,
                    isAttachedClip: true,
                    hasVideo: true,
                    sourceUrl: attachedClip.mediaUrl,
                    publicUrl: attachedClip.mediaUrl,
                    replayState: null
                };
            }
            return { mode: 'none', hasVideo: false, replayState: { status: 'unavailable', title: 'Replay unavailable' } };
        }

        export function hasCompletedReplayLifecycle() { return true; }
    `;

  const firebaseAiModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        }

        function saveStore(store) {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
        }

        function buildResult() {
            return {
                response: {
                    text() {
                        return String(loadStore().aiSummaryResponse || 'Classic generated summary.');
                    }
                }
            };
        }

        export class GoogleAIBackend {}

        export function getAI() {
            return {};
        }

        export function getGenerativeModel() {
            return {
                async generateContent(prompt) {
                    const store = loadStore();
                    const shouldHold = store.holdAiSummaryModel === true;
                    store.holdAiSummaryModel = false;
                    store.aiSummaryModelCalls = [...(store.aiSummaryModelCalls || []), { prompt: String(prompt) }];
                    saveStore(store);
                    if (shouldHold) {
                        return new Promise((resolve) => {
                            window.__GAME_RELEASE_AI_SUMMARY_MODEL__ = () => resolve(buildResult());
                        });
                    }
                    return buildResult();
                }
            };
        }
    `;

  const firebaseAppModule = `
        export function getApp() {
            return {};
        }
    `;

  await page.route(/\/js\/db\.js\?v=\d+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: dbModule,
    }),
  );
  await page.route(/\/js\/firebase\.js\?v=\d+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: firebaseModule,
    }),
  );
  await page.route(/\/js\/utils\.js\?v=\d+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: utilsModule,
    }),
  );
  await page.route(/\/js\/auth\.js\?v=\d+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: authModule,
    }),
  );
  await page.route(/\/js\/team-admin-banner\.js(?:\?v=\d+)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: bannerModule,
    }),
  );
  await page.route(/\/js\/post-game-insights\.js\?v=\d+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: insightsModule,
    }),
  );
  await page.route(/\/js\/live-game-state\.js\?v=\d+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: liveGameStateModule,
    }),
  );
  await page.route(/\/js\/live-game-video\.js\?v=\d+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: liveGameVideoModule,
    }),
  );
  await page.route(/\/js\/vendor\/firebase-ai\.js(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: firebaseAiModule,
    }),
  );
  await page.route(/\/js\/vendor\/firebase-app\.js(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: firebaseAppModule,
    }),
  );
}

async function readStore(page) {
  return page.evaluate(
    (storeKey) => JSON.parse(localStorage.getItem(storeKey) || "{}"),
    STORE_KEY,
  );
}

async function triggerAuthChangeAndCapture(page, { nextUser = null, loadMode }) {
  return page.evaluate(
    ({ storeKey, replacementUser, replacementLoadMode }) => {
      const store = JSON.parse(localStorage.getItem(storeKey) || "{}");
      delete store.holdDataLoads;
      delete store.failDataLoads;
      if (replacementLoadMode === "hold") store.holdDataLoads = true;
      if (replacementLoadMode === "fail") store.failDataLoads = true;
      localStorage.setItem(storeKey, JSON.stringify(store));

      window.__GAME_AUTH_CALLBACK__(replacementUser);

      const text = (id) => document.getElementById(id)?.textContent || "";
      const value = (id) => document.getElementById(id)?.value || "";
      const hidden = (id) => document.getElementById(id)?.classList.contains("hidden") === true;
      const exportButton = document.getElementById("diamond-stats-export-btn");
      const snapshot = {
        exportHidden: hidden("diamond-stats-export-btn"),
        exportHandlerCleared: exportButton?.onclick === null,
        exportText: text("diamond-stats-export-btn").trim(),
        teamNav: text("team-nav-banner"),
        playerHeaders: text("stats-header-row"),
        playerStats: text("stats-body"),
        teamStats: text("team-stats-body"),
        teamInsights: text("team-insights-body"),
        playerInsights: text("player-insights-body"),
        publishedRecap: text("published-diamond-ai-recap"),
        gameLog: text("game-log"),
        playingTimeMeta: text("playing-time-meta"),
        playingTimeBody: text("playing-time-body"),
        insightsHidden: hidden("insights-section"),
        playingTimeHidden: hidden("playing-time-insights"),
        teamStatsHidden: hidden("team-stats-section"),
        diamondNoticePresent: Boolean(document.getElementById("diamond-report-status")),
        summaryAdminHidden: hidden("summary-admin"),
        summaryEditorHidden: hidden("summary-editor"),
        summaryStatus: text("summary-edit-status"),
        summaryDraft: value("summary-textarea"),
        statsEditorStatus: text("stats-editor-status"),
        statsEditorName: text("stats-editor-player-name"),
        statsEditorMeta: text("stats-editor-player-meta"),
        statsEditorFields: text("stats-editor-fields"),
        teamStatsEditorStatus: text("team-stats-editor-status"),
        teamStatsEditorFields: text("team-stats-editor-fields"),
        replayAdminHidden: hidden("replay-video-admin"),
        replayCurrent: text("replay-video-current"),
        replayStatus: text("replay-video-status"),
        replayUrl: value("replay-video-url"),
        replayTitle: value("replay-video-title"),
      };
      exportButton?.click();
      return snapshot;
    },
    {
      storeKey: STORE_KEY,
      replacementUser: nextUser,
      replacementLoadMode: loadMode,
    },
  );
}

function expectAuthorizationDependentReportCleared(snapshot) {
  expect(snapshot).toMatchObject({
    exportHidden: true,
    exportHandlerCleared: true,
    exportText: "Export stats CSV",
    teamNav: "",
    playerHeaders: "",
    playerStats: "",
    teamStats: "",
    teamInsights: "",
    playerInsights: "",
    publishedRecap: "",
    gameLog: "",
    playingTimeMeta: "",
    playingTimeBody: "",
    insightsHidden: true,
    playingTimeHidden: true,
    teamStatsHidden: true,
    diamondNoticePresent: false,
    summaryAdminHidden: true,
    summaryEditorHidden: true,
    summaryStatus: "",
    summaryDraft: "",
    statsEditorStatus: "",
    statsEditorName: "",
    statsEditorMeta: "",
    statsEditorFields: "",
    teamStatsEditorStatus: "",
    teamStatsEditorFields: "",
    replayAdminHidden: true,
    replayCurrent: "",
    replayStatus: "",
    replayUrl: "",
    replayTitle: "",
  });
}

test("Diamond report labels partial observations, leaves uncollected stats unavailable, and disables legacy edits", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.team.sport = "Baseball";
  scenario.config = {
    id: "cfg-1",
    baseType: "Baseball",
    columns: ["H", "SB", "ERA"],
    statDefinitions: [
      { id: "h", label: "H", scope: "player", visibility: "public" },
      { id: "sb", label: "SB", scope: "player", visibility: "public" },
      {
        id: "era",
        label: "ERA",
        scope: "player",
        visibility: "public",
        precision: 2,
      },
      { id: "r", label: "R", scope: "team", visibility: "public" },
      { id: "lob", label: "TEAM H", scope: "team", visibility: "private" },
    ],
  };
  const instanceId = "00000000-0000-4000-8000-000000000001";
  const checkpointHash = `sha256:${"a".repeat(64)}`;
  const configHash = buildDiamondStatConfigSnapshotHash({
    teamId: scenario.team.id,
    configId: scenario.config.id,
    config: scenario.config,
  });
  const projectionHash = `sha256:${"c".repeat(64)}`;
  scenario.game = {
    ...scenario.game,
    teamId: "team-1",
    trackingEngine: "diamond-v2",
    diamondProjectionStatus: "current",
    diamondProjectionRevision: 8,
    diamondProjectionComplete: true,
    diamondScorebookInstanceId: instanceId,
    diamondProjectionCheckpointHash: checkpointHash,
    diamondStatConfigSnapshotHash: configHash,
    diamondProjectionHash: projectionHash,
    diamondPublicTeamStats: {
      trackingEngine: "diamond-v2",
      projectionSchemaVersion: 1,
      sourceRevision: 8,
      checkpointHash,
      coverage: { batting: "complete" },
      publicStatIds: ["r"],
      side: "home",
      complete: true,
      stats: { r: 3 },
      observedStats: {},
      statCoverage: { r: "complete" },
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      statConfigSnapshotHash: configHash,
      projectionHash,
    },
  };
  scenario.aggregatedStats = {
    p1: {
      schemaVersion: 1,
      trackingEngine: "diamond-v2",
      projectionSchemaVersion: 1,
      playerId: "p1",
      sourceRevision: 8,
      checkpointHash,
      complete: true,
      participated: true,
      participationStatus: "appeared",
      participationSource: "diamond-v2",
      playerName: "Ava Game-Time",
      playerNumber: "3",
      publicStatIds: ["era", "h", "sb"],
      stats: { h: 0 },
      observedStats: { sb: 2 },
      derivedStats: {},
      observedDerivedStats: {},
      statCoverage: { h: "complete", sb: "partial", era: "not_collected" },
      statSources: {},
      sourcePlayIds: [],
      unavailableDerivedStats: ["era"],
      missingStatFamilies: [],
      coverage: {
        batting: "complete",
        baserunning: "partial",
        pitching: "not_collected",
      },
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      statConfigSnapshotHash: configHash,
      projectionHash,
    },
    "manual-private-source-id": {
      schemaVersion: 1,
      trackingEngine: "diamond-v2",
      projectionSchemaVersion: 1,
      playerId: "manual-private-source-id",
      sourceRevision: 8,
      checkpointHash,
      complete: true,
      participated: true,
      participationStatus: "appeared",
      participationSource: "diamond-v2",
      playerName: "Guest Slugger",
      playerNumber: "18",
      publicStatIds: ["era", "h", "sb"],
      stats: { h: 1 },
      observedStats: {},
      derivedStats: {},
      observedDerivedStats: {},
      statCoverage: { h: "complete", sb: "not_collected", era: "not_collected" },
      statSources: {},
      sourcePlayIds: [],
      unavailableDerivedStats: ["era"],
      missingStatFamilies: [],
      coverage: {
        batting: "complete",
        baserunning: "not_collected",
        pitching: "not_collected",
      },
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      statConfigSnapshotHash: configHash,
      projectionHash,
    },
  };
  scenario.players[0].photoUrl = "https://cdn.example.com/roster-p1.jpg";
  scenario.teamStatsDocument = {
    trackingEngine: "diamond-v2",
    sourceRevision: 8,
    complete: true,
    stats: { r: 3, h: 99 },
    statCoverage: { r: "complete", h: "complete" },
    coverage: { batting: "complete" },
  };
  scenario.diamondReplay = {
    instanceId,
    game: { trackingEngine: "diamond-v2" },
    events: [{
      id: "event-8",
      revision: 8,
      inning: 6,
      half: "bottom",
      description: "Plate appearance: walk off single",
      createdAt: "2026-04-03T21:08:00.000Z",
      isCorrection: false,
      isScoringPlay: true,
      score: { home: 3, away: 2 },
    }],
    nextCursor: null,
    complete: true,
    truncated: false,
    sourceRevision: 8,
    projectionToken: `current:8:${projectionHash}`,
    diamondStats: { status: "complete" },
  };
  await installMocks(page, scenario, { accessLevel: "member" });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);

  await expect(
    page.getByText("Diamond scorebook · Public stats · Read only"),
  ).toBeVisible();
  const row = page.locator("#stats-body tr").filter({ hasText: "Ava Game-Time" });
  await expect(row).toHaveCount(1);
  await expect(row.locator('img[src="https://cdn.example.com/roster-p1.jpg"]')).toHaveCount(1);
  await expect(row.locator("td").nth(2)).toHaveText("0");
  await expect(row.locator("td").nth(3)).toContainText("Observed");
  await expect(row.locator("td").nth(4)).toHaveText("—");
  const manualRow = page.locator("#stats-body tr").filter({ hasText: "Guest Slugger" });
  await expect(manualRow).toHaveCount(1);
  await expect(manualRow.getByRole("link")).toHaveCount(0);
  await expect(manualRow.locator("img")).toHaveCount(0);
  await expect(page.locator("#player-insights-body")).toContainText("Guest Slugger");
  const manualInsight = page
    .locator("#player-insights-body > div")
    .filter({ hasText: "Guest Slugger" });
  await expect(manualInsight).toHaveCount(1);
  await expect(manualInsight.getByRole("link")).toHaveCount(0);
  await expect(page.locator("#stats-body")).not.toContainText("manual-private-source-id");
  await expect(page.locator("#edit-stats-btn")).toBeHidden();
  await expect(page.locator("#team-stats-body")).toContainText("R");
  await expect(page.locator("#team-stats-body")).toContainText("3");
  await expect(page.locator("#team-stats-body")).not.toContainText("TEAM H");
  await expect(page.locator("#game-log")).toContainText("Plate appearance: walk off single");
  await expect(page.locator("#game-log")).toContainText("Bottom 6");
  const replayStore = await readStore(page);
  expect(replayStore.eventReadPaths || []).toEqual([]);
  expect(replayStore.callableCalls).toContainEqual({
    name: "getPublicDiamondGame",
    payload: { teamId: "team-1", gameId: "game-1", cursor: null, limit: 200 },
  });
  await expect(page.locator("#diamond-stats-export-btn")).toHaveText(
    "Export public CSV",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#diamond-stats-export-btn").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "Comets-2026-04-03-diamond-stats-public.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = await readFile(downloadPath, "utf8");
  expect(csv).toContain('"source_revision"');
  expect(csv).toContain('"h","h__coverage"');
  expect(csv).toContain('"0","complete","2","partial","","not_collected"');
  expect(csv).toContain('"team","public"');
  expect(csv).toContain("Guest Slugger");
  expect(csv).not.toContain("manual-private-source-id");
  expect(csv).not.toContain("99");
  expect(pageErrors).toEqual([]);
});

test("Diamond manager reports never expose or invoke legacy stat editors across auth reloads", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMocks(page, createManagerDiamondScenario(), {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#diamond-report-status")).toContainText(
    "Manager-internal stats",
  );

  const expectLegacyEditorsUnavailable = async () => {
    await expect(page.locator("#edit-stats-btn")).toBeHidden();
    await expect(page.locator("#stats-editor-admin")).toBeHidden();
    await expect(page.locator("#stats-editor-panel")).toBeHidden();
    await expect(page.locator("#edit-team-stats-btn")).toBeHidden();
    await expect(page.locator("#team-stats-editor-admin")).toBeHidden();
    await expect(page.locator("#team-stats-editor-panel")).toBeHidden();
    expect(await readStore(page)).toMatchObject({
      setCompletedGamePlayerStatsCalls: [],
    });
    expect(
      (await readStore(page)).setCompletedGameTeamStatsCalls || [],
    ).toEqual([]);
  };

  const attemptLegacyEditorActions = async () => {
    await page.evaluate(() => {
      for (const id of [
        "edit-stats-btn",
        "stats-save-btn",
        "stats-save-prev-btn",
        "stats-save-next-btn",
        "edit-team-stats-btn",
        "team-stats-save-btn",
      ]) {
        document.getElementById(id)?.click();
      }
    });
    await expectLegacyEditorsUnavailable();
  };

  await attemptLegacyEditorActions();

  await page.evaluate(() => {
    window.__GAME_AUTH_CALLBACK__({
      uid: "coach-2",
      email: "second@example.com",
    });
  });

  await expect
    .poll(async () => (await readStore(page)).getGameCalls?.length || 0)
    .toBe(2);
  await expect(page.locator("#diamond-report-status")).toContainText(
    "Manager-internal stats",
  );
  await attemptLegacyEditorActions();
  expect(pageErrors).toEqual([]);
});

test("Diamond managers cannot force the legacy AI summary generator across auth reloads", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createManagerDiamondScenario();
  scenario.game.summary = "";
  scenario.game.aiRecap = {
    schemaVersion: 1,
    trackingEngine: "diamond-v2",
    published: true,
    status: "current",
    stale: false,
    sourceRevision: 8,
    recap: {
      text: "The cited Diamond recap remains available.",
      citations: [{ eventId: "event-8", revision: 8 }],
    },
    insights: [],
    coverage: { batting: "complete" },
    dataQualityNotes: [],
  };
  await installMocks(page, scenario, {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);

  const expectDiamondSummaryBoundary = async () => {
    await expect(page.locator("#summary-admin")).toBeVisible();
    await expect(page.locator("#summary-generate-btn")).toBeHidden();
    await expect(page.locator("#published-diamond-ai-recap")).toContainText(
      "The cited Diamond recap remains available.",
    );
    await page.evaluate(() => {
      const generateButton = document.getElementById("summary-generate-btn");
      generateButton?.classList.remove("hidden");
      if (generateButton) generateButton.disabled = false;
      generateButton?.click();
    });
    await page.waitForTimeout(50);
    const store = await readStore(page);
    expect(store.aiSummaryModelCalls || []).toEqual([]);
    expect(store.updateGameCalls || []).toEqual([]);
  };

  await expectDiamondSummaryBoundary();
  await page.evaluate(() => {
    window.__GAME_AUTH_CALLBACK__({
      uid: "coach-2",
      email: "second@example.com",
    });
  });
  await expect
    .poll(async () => (await readStore(page)).getGameCalls?.length || 0)
    .toBe(2);
  await expect(page.locator("#diamond-report-status")).toContainText(
    "Manager-internal stats",
  );
  await expectDiamondSummaryBoundary();
  expect(pageErrors).toEqual([]);
});

test("a stale classic AI summary handler rechecks Diamond before model, draft, and persistence", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.game.summary = "";
  scenario.aiSummaryResponse = "Generated from legacy stats.";
  await installMocks(page, scenario);

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.locator("#summary-generate-btn")).toBeVisible();

  await page.evaluate(() => {
    window.__GAME_LAST_LOADED_GAME__.trackingEngine = "diamond-v2";
    document.getElementById("summary-generate-btn")?.click();
  });
  await page.waitForTimeout(50);
  expect((await readStore(page)).aiSummaryModelCalls || []).toEqual([]);

  await page.evaluate((storeKey) => {
    window.__GAME_LAST_LOADED_GAME__.trackingEngine = "classic";
    const store = JSON.parse(localStorage.getItem(storeKey) || "{}");
    store.holdAiSummaryModel = true;
    localStorage.setItem(storeKey, JSON.stringify(store));
    const generateButton = document.getElementById("summary-generate-btn");
    generateButton?.classList.remove("hidden");
    if (generateButton) generateButton.disabled = false;
    generateButton?.click();
  }, STORE_KEY);
  await expect
    .poll(async () => (await readStore(page)).aiSummaryModelCalls?.length || 0)
    .toBe(1);
  await page.evaluate(() => {
    window.__GAME_LAST_LOADED_GAME__.trackingEngine = "diamond-v2";
    window.__GAME_RELEASE_AI_SUMMARY_MODEL__();
  });
  await page.waitForTimeout(50);
  await expect(page.locator("#summary-textarea")).toHaveValue("");

  await page.evaluate(() => {
    window.__GAME_LAST_LOADED_GAME__.trackingEngine = "classic";
    const generateButton = document.getElementById("summary-generate-btn");
    generateButton?.classList.remove("hidden");
    if (generateButton) generateButton.disabled = false;
    generateButton?.click();
  });
  await expect(page.locator("#summary-textarea")).toHaveValue(
    "Generated from legacy stats.",
  );
  await page.evaluate(() => {
    window.__GAME_LAST_LOADED_GAME__.trackingEngine = "diamond-v2";
    document.getElementById("summary-save-btn")?.click();
  });
  await page.waitForTimeout(50);
  expect((await readStore(page)).updateGameCalls || []).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("classic managers can still generate, review, and save the legacy AI summary", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.game.summary = "";
  scenario.aiSummaryResponse = "Classic AI summary remains available.";
  await installMocks(page, scenario);

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.locator("#summary-generate-btn")).toBeVisible();

  await page.locator("#summary-generate-btn").click();
  await expect(page.locator("#summary-textarea")).toHaveValue(
    "Classic AI summary remains available.",
  );
  await page.locator("#summary-save-btn").click();
  await expect(page.locator("#game-summary")).toContainText(
    "Classic AI summary remains available.",
  );

  const store = await readStore(page);
  expect(store.aiSummaryModelCalls).toHaveLength(1);
  expect(store.aiSummaryModelCalls[0].prompt).toContain("PTS:10, FOULS:0");
  expect(store.updateGameCalls).toContainEqual({
    actorUid: "coach-1",
    patch: { summary: "Classic AI summary remains available." },
  });
  expect(pageErrors).toEqual([]);
});

test("Diamond report retries an unresolved config and offers a working accessible retry", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  let pageLoads = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/game.html")) pageLoads += 1;
  });
  const scenario = createScenario();
  const instanceId = "00000000-0000-4000-8000-000000000001";
  scenario.team.sport = "Baseball";
  scenario.config = null;
  scenario.aggregatedStats = {};
  scenario.game = {
    ...scenario.game,
    teamId: "team-1",
    trackingEngine: "diamond-v2",
    diamondProjectionStatus: "current",
    diamondProjectionRevision: 8,
    diamondProjectionComplete: true,
    diamondScorebookInstanceId: instanceId,
    diamondProjectionCheckpointHash: `sha256:${"a".repeat(64)}`,
    diamondStatConfigSnapshotHash: `sha256:${"b".repeat(64)}`,
    diamondProjectionHash: `sha256:${"c".repeat(64)}`,
  };
  await installMocks(page, scenario, { accessLevel: "member" });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  const retry = page.getByRole("button", {
    name: "Retry loading Diamond statistic definitions",
  });
  await expect(retry).toBeVisible();
  await expect(page.getByText("Diamond statistic definitions could not be verified.")).toBeVisible();
  await expect.poll(async () => (await readStore(page)).configReadCount).toBe(2);
  const box = await retry.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await retry.click();
  await expect.poll(() => pageLoads).toBeGreaterThanOrEqual(2);
  await expect(retry).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("completed-game stat editor saves corrections and DNP state through real controls", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMocks(page, createScenario());

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);
  await expect.poll(async () => (await readStore(page)).eventReadPaths || []).toEqual([
    "teams/team-1/games/game-1/events",
  ]);

  await page.locator("#share-report-btn").click();
  await expect
    .poll(() => page.evaluate(() => window.__GAME_SHARE_PAYLOADS__?.[0]?.url))
    .toBe("https://share.allplays.ai/report?teamId=team-1&gameId=game-1");

  const tableRows = page.locator("#stats-body tr");
  await expect(tableRows).toHaveCount(2);
  await expect(tableRows.first()).toContainText("Ava Cole");
  await expect(tableRows.first()).toContainText("10");
  await expect(tableRows.first()).not.toContainText("EFFORT");

  await page.locator("#edit-stats-btn").click();
  await expect(page.locator("#stats-editor-panel")).toBeVisible();
  await expect(page.locator("#stats-editor-player-name")).toHaveText(
    "Ava Cole",
  );
  await expect(page.locator('[data-stat-field="pts"]')).toHaveValue("10");
  await expect(page.locator('[data-stat-field="effort"]')).toHaveValue("7");

  await page.locator('[data-stat-field="pts"]').fill("14");
  await page.locator('[data-stat-field="reb"]').fill("6");
  await page.locator('[data-stat-field="effort"]').fill("9");
  await page.locator("#stats-save-next-btn").click();

  await expect(page.locator("#stats-editor-player-name")).toHaveText(
    "Mia Diaz",
  );
  await expect(tableRows.first()).toContainText("14");
  await expect(tableRows.first()).toContainText("6");
  await expect(page.locator("#stats-header-row")).not.toContainText("EFFORT");

  let store = await readStore(page);
  expect(store.setCompletedGamePlayerStatsCalls).toHaveLength(1);
  expect(store.setCompletedGamePlayerStatsCalls[0]).toMatchObject({
    teamId: "team-1",
    gameId: "game-1",
    playerId: "p1",
    payload: {
      playerName: "Ava Cole",
      playerNumber: "3",
      stats: { pts: 14, reb: 6, ast: 2, effort: 9, fouls: 0 },
      didNotPlay: false,
      participated: true,
      participationStatus: "appeared",
      participationSource: "post-game-stat-editor",
      timeMs: 540000,
    },
  });

  await expect(page.locator('[data-stat-field="pts"]')).toHaveValue("6");
  await expect(page.locator('[data-stat-field="effort"]')).toHaveValue("5");
  await page.locator("#stats-dnp-toggle").check();
  await expect(page.locator('[data-stat-field="pts"]')).toBeDisabled();
  await expect(page.locator('[data-stat-field="pts"]')).toHaveValue("0");
  await expect(page.locator('[data-stat-field="effort"]')).toBeDisabled();
  await expect(page.locator('[data-stat-field="effort"]')).toHaveValue("0");

  await page.locator("#stats-save-btn").click();

  await expect(tableRows.nth(1)).toContainText("Mia Diaz");
  await expect(tableRows.nth(1)).toContainText("DNP");
  await expect(tableRows.nth(1).locator("td").nth(2)).toHaveText("—");
  await expect(tableRows.nth(1).locator("td").nth(4)).toHaveText("—");
  await expect(tableRows.nth(1).locator("td").nth(5)).toHaveText("—");

  store = await readStore(page);
  expect(store.setCompletedGamePlayerStatsCalls).toHaveLength(2);
  expect(store.setCompletedGamePlayerStatsCalls[1]).toMatchObject({
    teamId: "team-1",
    gameId: "game-1",
    playerId: "p2",
    payload: {
      playerName: "Mia Diaz",
      playerNumber: "5",
      stats: { pts: 0, reb: 0, ast: 0, effort: 0, fouls: 0 },
      didNotPlay: true,
      participated: false,
      participationStatus: "did-not-appear",
      participationSource: "",
      timeMs: 0,
    },
  });
  expect(pageErrors).toEqual([]);
});

test("late authentication refreshes manager controls and private edit data without duplicating report rows", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMocks(page, createScenario(), { delayedAuth: true });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);

  const publicRows = page.locator("#stats-body tr");
  await expect(publicRows).toHaveCount(2, { timeout: 5000 });
  await expect(publicRows.first()).toContainText("Ava Cole");
  await expect(page.locator("#summary-admin")).toBeHidden();
  await expect(page.locator("#stat-sheet-admin")).toBeHidden();
  await expect(page.locator("#edit-stats-btn")).toBeHidden();
  await expect(page.locator("#edit-team-stats-btn")).toBeHidden();
  await expect(page.locator("#stats-header-row")).not.toContainText("EFFORT");

  const publicShape = await page.evaluate(() => ({
    playerHeaders: document.querySelectorAll("#stats-header-row th").length,
    playerRows: document.querySelectorAll("#stats-body tr").length,
    opponentHeaders: document.querySelectorAll("#opponent-stats-header-row th")
      .length,
    opponentRows: document.querySelectorAll("#opponent-stats-body tr").length,
  }));

  await expect(page.locator("#summary-admin")).toBeVisible({ timeout: 6000 });
  await expect(page.locator("#stat-sheet-admin")).toBeVisible();
  await expect(page.locator("#edit-stats-btn")).toBeVisible();
  await expect(page.locator("#edit-team-stats-btn")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__GAME_AUTH_EVENTS__))
    .toEqual(["pending", "authenticated"]);

  await page.locator("#edit-stats-btn").click();
  await expect(page.locator("#stats-editor-panel")).toBeVisible();
  await expect(page.locator('[data-stat-field="effort"]')).toHaveValue("7");
  await expect(page.locator("#stats-header-row")).not.toContainText("EFFORT");

  await expect
    .poll(() =>
      page.evaluate(() => ({
        playerHeaders: document.querySelectorAll("#stats-header-row th").length,
        playerRows: document.querySelectorAll("#stats-body tr").length,
        opponentHeaders: document.querySelectorAll(
          "#opponent-stats-header-row th",
        ).length,
        opponentRows: document.querySelectorAll("#opponent-stats-body tr")
          .length,
      })),
    )
    .toEqual(publicShape);
  expect(pageErrors).toEqual([]);
});

test("sign-out synchronously removes the complete manager report while its public replacement is held", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  let downloadCount = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("download", () => {
    downloadCount += 1;
  });
  await installMocks(page, createManagerDiamondScenario(), {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#diamond-report-status")).toContainText(
    "Manager-internal stats",
  );
  await expect(page.locator("#stats-header-row")).toContainText("Pitch count");
  const manualRow = page
    .locator("#stats-body tr")
    .filter({ hasText: "Guest Public Identity" });
  await expect(manualRow).toHaveCount(1);
  await expect(manualRow.getByRole("link")).toHaveCount(0);
  await expect(page.locator("#team-stats-body")).toContainText("Left on base");
  await expect(page.locator("#player-insights-body")).toContainText(
    "Guest Public Identity",
  );
  await expect(page.locator("#playing-time-insights")).toBeVisible();
  await expect(page.locator("#playing-time-body")).toContainText(
    "Guest Public Identity",
  );
  await expect(page.locator("#game-log")).toContainText(
    "Authorized replay event",
  );
  await expect(page.locator("#diamond-stats-export-btn")).toHaveText(
    "Export internal CSV",
  );
  await expect(page.locator("main")).not.toContainText(
    "manual-private-source-id",
  );

  await page.evaluate(() => {
    document.getElementById("summary-editor")?.classList.remove("hidden");
    document.getElementById("stats-editor-panel")?.classList.remove("hidden");
    document.getElementById("team-stats-editor-panel")?.classList.remove("hidden");
    document.getElementById("summary-textarea").value = "Prior manager draft";
    document.getElementById("summary-edit-status").textContent = "Private summary status";
    document.getElementById("published-diamond-ai-recap").textContent = "Private generated recap";
    document.getElementById("stats-editor-status").textContent = "Private player edit status";
    document.getElementById("stats-editor-player-name").textContent = "Private edited player";
    document.getElementById("stats-editor-player-meta").textContent = "Private player meta";
    document.getElementById("stats-editor-fields").textContent = "Private player fields";
    document.getElementById("team-stats-editor-status").textContent = "Private team edit status";
    document.getElementById("team-stats-editor-fields").textContent = "Private team fields";
    document.getElementById("replay-video-status").textContent = "Private replay status";
  });

  const snapshot = await triggerAuthChangeAndCapture(page, {
    nextUser: null,
    loadMode: "hold",
  });
  expectAuthorizationDependentReportCleared(snapshot);
  await page.waitForTimeout(150);
  expect(downloadCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("a failed replacement load cannot restore the previous UID's manager report", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  let downloadCount = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("download", () => {
    downloadCount += 1;
  });
  await installMocks(page, createManagerDiamondScenario(), {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#diamond-report-status")).toContainText(
    "Manager-internal stats",
  );
  await expect(page.locator("#stats-body")).toContainText(
    "Guest Public Identity",
  );
  await page.evaluate(() => {
    document.getElementById("summary-editor")?.classList.remove("hidden");
    document.getElementById("summary-textarea").value = "Prior UID draft";
    document.getElementById("summary-edit-status").textContent = "Prior UID status";
  });

  const snapshot = await triggerAuthChangeAndCapture(page, {
    nextUser: { uid: "coach-2", email: "second@example.com" },
    loadMode: "fail",
  });
  expectAuthorizationDependentReportCleared(snapshot);
  await expect(page.getByText("Error loading game.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Manager-internal stats");
  await expect(page.locator("main")).not.toContainText("Guest Public Identity");
  await expect(page.locator("main")).not.toContainText("Authorized replay event");
  await page.waitForTimeout(150);
  expect(downloadCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("a held legacy private-stat read cannot overwrite the replacement manager report", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.holdNextPrivatePlayerStatsRead = true;
  await installMocks(page, scenario, {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(
      async () =>
        (await readStore(page)).privatePlayerStatsReadCalls?.length || 0,
    )
    .toBe(1);
  expect((await readStore(page)).privatePlayerStatsReadCalls[0]).toEqual({
    actorUid: "coach-1",
    held: true,
  });

  await page.evaluate((storeKey) => {
    const store = JSON.parse(localStorage.getItem(storeKey) || "{}");
    store.players[0].name = "Ava Replacement";
    store.aggregatedStats.p1.playerName = "Ava Replacement";
    store.aggregatedStats.p1.stats.pts = 21;
    store.privatePlayerStats.p1.stats.effort = 27;
    localStorage.setItem(storeKey, JSON.stringify(store));
    window.__GAME_AUTH_CALLBACK__({
      uid: "coach-2",
      email: "second@example.com",
    });
  }, STORE_KEY);

  await expect
    .poll(
      async () =>
        (await readStore(page)).privatePlayerStatsReadCalls?.length || 0,
    )
    .toBe(2);
  await expect(page.locator("#stats-body")).toContainText("Ava Replacement");
  await expect(page.locator("#stats-body tr").first()).toContainText("21");
  await expect(page.locator("#player-insights-body")).toContainText(
    "Ava Replacement",
  );
  await page.locator("#edit-stats-btn").click();
  await expect(page.locator("#stats-editor-panel")).toBeVisible();
  await expect(page.locator('[data-stat-field="effort"]')).toHaveValue("27");

  await page.evaluate(() => window.__GAME_RELEASE_PRIVATE_PLAYER_STATS_READ__());
  await page.waitForTimeout(100);

  await expect(page.locator("#stats-body")).toContainText("Ava Replacement");
  await expect(page.locator("#stats-body")).not.toContainText("Ava Cole");
  await expect(page.locator("#stats-body tr").first()).toContainText("21");
  await expect(page.locator("#player-insights-body")).toContainText(
    "Ava Replacement",
  );
  await expect(page.locator("#player-insights-body")).not.toContainText(
    "Ava Cole",
  );
  await expect(page.locator("#stats-editor-panel")).toBeVisible();
  await expect(page.locator('[data-stat-field="effort"]')).toHaveValue("27");
  expect((await readStore(page)).eventReadPaths).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test("a held legacy private-stat read cannot repopulate report state after sign-out", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.holdNextPrivatePlayerStatsRead = true;
  await installMocks(page, scenario, {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(
      async () =>
        (await readStore(page)).privatePlayerStatsReadCalls?.length || 0,
    )
    .toBe(1);

  const snapshot = await triggerAuthChangeAndCapture(page, {
    nextUser: null,
    loadMode: "hold",
  });
  expectAuthorizationDependentReportCleared(snapshot);

  await page.evaluate(() => window.__GAME_RELEASE_PRIVATE_PLAYER_STATS_READ__());
  await page.waitForTimeout(100);

  await expect(page.locator("#stats-body")).toBeEmpty();
  await expect(page.locator("#team-stats-body")).toBeEmpty();
  await expect(page.locator("#player-insights-body")).toBeEmpty();
  await expect(page.locator("#team-insights-body")).toBeEmpty();
  await expect(page.locator("#stats-editor-fields")).toBeEmpty();
  await expect(page.locator("#stats-editor-panel")).toBeHidden();
  expect((await readStore(page)).eventReadPaths || []).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("a UID swap aborts stale manager listeners and in-flight upload continuation before binding the new manager", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.holdNextStatSheetUpload = true;
  await installMocks(page, scenario, {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#stat-sheet-admin")).toBeVisible();
  await page.locator("#stat-sheet-file-input").setInputFiles({
    name: "manager-a-sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from("manager-a"),
  });
  await expect(page.locator("#stat-sheet-upload-preview")).toBeVisible();
  await page.locator("#stat-sheet-save").click();
  await expect
    .poll(async () => (await readStore(page)).statSheetUploadCalls?.length || 0)
    .toBe(1);
  expect((await readStore(page)).statSheetUploadCalls[0]).toMatchObject({
    actorUid: "coach-1",
  });

  await page.evaluate(() => {
    window.__GAME_AUTH_CALLBACK__({
      uid: "coach-2",
      email: "second@example.com",
    });
  });
  await expect
    .poll(async () => (await readStore(page)).eventReadPaths?.length || 0)
    .toBe(2);
  await expect(page.locator("#stats-body tr")).toHaveCount(2);
  await expect(page.locator("#stat-sheet-admin")).toBeVisible();

  await page.evaluate(() => window.__GAME_RELEASE_STAT_SHEET_UPLOAD__());
  await expect
    .poll(async () => {
      const store = await readStore(page);
      const staleWrites = (store.updateGameCalls || []).filter((call) =>
        Object.hasOwn(call.patch || {}, "statSheetPhotoUrl"),
      ).length;
      return staleWrites + (store.deletedUploadCalls?.length || 0);
    })
    .toBe(1);
  let store = await readStore(page);
  expect(
    (store.updateGameCalls || []).filter((call) =>
      Object.hasOwn(call.patch || {}, "statSheetPhotoUrl"),
    ),
  ).toEqual([]);
  expect(store.deletedUploadCalls).toEqual([
    {
      actorUid: "coach-2",
      paths: ["teams/team-1/games/game-1/stat-sheet-1.png"],
    },
  ]);
  expect(store.game.statSheetPhotoUrl).toBeUndefined();
  await expect(page.locator("#stat-sheet-img")).toBeHidden();
  await expect(page.locator("#stat-sheet-link")).not.toHaveAttribute("href");
  await expect(page.locator("#stat-sheet-status")).not.toHaveText("Saved.");

  await page.locator("#stat-sheet-file-input").setInputFiles({
    name: "manager-b-sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from("manager-b"),
  });
  await page.locator("#stat-sheet-save").click();
  await expect
    .poll(async () => (await readStore(page)).statSheetUploadCalls?.length || 0)
    .toBe(2);
  store = await readStore(page);
  expect(store.statSheetUploadCalls.map(({ actorUid }) => actorUid)).toEqual([
    "coach-1",
    "coach-2",
  ]);
  expect(
    store.updateGameCalls.filter((call) =>
      Object.hasOwn(call.patch || {}, "statSheetPhotoUrl"),
    ),
  ).toHaveLength(1);
  expect(store.updateGameCalls.at(-1)).toMatchObject({ actorUid: "coach-2" });

  await page.locator("#edit-stats-btn").click();
  await page.locator('[data-stat-field="pts"]').fill("12");
  await page.locator("#stats-save-btn").click();
  await expect
    .poll(
      async () =>
        (await readStore(page)).setCompletedGamePlayerStatsCalls?.length || 0,
    )
    .toBe(1);

  await page.locator("#edit-team-stats-btn").click();
  await page.locator('[data-team-stat-field="turnovers"]').fill("9");
  await page.locator("#team-stats-save-btn").click();
  await expect
    .poll(
      async () =>
        (await readStore(page)).setCompletedGameTeamStatsCalls?.length || 0,
    )
    .toBe(1);

  await page
    .locator("#replay-video-url")
    .fill("https://www.youtube.com/watch?v=0IuY8Oryi1k");
  await page.locator("#replay-video-title").fill("Manager B replay");
  await page.locator("#replay-video-save").click();
  await expect
    .poll(async () => (await readStore(page)).runTransactionCalls?.length || 0)
    .toBe(1);
  await expect(page.locator("#replay-video-status")).toContainText(
    "Replay linked",
  );

  store = await readStore(page);
  expect(store.setCompletedGamePlayerStatsCalls[0].actorUid).toBe("coach-2");
  expect(store.setCompletedGameTeamStatsCalls[0].actorUid).toBe("coach-2");
  expect(store.runTransactionCalls[0].actorUid).toBe("coach-2");
  expect(pageErrors).toEqual([]);
});

test("a committed stat-sheet update survives a lost response without deleting its upload", async ({
  page,
  baseURL,
}) => {
  const scenario = createScenario();
  scenario.nextUpdateGameMode = "commit-then-reject";
  await installMocks(page, scenario, { controllableAuth: true });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#stat-sheet-admin")).toBeVisible();
  await page.locator("#stat-sheet-file-input").setInputFiles({
    name: "committed-sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from("committed"),
  });
  await page.locator("#stat-sheet-save").click();

  await expect(page.locator("#stat-sheet-status")).toHaveText("Saved.");
  await expect(page.locator("#stat-sheet-img")).toHaveAttribute(
    "src",
    "https://cdn.example.com/stat-sheet-1.png",
  );
  const store = await readStore(page);
  expect(store.game.statSheetPhotoUrl).toBe(
    "https://cdn.example.com/stat-sheet-1.png",
  );
  expect(store.getGameCalls).toHaveLength(2);
  expect(store.deletedUploadCalls || []).toEqual([]);
});

test("a definitively rejected stat-sheet update deletes only the new upload", async ({
  page,
  baseURL,
}) => {
  const scenario = createScenario();
  scenario.nextUpdateGameMode = "reject";
  await installMocks(page, scenario, { controllableAuth: true });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#stat-sheet-file-input").setInputFiles({
    name: "rejected-sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from("rejected"),
  });
  await page.locator("#stat-sheet-save").click();

  await expect
    .poll(async () => (await readStore(page)).deletedUploadCalls?.length || 0)
    .toBe(1);
  const store = await readStore(page);
  expect(store.game.statSheetPhotoUrl).toBeUndefined();
  expect(store.getGameCalls).toHaveLength(2);
  expect(store.deletedUploadCalls).toEqual([
    {
      actorUid: "coach-1",
      paths: ["teams/team-1/games/game-1/stat-sheet-1.png"],
    },
  ]);
  await expect(page.locator("#stat-sheet-img")).toBeHidden();
  await expect(page.locator("#stat-sheet-status")).toContainText("Error:");
});

test("a false stat-sheet persistence result is reconciled as a failed write", async ({
  page,
  baseURL,
}) => {
  const scenario = createScenario();
  scenario.nextUpdateGameMode = "return-false";
  await installMocks(page, scenario, { controllableAuth: true });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#stat-sheet-file-input").setInputFiles({
    name: "false-result-sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from("false-result"),
  });
  await page.locator("#stat-sheet-save").click();

  await expect
    .poll(async () => (await readStore(page)).deletedUploadCalls?.length || 0)
    .toBe(1);
  const store = await readStore(page);
  expect(store.game.statSheetPhotoUrl).toBeUndefined();
  expect(store.getGameCalls).toHaveLength(2);
  expect(store.deletedUploadCalls[0].paths).toEqual([
    "teams/team-1/games/game-1/stat-sheet-1.png",
  ]);
  await expect(page.locator("#stat-sheet-status")).toContainText(
    "could not be saved",
  );
});

test("an unavailable stat-sheet reconciliation retains the upload and reports uncertainty", async ({
  page,
  baseURL,
}) => {
  const scenario = createScenario();
  scenario.nextUpdateGameMode = "reject-unknown";
  await installMocks(page, scenario, { controllableAuth: true });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#stat-sheet-file-input").setInputFiles({
    name: "unknown-sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from("unknown"),
  });
  await page.locator("#stat-sheet-save").click();

  await expect(page.locator("#stat-sheet-status")).toContainText(
    "Could not confirm whether the stat sheet was saved",
  );
  const store = await readStore(page);
  expect(store.game.statSheetPhotoUrl).toBeUndefined();
  expect(store.getGameCalls).toEqual([
    { actorUid: "coach-1", failed: false },
    { actorUid: "coach-1", failed: true },
  ]);
  expect(store.deletedUploadCalls || []).toEqual([]);
  await expect(page.locator("#stat-sheet-img")).toBeHidden();
});

test("an auth transition preserves a committed stat-sheet upload after its response is lost", async ({
  page,
  baseURL,
}) => {
  const scenario = createScenario();
  scenario.nextUpdateGameMode = "hold-commit-then-reject";
  await installMocks(page, scenario, {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#stat-sheet-file-input").setInputFiles({
    name: "transition-committed.png",
    mimeType: "image/png",
    buffer: Buffer.from("transition-committed"),
  });
  await page.locator("#stat-sheet-save").click();
  await expect
    .poll(async () => (await readStore(page)).updateGameCalls?.length || 0)
    .toBe(1);

  await page.evaluate(() => {
    window.__GAME_AUTH_CALLBACK__({
      uid: "coach-2",
      email: "second@example.com",
    });
  });
  await expect(page.locator("#stat-sheet-img")).toHaveAttribute(
    "src",
    "https://cdn.example.com/stat-sheet-1.png",
  );
  await page.evaluate(() => window.__GAME_RELEASE_UPDATE_GAME__());
  await page.waitForTimeout(100);

  const store = await readStore(page);
  expect(store.game.statSheetPhotoUrl).toBe(
    "https://cdn.example.com/stat-sheet-1.png",
  );
  expect(store.getGameCalls).toHaveLength(3);
  expect(store.getGameCalls.at(-1).actorUid).toBe("coach-2");
  expect(store.deletedUploadCalls || []).toEqual([]);
  await expect(page.locator("#stat-sheet-img")).toHaveAttribute(
    "src",
    "https://cdn.example.com/stat-sheet-1.png",
  );
});

test("an auth transition cleans a definitively uncommitted stat-sheet upload without stale UI", async ({
  page,
  baseURL,
}) => {
  const scenario = createScenario();
  scenario.nextUpdateGameMode = "hold-reject";
  await installMocks(page, scenario, {
    controllableAuth: true,
    accessLevel: "full",
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#stat-sheet-file-input").setInputFiles({
    name: "transition-rejected.png",
    mimeType: "image/png",
    buffer: Buffer.from("transition-rejected"),
  });
  await page.locator("#stat-sheet-save").click();
  await expect
    .poll(async () => (await readStore(page)).updateGameCalls?.length || 0)
    .toBe(1);

  await page.evaluate(() => window.__GAME_AUTH_CALLBACK__(null));
  await expect(page.locator("#stat-sheet-admin")).toBeHidden();
  await expect
    .poll(async () => (await readStore(page)).getGameCalls?.length || 0)
    .toBe(2);
  await page.evaluate(() => window.__GAME_RELEASE_UPDATE_GAME__());
  await expect
    .poll(async () => (await readStore(page)).deletedUploadCalls?.length || 0)
    .toBe(1);

  const store = await readStore(page);
  expect(store.game.statSheetPhotoUrl).toBeUndefined();
  expect(store.getGameCalls).toHaveLength(3);
  expect(store.getGameCalls.at(-1).actorUid).toBe("");
  expect(store.deletedUploadCalls).toEqual([
    {
      actorUid: "",
      paths: ["teams/team-1/games/game-1/stat-sheet-1.png"],
    },
  ]);
  await expect(page.locator("#stat-sheet-admin")).toBeHidden();
  await expect(page.locator("#stat-sheet-img")).toBeHidden();
  await expect(page.locator("#stat-sheet-status")).toBeEmpty();
});

test("a committed stat-sheet removal is reflected after its response is lost", async ({
  page,
  baseURL,
}) => {
  const scenario = createScenario();
  scenario.game.statSheetPhotoUrl = "https://cdn.example.com/original-sheet.png";
  scenario.nextUpdateGameMode = "commit-then-reject";
  await installMocks(page, scenario, { controllableAuth: true });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#stat-sheet-img")).toBeVisible();
  await page.locator("#stat-sheet-remove").click();

  await expect(page.locator("#stat-sheet-status")).toHaveText("Removed.");
  await expect(page.locator("#stat-sheet-img")).toBeHidden();
  await expect(page.locator("#stat-sheet-link")).not.toHaveAttribute("href");
  const store = await readStore(page);
  expect(store.game.statSheetPhotoUrl).toBeNull();
  expect(store.getGameCalls).toHaveLength(2);
  expect(store.deletedUploadCalls || []).toEqual([]);
});

test("an unknown stat-sheet removal retains the current presentation and reports uncertainty", async ({
  page,
  baseURL,
}) => {
  const scenario = createScenario();
  scenario.game.statSheetPhotoUrl = "https://cdn.example.com/original-sheet.png";
  scenario.nextUpdateGameMode = "reject-unknown";
  await installMocks(page, scenario, { controllableAuth: true });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#stat-sheet-remove").click();

  await expect(page.locator("#stat-sheet-status")).toContainText(
    "Could not confirm whether the stat sheet was removed",
  );
  await expect(page.locator("#stat-sheet-img")).toHaveAttribute(
    "src",
    "https://cdn.example.com/original-sheet.png",
  );
  const store = await readStore(page);
  expect(store.game.statSheetPhotoUrl).toBe(
    "https://cdn.example.com/original-sheet.png",
  );
  expect(store.getGameCalls.at(-1)).toEqual({
    actorUid: "coach-1",
    failed: true,
  });
  expect(store.deletedUploadCalls || []).toEqual([]);
});

test("completed-game manager links, replaces, and removes a YouTube replay", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", async (dialog) => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  const scenario = createScenario();
  scenario.game.liveStatus = "scheduled";
  scenario.game.recordedVideo = { url: "https://cdn.example/older-replay.mp4" };
  scenario.game.replayVideoPublicUrl = "https://video.example/older-replay";
  scenario.game.videoUrl = "https://youtu.be/PK1HyC37doc";
  await installMocks(page, scenario);

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);

  const replayAdmin = page.locator("#replay-video-admin");
  const replayAction = page.locator("#replay-report-action");
  await expect(replayAdmin).toBeVisible();
  await expect(page.locator("#replay-video-current")).toContainText(
    "A non-YouTube replay is attached",
  );
  await expect(replayAction).toContainText("Replay Unavailable");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page
    .locator("#replay-video-url")
    .fill(
      "https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ",
    );
  await page.locator("#replay-video-save").click();
  await expect(page.locator("#replay-video-status")).toContainText(
    "Paste a valid YouTube video link",
  );

  await page
    .locator("#replay-video-url")
    .fill("https://www.youtube.com/watch?v=0IuY8Oryi1k&t=90");
  await page.locator("#replay-video-title").fill("Vipers vs Captains replay");
  await page.locator("#replay-video-save").click();
  await expect(page.locator("#replay-video-status")).toContainText(
    "Replay linked",
  );
  await expect(
    replayAction.getByRole("link", { name: "Watch Replay" }),
  ).toBeVisible();

  let store = await readStore(page);
  expect(store.game.replayVideo).toMatchObject({
    provider: "youtube",
    videoId: "0IuY8Oryi1k",
    embedUrl: "https://www.youtube.com/embed/0IuY8Oryi1k",
    publicUrl: "https://www.youtube.com/watch?v=0IuY8Oryi1k",
    title: "Vipers vs Captains replay",
    status: "ready",
    linkedBy: "coach-1",
  });
  expect(store.game.recordedVideo).toBeUndefined();
  expect(store.game.replayVideoPublicUrl).toBeUndefined();
  expect(store.game.videoUrl).toBe("https://youtu.be/PK1HyC37doc");

  await page
    .locator("#replay-video-url")
    .fill("https://youtu.be/dQw4w9WgXcQ?si=replacement");
  await page.locator("#replay-video-title").fill("Replacement replay");
  await page.locator("#replay-video-save").click();
  await expect(page.locator("#replay-video-status")).toContainText(
    "Replay linked",
  );

  store = await readStore(page);
  expect(store.game.replayVideo).toMatchObject({
    provider: "youtube",
    videoId: "dQw4w9WgXcQ",
    publicUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Replacement replay",
    status: "ready",
  });

  await page.locator("#replay-video-remove").click();
  await expect(page.locator("#replay-video-status")).toContainText(
    "Replay removed",
  );
  await expect(replayAction).toContainText("Replay Unavailable");

  store = await readStore(page);
  expect(store.game.replayVideo).toBeNull();
  expect(store.game.recordedVideo).toBeUndefined();
  expect(store.game.replayVideoPublicUrl).toBeUndefined();
  expect(store.game.videoUrl).toBe("https://youtu.be/PK1HyC37doc");
  expect(store.game.replayVideoFallbackDisabled).toBe(true);

  // A second write without refreshing must use the retained videoUrl and
  // tombstone in its CAS state, then clear only the tombstone on relink.
  await page.locator("#replay-video-url").fill("https://youtu.be/PK1HyC37doc");
  await page.locator("#replay-video-title").fill("Relinked replay");
  await page.locator("#replay-video-save").click();
  await expect(page.locator("#replay-video-status")).toContainText(
    "Replay linked",
  );
  store = await readStore(page);
  expect(store.game.replayVideo).toMatchObject({
    videoId: "PK1HyC37doc",
    title: "Relinked replay",
    status: "ready",
  });
  expect(store.game.videoUrl).toBe("https://youtu.be/PK1HyC37doc");
  expect(store.game.replayVideoFallbackDisabled).toBeUndefined();
  expect(pageErrors).toEqual([]);
});

test("completed statsheet game with only an attached clip does not advertise a full replay", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.game.liveStatus = "scheduled";
  scenario.game.highlightClips = [
    {
      type: "score-linked",
      title: "Putback clip",
      mediaUrl: "https://cdn.example.com/putback.mp4",
    },
  ];
  await installMocks(page, scenario);

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);

  const replayAction = page.locator("#replay-report-action");
  await expect(
    replayAction.getByRole("link", { name: "Watch Replay" }),
  ).toHaveCount(0);
  await expect(replayAction).toContainText("Replay Unavailable");
  expect(pageErrors).toEqual([]);
});

test("manager can remove an existing replay after a final game is corrected to non-final", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", async (dialog) => dialog.accept());
  const scenario = createScenario();
  scenario.game.status = "scheduled";
  scenario.game.liveStatus = "scheduled";
  scenario.game.replayVideo = {
    provider: "youtube",
    videoId: "0IuY8Oryi1k",
    embedUrl: "https://www.youtube.com/embed/0IuY8Oryi1k",
    publicUrl: "https://www.youtube.com/watch?v=0IuY8Oryi1k",
    title: "Correction cleanup replay",
    status: "ready",
    linkedBy: "coach-1",
    linkedAt: "2026-09-01T12:00:00.000Z",
  };
  await installMocks(page, scenario);

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);

  await expect(page.locator("#replay-video-admin")).toBeVisible();
  await expect(page.locator("#replay-video-link-fields")).toBeHidden();
  await expect(page.locator("#replay-video-save")).toBeHidden();
  await expect(page.locator("#replay-video-remove")).toBeVisible();
  await expect(page.locator("#replay-video-help")).toContainText(
    "no longer final",
  );

  await page.locator("#replay-video-remove").click();
  await expect(page.locator("#replay-video-status")).toContainText(
    "Replay removed",
  );
  await expect(page.locator("#replay-video-admin")).toBeVisible();
  await expect(page.locator("#replay-video-status")).toBeVisible();
  await expect(page.locator("#replay-video-heading")).toBeFocused();

  const store = await readStore(page);
  expect(store.game.replayVideo).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("delegated full manager can remove a stale replay when direct team access is unavailable", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", async (dialog) => dialog.accept());
  const scenario = createScenario();
  scenario.game.status = "scheduled";
  scenario.game.liveStatus = "scheduled";
  scenario.game.replayVideo = {
    provider: "youtube",
    videoId: "0IuY8Oryi1k",
    embedUrl: "https://www.youtube.com/embed/0IuY8Oryi1k",
    publicUrl: "https://www.youtube.com/watch?v=0IuY8Oryi1k",
    status: "ready",
    linkedBy: "coach-1",
    linkedAt: "2026-09-01T12:00:00.000Z",
  };
  scenario.delegatedTeam = {
    id: "team-1",
    name: "Comets",
    isDelegatedTeamContext: true,
    delegatedAccess: { full: true },
    teamPermissions: {
      videography: { mode: "selected", memberIds: ["coach-1"] },
    },
  };
  await installMocks(page, scenario, {
    accessLevel: "videographer",
    directAccess: false,
  });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.locator("#replay-video-remove")).toBeVisible();

  await page.locator("#replay-video-remove").click();
  await expect(page.locator("#replay-video-status")).toContainText(
    "Replay removed",
  );

  const store = await readStore(page);
  expect(store.game.replayVideo).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("replay transaction rejects a game that became a shared-schedule mirror after load", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMocks(page, createScenario());

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.locator("#replay-video-admin")).toBeVisible();

  await page.evaluate((storeKey) => {
    const store = JSON.parse(localStorage.getItem(storeKey) || "{}");
    store.game.sharedScheduleId = "shared_team-1_game-1";
    store.game.sharedScheduleOpponentTeamId = "team-2";
    store.game.sharedScheduleOpponentGameId = "game-2";
    localStorage.setItem(storeKey, JSON.stringify(store));
  }, STORE_KEY);

  await page.locator("#replay-video-url").fill("https://youtu.be/0IuY8Oryi1k");
  await page.locator("#replay-video-save").click();
  await expect(page.locator("#replay-video-status")).toContainText(
    "now part of a shared schedule",
  );

  const store = await readStore(page);
  expect(store.game.replayVideo).toBeUndefined();
  expect(pageErrors).toEqual([]);
});

test("legacy replay controls fail closed for a retained videographer ID when the mode is disabled", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.team.teamPermissions = {
    videography: { mode: "disabled", memberIds: ["coach-1"] },
  };
  await installMocks(page, scenario, { accessLevel: "videographer" });

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.locator("#replay-video-admin")).toBeHidden();
});

test("legacy replay controls do not offer a write for noncanonical uppercase lifecycle values", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const scenario = createScenario();
  scenario.game.status = "FINAL";
  scenario.game.liveStatus = "FINAL";
  await installMocks(page, scenario);

  await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, {
    waitUntil: "domcontentloaded",
  });
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.locator("#replay-video-admin")).toBeHidden();
});
