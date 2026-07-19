// Pure domain logic for the AllPlays ChatGPT MCP service.
//
// Identity comes from the verified token (never from tool arguments), and every
// tool re-derives team membership from Firestore before returning data. The
// Firestore Admin handle is injected so this module stays testable without
// firebase-admin.

export const APP_BASE_URL = 'https://allplays.ai';
export const DEFAULT_SCHEDULE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_EVENTS_PER_TEAM = 50;
const MAX_PLAYER_STATS = 60;

export class DomainError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'DomainError';
        this.code = code;
    }
}

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(value) {
    const date = toDate(value);
    return date ? date.toISOString() : null;
}

function cleanString(value) {
    return typeof value === 'string' ? value : '';
}

function parseParentPlayerKey(value) {
    if (typeof value !== 'string') return null;
    const separatorIndex = value.indexOf('::');
    if (separatorIndex <= 0 || separatorIndex >= value.length - 2) return null;
    const teamId = value.slice(0, separatorIndex).trim();
    const playerId = value.slice(separatorIndex + 2).trim();
    return teamId && playerId ? { teamId, playerId } : null;
}

// With user-credentialed Firestore access, rules can deny individual reads.
// Treat those documents as absent rather than failing the whole tool call;
// the caller's rules-authorized downstream reads remain the enforcement point.
async function safeGetDoc(db, path) {
    try {
        return await db.doc(path).get();
    } catch (error) {
        if (error instanceof DomainError && error.code === 'permission_denied') {
            return { exists: false, id: path.split('/').pop(), data: () => undefined };
        }
        throw error;
    }
}

/**
 * Build the caller's authorization context from Firestore. Roles are always
 * re-derived per request; nothing supplied by the model is trusted.
 */
export async function resolveUserContext(db, { uid, email }) {
    if (!uid) throw new DomainError('unauthenticated', 'Missing authenticated user.');

    const userSnap = await safeGetDoc(db, `users/${uid}`);
    const profile = userSnap.exists ? userSnap.data() || {} : {};
    const normalizedEmail = normalizeEmail(email || profile.email);
    const legacyParentLinks = (Array.isArray(profile.parentOf) ? profile.parentOf : [])
        .filter((link) => link && typeof link.teamId === 'string' && link.teamId);
    const parentTeamIds = new Set([
        ...legacyParentLinks.map((link) => link.teamId),
        ...(Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : [])
            .filter((teamId) => typeof teamId === 'string' && teamId)
    ]);
    const linkedPlayerIdsByTeam = new Map();
    const addLinkedPlayer = (teamId, playerId) => {
        if (!teamId || !playerId) return;
        parentTeamIds.add(teamId);
        if (!linkedPlayerIdsByTeam.has(teamId)) linkedPlayerIdsByTeam.set(teamId, new Set());
        linkedPlayerIdsByTeam.get(teamId).add(playerId);
    };
    for (const link of legacyParentLinks) {
        if (typeof link.playerId === 'string') addLinkedPlayer(link.teamId, link.playerId);
    }
    for (const value of Array.isArray(profile.parentPlayerKeys) ? profile.parentPlayerKeys : []) {
        const link = parseParentPlayerKey(value);
        if (link) addLinkedPlayer(link.teamId, link.playerId);
    }

    const [ownedSnap, adminSnap] = await Promise.all([
        db.collection('teams').where('ownerId', '==', uid).get(),
        normalizedEmail
            ? db.collection('teams').where('adminEmails', 'array-contains', normalizedEmail).get()
            : Promise.resolve({ docs: [] })
    ]);

    const teams = new Map();
    const addTeam = (teamId, teamData, role) => {
        if (!teams.has(teamId)) {
            teams.set(teamId, { teamId, team: teamData || {}, roles: new Set(), linkedPlayerIds: new Set() });
        }
        teams.get(teamId).roles.add(role);
    };

    for (const doc of ownedSnap.docs) addTeam(doc.id, doc.data(), 'owner');
    for (const doc of adminSnap.docs) addTeam(doc.id, doc.data(), 'admin');

    const parentTeamSnaps = await Promise.all([...parentTeamIds].map((teamId) => safeGetDoc(db, `teams/${teamId}`)));
    for (const snap of parentTeamSnaps) {
        // Private team documents are not parent-readable, even though their
        // games are. Keep the rules-derived parent scope with empty metadata.
        addTeam(snap.id, snap.exists ? snap.data() : {}, 'parent');
    }
    for (const [teamId, playerIds] of linkedPlayerIdsByTeam) {
        const entry = teams.get(teamId);
        for (const playerId of playerIds) entry?.linkedPlayerIds.add(playerId);
    }

    return {
        uid,
        email: normalizedEmail,
        isGlobalAdmin: profile.isAdmin === true,
        teams
    };
}

function requireTeamAccess(context, teamId) {
    if (typeof teamId !== 'string' || !teamId) {
        throw new DomainError('invalid_argument', 'teamId is required.');
    }
    const entry = context.teams.get(teamId);
    if (!entry && !context.isGlobalAdmin) {
        throw new DomainError('permission_denied', 'You do not have access to this team.');
    }
    return entry || null;
}

