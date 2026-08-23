import { getApps, initializeApp } from '../../js/vendor/firebase-app.js';
import {
    collection,
    doc,
    getDocs,
    getFirestore,
    limit,
    onSnapshot,
    orderBy,
    query
} from '../../js/vendor/firebase-firestore.js';

// This manual adapter is excluded from production bundles. It lets the
// read-only overlay consume the same public projections and public live
// subcollections as an anonymous production viewer while the UI runs locally.
const FIREBASE_CONFIG = Object.freeze({
    apiKey: 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc',
    authDomain: 'game-flow-c6311.firebaseapp.com',
    projectId: 'game-flow-c6311',
    storageBucket: 'game-flow-c6311.firebasestorage.app',
    messagingSenderId: '982493478258',
    appId: '1:982493478258:web:1f942c420cef6c40e8b1eb'
});
const APP_NAME = 'allplays-overlay-production-readonly';
const FUNCTIONS_ORIGIN = 'https://us-central1-game-flow-c6311.cloudfunctions.net';

const app = getApps().find((candidate) => candidate.name === APP_NAME)
    || initializeApp(FIREBASE_CONFIG, APP_NAME);
const database = getFirestore(app);

function requireDocumentId(value, label) {
    const candidate = String(value || '').trim();
    if (!candidate || candidate === '.' || candidate === '..' || candidate.includes('/')) {
        throw new Error(`${label} is invalid.`);
    }
    return candidate;
}

function gameRef(teamId, gameId) {
    return doc(
        database,
        'teams',
        requireDocumentId(teamId, 'teamId'),
        'games',
        requireDocumentId(gameId, 'gameId')
    );
}

function gameCollection(teamId, gameId, collectionName) {
    return collection(gameRef(teamId, gameId), collectionName);
}

async function callPublicProjection(functionName, data) {
    const response = await fetch(`${FUNCTIONS_ORIGIN}/${functionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        const message = payload?.error?.message || `Public projection failed (${response.status}).`;
        throw new Error(message);
    }
    return payload?.result?.item || null;
}

function mapPublicGameProjection(game = {}, teamId = '') {
    const startsAt = game?.startsAt ? new Date(game.startsAt) : null;
    const endsAt = game?.endsAt ? new Date(game.endsAt) : null;
    const isHome = game?.isHome !== false;
    const teamScore = Number.isFinite(game?.teamScore) ? game.teamScore : null;
    const opponentScore = Number.isFinite(game?.opponentScore) ? game.opponentScore : null;
    return {
        ...game,
        id: String(game?.id || ''),
        teamId,
        type: 'game',
        date: startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : null,
        endDate: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
        opponent: String(game?.opponent || 'TBD'),
        location: String(game?.location || ''),
        isHome,
        status: String(game?.status || 'scheduled'),
        liveStatus: String(game?.status || 'scheduled'),
        homeScore: isHome ? teamScore : opponentScore,
        awayScore: isHome ? opponentScore : teamScore,
        videoUrl: game?.videoUrl || null,
        opponentStats: game?.opponentStats || {},
        isPublicProjection: true
    };
}

function snapshotItems(snapshot) {
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function getGameDayTeamContext(teamId) {
    return callPublicProjection('getPublicTeamProfile', {
        teamId: requireDocumentId(teamId, 'teamId')
    });
}

export async function getGame(teamId, gameId) {
    const normalizedTeamId = requireDocumentId(teamId, 'teamId');
    const item = await callPublicProjection('getPublicGameProjection', {
        teamId: normalizedTeamId,
        gameId: requireDocumentId(gameId, 'gameId')
    });
    return item ? mapPublicGameProjection(item, normalizedTeamId) : null;
}

export async function getPlayers(teamId, options = {}) {
    const snapshot = await getDocs(collection(
        database,
        'teams',
        requireDocumentId(teamId, 'teamId'),
        'players'
    ));
    const players = snapshotItems(snapshot).sort((left, right) => {
        const leftNumber = Number.parseInt(String(left.number ?? ''), 10);
        const rightNumber = Number.parseInt(String(right.number ?? ''), 10);
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
        if (Number.isFinite(leftNumber)) return -1;
        if (Number.isFinite(rightNumber)) return 1;
        return String(left.name || '').localeCompare(String(right.name || ''));
    });
    return options.includeInactive ? players : players.filter((player) => player.active !== false);
}

export function subscribeGame(teamId, gameId, callback, onError) {
    let stopped = false;
    const poll = async () => {
        try {
            const game = await getGame(teamId, gameId);
            if (!stopped) callback(game);
        } catch (error) {
            if (!stopped && typeof onError === 'function') onError(error);
        }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => {
        stopped = true;
        window.clearInterval(timer);
    };
}

export function subscribeLiveEvents(teamId, gameId, callback, onError) {
    const eventsQuery = query(gameCollection(teamId, gameId, 'liveEvents'), orderBy('createdAt', 'asc'));
    return onSnapshot(eventsQuery, (snapshot) => callback(snapshotItems(snapshot)), onError);
}

export async function getLiveEvents(teamId, gameId) {
    const eventsQuery = query(gameCollection(teamId, gameId, 'liveEvents'), orderBy('createdAt', 'asc'));
    return snapshotItems(await getDocs(eventsQuery));
}

export function subscribeLiveChat(teamId, gameId, options, callback, onError) {
    const chatQuery = query(
        gameCollection(teamId, gameId, 'liveChat'),
        orderBy('createdAt', 'desc'),
        limit(options.limit || 100)
    );
    return onSnapshot(chatQuery, (snapshot) => callback(snapshotItems(snapshot)), onError);
}

export async function getLiveChatHistory(teamId, gameId) {
    const chatQuery = query(gameCollection(teamId, gameId, 'liveChat'), orderBy('createdAt', 'asc'));
    return snapshotItems(await getDocs(chatQuery));
}

export function subscribeReactions(teamId, gameId, callback, onError) {
    const reactionsQuery = query(
        gameCollection(teamId, gameId, 'liveReactions'),
        orderBy('createdAt', 'desc'),
        limit(20)
    );
    return onSnapshot(reactionsQuery, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') callback({ id: change.doc.id, ...change.doc.data() });
        });
    }, onError);
}

export async function getLiveReactions(teamId, gameId) {
    const reactionsQuery = query(gameCollection(teamId, gameId, 'liveReactions'), orderBy('createdAt', 'asc'));
    return snapshotItems(await getDocs(reactionsQuery));
}