export async function listMyTeams(db, context) {
    const teams = [];
    for (const entry of context.teams.values()) {
        const linkedPlayers = [];
        for (const playerId of entry.linkedPlayerIds) {
            const snap = await safeGetDoc(db, `teams/${entry.teamId}/players/${playerId}`);
            if (!snap.exists) continue;
            const data = snap.data() || {};
            linkedPlayers.push({
                playerId: snap.id,
                name: cleanString(data.name),
                number: data.number ?? null
            });
        }
        teams.push({
            teamId: entry.teamId,
            name: cleanString(entry.team.name),
            sport: cleanString(entry.team.sport) || null,
            roles: [...entry.roles].sort(),
            linkedPlayers
        });
    }
    teams.sort((a, b) => a.name.localeCompare(b.name));
    return { teams };
}

function parseScheduleRange({ startDate, endDate } = {}, now = new Date()) {
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (Number.isNaN(start.getTime())) throw new DomainError('invalid_argument', 'startDate is not a valid date.');
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + DEFAULT_SCHEDULE_DAYS * MS_PER_DAY);
    if (Number.isNaN(end.getTime())) throw new DomainError('invalid_argument', 'endDate is not a valid date.');
    if (end < start) throw new DomainError('invalid_argument', 'endDate must be after startDate.');
    return { start, end };
}

function gameDeepLink(teamId, gameId, { replay = false } = {}) {
    const params = new URLSearchParams({ teamId, gameId });
    if (replay) params.set('replay', 'true');
    return `${APP_BASE_URL}/live-game.html?${params.toString()}`;
}

function whitelistRsvp(data, linkedPlayerIds) {
    if (!data) return null;
    const playerIds = (Array.isArray(data.playerIds) ? data.playerIds : [data.playerId])
        .filter((id) => typeof id === 'string' && id);
    return {
        response: cleanString(data.response || data.status) || 'not_responded',
        playerIds: playerIds.filter((id) => linkedPlayerIds.has(id))
    };
}

function whitelistRsvpSummary(summary) {
    if (!summary || typeof summary !== 'object') return null;
    const out = {};
    for (const key of ['going', 'maybe', 'notGoing', 'notResponded', 'total']) {
        if (typeof summary[key] === 'number') out[key] = summary[key];
    }
    return Object.keys(out).length ? out : null;
}

export async function getFamilySchedule(db, context, args = {}, now = new Date()) {
    const { start, end } = parseScheduleRange(args, now);
    const events = [];

    for (const entry of context.teams.values()) {
        const snap = await db.collection(`teams/${entry.teamId}/games`)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .orderBy('date')
            .limit(MAX_EVENTS_PER_TEAM)
            .get();

        for (const doc of snap.docs) {
            const data = doc.data() || {};
            const event = {
                teamId: entry.teamId,
                teamName: cleanString(entry.team.name),
                gameId: doc.id,
                type: data.type === 'practice' ? 'practice' : 'game',
                date: toIso(data.date),
                opponent: cleanString(data.opponent) || cleanString(data.opponentTeamName) || null,
                location: cleanString(data.location) || null,
                rsvpSummary: whitelistRsvpSummary(data.rsvpSummary),
                myRsvp: null,
                linkedPlayerIds: [...entry.linkedPlayerIds],
                deepLink: gameDeepLink(entry.teamId, doc.id)
            };

            if (entry.roles.has('parent')) {
                const rsvpSnap = await safeGetDoc(db, `teams/${entry.teamId}/games/${doc.id}/rsvps/${context.uid}`);
                event.myRsvp = rsvpSnap.exists
                    ? whitelistRsvp(rsvpSnap.data(), entry.linkedPlayerIds)
                    : { response: 'not_responded', playerIds: [] };
            }

            events.push(event);
        }
    }

    events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        events
    };
}

const GAME_SUMMARY_FIELDS = [
    'type', 'opponent', 'opponentTeamName', 'location', 'liveStatus', 'status',
    'homeScore', 'awayScore', 'isHome', 'summary', 'aiSummary', 'result'
];

export async function getGameSummary(db, context, { teamId, gameId } = {}) {
    const entry = requireTeamAccess(context, teamId);
    if (typeof gameId !== 'string' || !gameId) {
        throw new DomainError('invalid_argument', 'gameId is required.');
    }

    const gameSnap = await db.doc(`teams/${teamId}/games/${gameId}`).get();
    if (!gameSnap.exists) throw new DomainError('not_found', 'Game not found.');
    const data = gameSnap.data() || {};

    const game = { gameId: gameSnap.id, teamId, teamName: cleanString(entry?.team?.name), date: toIso(data.date) };
    for (const field of GAME_SUMMARY_FIELDS) {
        if (data[field] !== undefined) game[field] = data[field];
    }
    game.rsvpSummary = whitelistRsvpSummary(data.rsvpSummary);

    let statsSnap = { docs: [] };
    try {
        statsSnap = await db.collection(`teams/${teamId}/games/${gameId}/aggregatedStats`)
            .limit(MAX_PLAYER_STATS)
            .get();
    } catch (error) {
        if (!(error instanceof DomainError && error.code === 'permission_denied')) throw error;
    }
    const playerStats = statsSnap.docs.map((doc) => {
        const stats = doc.data() || {};
        return {
            playerId: doc.id,
            playerName: cleanString(stats.playerName) || null,
            playerNumber: stats.playerNumber ?? null,
            stats: Object.fromEntries(Object.entries(stats)
                .filter(([key, value]) => typeof value === 'number' && !['playerNumber'].includes(key)))
        };
    });

    return {
        game,
        playerStats,
        deepLink: gameDeepLink(teamId, gameId, { replay: true })
    };
}
