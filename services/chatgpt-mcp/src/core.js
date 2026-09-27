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
const MAX_TRACKED_CALENDAR_EVENTS_PER_TEAM = 5000;
const MAX_CALENDAR_PROJECTION_PAGES = 20;
const MAX_PLAYER_STATS = 60;
const MAX_DIAMOND_PUBLIC_PLAYER_STATS = 50;
const MAX_DIAMOND_STAT_KEYS = 256;
const MAX_DIAMOND_LOAD_ATTEMPTS = 2;
const DIAMOND_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIAMOND_SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DIAMOND_SAFE_RESOURCE_ID = /^[^/]{1,128}$/u;
const DIAMOND_SAFE_STAT_KEY = /^[a-z0-9][a-z0-9_]{0,63}$/;
const DIAMOND_INNINGS_PITCHED_VALUE = /^(?:0|[1-9][0-9]*)\.[012]$/;
const DIAMOND_COVERAGE_STATUSES = new Set(['complete', 'partial', 'not_collected']);
const DIAMOND_PLAYER_STAT_IDS = new Set(`
g gs pa ab r h 1b 2b 3b hr tb rbi bb ibb hbp so sf sh roe fc gidp
avg obp slg ops bb_rate strikeout_rate sb cs pickoffs br_advances br_outs stolen_base_rate
p_app p_gs w l sv bf ip_outs p_h p_r er p_bb p_ibb p_hbp p_so p_hr wp balk_illegal_pitch
inherited_runners inherited_scored pitches strikes first_pitch_strikes innings_pitched era whip
strikeout_walk_ratio strike_rate first_pitch_strike_rate defensive_outs po a e dp tp pb fp fpct chances
`.trim().split(/\s+/));
const DIAMOND_DERIVED_PLAYER_STAT_IDS = new Set(`
avg obp slg ops bb_rate strikeout_rate stolen_base_rate innings_pitched era whip
strikeout_walk_ratio strike_rate first_pitch_strike_rate fpct chances
`.trim().split(/\s+/));
const DIAMOND_PUBLIC_PLAYER_DOCUMENT_KEYS = new Set([
    'schemaVersion', 'trackingEngine', 'projectionSchemaVersion', 'playerId', 'playerName', 'playerNumber',
    'participated', 'participationStatus', 'participationSource', 'didNotPlay', 'sourceRevision',
    'checkpointHash', 'coverage', 'complete', 'publicStatIds', 'stats', 'observedStats', 'derivedStats',
    'observedDerivedStats', 'statCoverage', 'statSources', 'sourcePlayIds', 'unavailableDerivedStats',
    'missingStatFamilies', 'teamId', 'diamondGameId', 'instanceId', 'diamondScorebookInstanceId',
    'projectionGeneration', 'statConfigSnapshotHash', 'projectionHash'
]);
const GENERIC_CALENDAR_DISCRIMINATORS = new Set([
    '', 'tbd', 'unknown', 'practice', 'game', 'training', 'workout', 'scrimmage'
]);

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

function requireProjectionText(value, label) {
    const normalized = cleanString(value).trim();
    if (!normalized) throw new DomainError('invalid_argument', `${label} is required.`);
    return normalized;
}

function callableErrorCode(payload) {
    const status = cleanString(payload?.error?.status || payload?.error?.code).toUpperCase();
    return status.includes('NOT_FOUND') ? 'not_found' : 'unavailable';
}

export async function loadPublicTeamCalendarProjection({
    projectId,
    idToken,
    teamId,
    startDate,
    endDate,
    fetchImpl = fetch
}) {
    const normalizedProjectId = requireProjectionText(projectId, 'Firebase project ID');
    const normalizedIdToken = requireProjectionText(idToken, 'Authenticated ID token');
    const normalizedTeamId = requireProjectionText(teamId, 'teamId');
    const start = toDate(startDate);
    const end = toDate(endDate);
    if (!start || !end || end < start) {
        throw new DomainError('invalid_argument', 'A valid calendar projection date range is required.');
    }

    const requestUrl = `https://us-central1-${encodeURIComponent(normalizedProjectId)}.cloudfunctions.net/getPublicTeamCalendarProjection`;
    const events = [];
    const seenCursors = new Set();
    let cursor = '';

    for (let page = 0; page < MAX_CALENDAR_PROJECTION_PAGES; page += 1) {
        let response;
        let payload;
        try {
            response = await fetchImpl(requestUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${normalizedIdToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    data: {
                        teamId: normalizedTeamId,
                        from: start.toISOString().slice(0, 10),
                        to: end.toISOString().slice(0, 10),
                        limit: MAX_EVENTS_PER_TEAM,
                        ...(cursor ? { cursor } : {})
                    }
                })
            });
            payload = await response.json();
        } catch {
            throw new DomainError('unavailable', 'Imported calendar events are temporarily unavailable.');
        }

        const result = payload?.result || payload?.data;
        if (!response.ok || !result || !Array.isArray(result.events)) {
            throw new DomainError(
                callableErrorCode(payload),
                response.ok ? 'Imported calendar response is invalid.' : 'Imported calendar events are temporarily unavailable.'
            );
        }
        if (Array.isArray(result.warnings) && result.warnings.length > 0) {
            throw new DomainError('unavailable', 'Imported calendar events could not be loaded completely.');
        }
        events.push(...result.events);

        if (result?.range?.truncated !== true || events.length >= MAX_EVENTS_PER_TEAM) {
            return events.slice(0, MAX_EVENTS_PER_TEAM);
        }
        const nextCursor = cleanString(result.nextCursor).trim();
        if (!nextCursor || seenCursors.has(nextCursor)) {
            throw new DomainError('unavailable', 'Imported calendar pagination could not be completed.');
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
    }

    throw new DomainError('unavailable', 'Imported calendar pagination exceeded its safety limit.');
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

async function safeLegacyOwnershipQuery(query) {
    try {
        return await query.get();
    } catch (error) {
        if (error instanceof DomainError && error.code === 'permission_denied') return { docs: [] };
        throw error;
    }
}

export async function loadManagedTeamsFromCallable({ projectId, idToken, fetchImpl = fetch }) {
    if (!projectId || !idToken) {
        throw new DomainError('unauthenticated', 'Managed team discovery requires an authenticated project context.');
    }
    const requestUrl = `https://us-central1-${encodeURIComponent(projectId)}.cloudfunctions.net/listManagedTeams`;
    let response;
    try {
        response = await fetchImpl(requestUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: {} })
        });
    } catch {
        throw new DomainError('unavailable', 'Managed team discovery is unavailable.');
    }
    let payload = null;
    try {
        payload = await response?.json?.();
    } catch {
        // Missing endpoints can return HTML, while malformed successful
        // responses are classified as unavailable below.
    }
    const result = payload?.result || payload?.data;
    if (!response?.ok || !Array.isArray(result?.items)) {
        // A pre-rollout endpoint is an empty/non-callable HTTP 404. A valid
        // callable error envelope (including domain NOT_FOUND) must fail closed.
        const missingEndpoint = response?.status === 404 && !payload?.error;
        const code = missingEndpoint ? 'not_found' : 'unavailable';
        throw new DomainError(code, payload?.error?.message || 'Managed team discovery is unavailable.');
    }
    return {
        teams: result.items.filter((team) => team && typeof team === 'object' && !Array.isArray(team)),
        isPartial: result.isPartial === true
    };
}

/**
 * Build the caller's authorization context from Firestore. Roles are always
 * re-derived per request; nothing supplied by the model is trusted.
 */
export async function resolveUserContext(db, { uid, email }, { managedTeams = null } = {}) {
    if (!uid) throw new DomainError('unauthenticated', 'Missing authenticated user.');

    const userSnap = await safeGetDoc(db, `users/${uid}`);
    const profile = userSnap.exists ? userSnap.data() || {} : {};
    const normalizedEmail = normalizeEmail(email);
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

    const teams = new Map();
    const addTeam = (teamId, teamData, role) => {
        if (!teams.has(teamId)) {
            teams.set(teamId, { teamId, team: teamData || {}, roles: new Set(), linkedPlayerIds: new Set() });
        }
        teams.get(teamId).roles.add(role);
    };

    if (Array.isArray(managedTeams)) {
        for (const team of managedTeams) {
            const teamId = String(team?.id || '').trim();
            if (!teamId) continue;
            const ownerId = String(team.ownerId || '').trim();
            const ownerEmails = [...new Set([team.ownerEmailLower, team.ownerEmail].map(normalizeEmail).filter(Boolean))];
            const role = ownerId === uid || (!ownerId && ownerEmails.length === 1 && normalizedEmail === ownerEmails[0])
                ? 'owner'
                : 'admin';
            addTeam(teamId, team, role);
        }
    } else {
        const ownerEmailCandidates = [...new Set([email, normalizedEmail]
            .filter((value) => typeof value === 'string' && value))];
        const [ownedSnap, adminSnap, ownerEmailLowerSnap, ...ownerEmailSnaps] = await Promise.all([
            db.collection('teams').where('ownerId', '==', uid).get(),
            normalizedEmail
                ? db.collection('teams').where('adminEmails', 'array-contains', normalizedEmail).get()
                : Promise.resolve({ docs: [] }),
            normalizedEmail
                ? safeLegacyOwnershipQuery(db.collection('teams').where('ownerEmailLower', '==', normalizedEmail))
                : Promise.resolve({ docs: [] }),
            ...ownerEmailCandidates.map((ownerEmail) => (
                safeLegacyOwnershipQuery(db.collection('teams').where('ownerEmail', '==', ownerEmail))
            ))
        ]);
        for (const doc of ownedSnap.docs) addTeam(doc.id, doc.data(), 'owner');
        for (const doc of adminSnap.docs) addTeam(doc.id, doc.data(), 'admin');
        const addLegacyOwnedTeam = (doc) => {
            const team = doc.data() || {};
            const ownerEmails = [...new Set([team.ownerEmailLower, team.ownerEmail].map(normalizeEmail).filter(Boolean))];
            if (!String(team.ownerId || '').trim() && ownerEmails.length === 1 && ownerEmails[0] === normalizedEmail) {
                addTeam(doc.id, team, 'owner');
            }
        };
        for (const doc of ownerEmailLowerSnap.docs) addLegacyOwnedTeam(doc);
        for (const snap of ownerEmailSnaps) {
            for (const doc of snap.docs) addLegacyOwnedTeam(doc);
        }
    }

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
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) {
        end.setUTCHours(23, 59, 59, 999);
    }
    if (end < start) throw new DomainError('invalid_argument', 'endDate must be after startDate.');
    return { start, end };
}

function gameDeepLink(teamId, gameId, { replay = false } = {}) {
    const params = new URLSearchParams({ teamId, gameId });
    if (replay) params.set('replay', 'true');
    return `${APP_BASE_URL}/live-game.html?${params.toString()}`;
}

function calendarEventDeepLink(teamId, eventId) {
    return `${APP_BASE_URL}/app/#/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(eventId)}`;
}

function calendarOccurrenceId(sourceId, startsAt) {
    const suffix = `__${startsAt.toISOString()}`;
    return sourceId.endsWith(suffix) ? sourceId : `${sourceId}${suffix}`;
}

function parseCalendarOccurrenceId(sourceId) {
    const normalizedId = cleanString(sourceId).trim();
    if (!normalizedId) return { id: '', startsAt: null };
    const occurrenceMatch = normalizedId.match(/^(.*)__(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/);
    return {
        id: normalizedId,
        startsAt: occurrenceMatch ? toDate(occurrenceMatch[2]) : null
    };
}

function normalizeCalendarEventType(value) {
    return cleanString(value).trim().toLowerCase() === 'practice' ? 'practice' : 'game';
}

function normalizeCalendarDiscriminator(value) {
    const normalized = cleanString(value).trim().replace(/\s+/g, ' ').toLowerCase();
    return GENERIC_CALENDAR_DISCRIMINATORS.has(normalized) ? '' : normalized;
}

function hasMatchingCalendarDiscriminator(projected, tracked, type) {
    const projectedLocation = normalizeCalendarDiscriminator(projected?.location);
    const trackedLocation = normalizeCalendarDiscriminator(tracked?.location);
    if (projectedLocation && projectedLocation === trackedLocation) return true;

    const field = type === 'practice' ? 'title' : 'opponent';
    const projectedValue = normalizeCalendarDiscriminator(projected?.[field]);
    const trackedValue = normalizeCalendarDiscriminator(tracked?.[field]);
    return Boolean(projectedValue && projectedValue === trackedValue);
}

function isProjectedCalendarEventTracked(projected, trackedEvents) {
    const eventId = cleanString(projected?.id).trim();
    const startsAt = toDate(projected?.startsAt);
    if (!eventId || !startsAt) return false;
    const occurrenceId = calendarOccurrenceId(eventId, startsAt);
    const occurrenceTime = startsAt.getTime();
    const type = normalizeCalendarEventType(projected?.type);

    return trackedEvents.some((tracked) => {
        if (tracked.id === eventId || tracked.id === occurrenceId) return true;
        if (normalizeCalendarEventType(tracked.type) !== type) return false;
        const parsed = parseCalendarOccurrenceId(tracked.id);
        const trackedOccurrenceTime = parsed.startsAt?.getTime() ?? tracked.date?.getTime();
        return trackedOccurrenceTime === occurrenceTime
            && hasMatchingCalendarDiscriminator(projected, tracked, type);
    });
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

async function loadTrackedCalendarEvents(db, teamId) {
    const snap = await db.collection(`teams/${teamId}/games`)
        .orderBy('__name__')
        .select('calendarEventUid', 'date', 'type', 'location', 'opponent', 'title')
        .limit(MAX_TRACKED_CALENDAR_EVENTS_PER_TEAM + 1)
        .get();
    if (snap.docs.length > MAX_TRACKED_CALENDAR_EVENTS_PER_TEAM) {
        throw new DomainError('unavailable', 'Calendar tracking scan exceeded its safe limit.');
    }
    return snap.docs
        .map((doc) => {
            const data = doc.data() || {};
            const id = cleanString(data.calendarEventUid).trim();
            if (!id) return null;
            return {
                id,
                type: normalizeCalendarEventType(data.type),
                date: toDate(data.date),
                location: cleanString(data.location) || null,
                opponent: cleanString(data.opponent) || null,
                title: cleanString(data.title) || null
            };
        })
        .filter(Boolean);
}

export async function getFamilySchedule(db, context, args = {}, now = new Date(), { loadCalendarProjection } = {}) {
    const { start, end } = parseScheduleRange(args, now);
    const events = [];

    for (const entry of context.teams.values()) {
        const teamEvents = [];
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
                gameSummaryAvailable: true,
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

            teamEvents.push(event);
        }

        if (typeof loadCalendarProjection === 'function') {
            let projectedEvents;
            try {
                projectedEvents = await loadCalendarProjection({
                    teamId: entry.teamId,
                    startDate: start,
                    endDate: end
                });
            } catch (error) {
                if (error instanceof DomainError && error.code === 'not_found') {
                    projectedEvents = [];
                } else {
                    throw error instanceof DomainError
                        ? error
                        : new DomainError('unavailable', 'Imported calendar events are temporarily unavailable.');
                }
            }

            const normalizedProjectedEvents = Array.isArray(projectedEvents) ? projectedEvents : [];
            const trackedCalendarEvents = normalizedProjectedEvents.length
                ? await loadTrackedCalendarEvents(db, entry.teamId)
                : [];
            const projectedEventKeys = new Set();
            for (const projected of normalizedProjectedEvents) {
                const eventId = cleanString(projected?.id).trim();
                const date = toDate(projected?.startsAt);
                if (
                    !eventId || !date || date < start || date > end
                    || isProjectedCalendarEventTracked(projected, trackedCalendarEvents)
                ) continue;
                const eventKey = `${eventId}::${date.toISOString()}`;
                if (projectedEventKeys.has(eventKey)) continue;
                projectedEventKeys.add(eventKey);
                const type = projected?.type === 'practice' ? 'practice' : 'game';
                teamEvents.push({
                    teamId: entry.teamId,
                    teamName: cleanString(entry.team.name),
                    gameId: null,
                    calendarEventId: eventId,
                    gameSummaryAvailable: false,
                    type,
                    date: date.toISOString(),
                    title: type === 'practice' ? cleanString(projected?.title) || null : null,
                    opponent: type === 'game' ? cleanString(projected?.opponent) || null : null,
                    location: cleanString(projected?.location) || null,
                    status: cleanString(projected?.status) || 'scheduled',
                    rsvpSummary: null,
                    myRsvp: null,
                    linkedPlayerIds: [...entry.linkedPlayerIds],
                    sourceType: 'calendar',
                    sourceLabel: 'Imported calendar',
                    isImported: true,
                    deepLink: calendarEventDeepLink(entry.teamId, eventId)
                });
            }
        }

        teamEvents.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        events.push(...teamEvents.slice(0, MAX_EVENTS_PER_TEAM));
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

function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isExactDiamondResourceId(value) {
    return typeof value === 'string'
        && value === value.trim()
        && DIAMOND_SAFE_RESOURCE_ID.test(value)
        && !/[\u0000-\u001f\u007f]/.test(value);
}

function diamondProjectionIdentity(game) {
    if (cleanString(game?.trackingEngine).trim().toLowerCase() !== 'diamond-v2') return null;
    const status = cleanString(game?.diamondProjectionStatus).trim().toLowerCase();
    const instanceId = cleanString(game?.diamondScorebookInstanceId).trim();
    const sourceRevision = Number(game?.diamondProjectionRevision);
    const checkpointHash = cleanString(game?.diamondProjectionCheckpointHash).trim();
    const statConfigSnapshotHash = cleanString(game?.diamondStatConfigSnapshotHash).trim();
    const projectionHash = cleanString(game?.diamondProjectionHash).trim();
    if (
        !['current', 'complete'].includes(status)
        || game?.diamondProjectionComplete !== true
        || !DIAMOND_UUID_V4_PATTERN.test(instanceId)
        || !Number.isSafeInteger(sourceRevision)
        || sourceRevision < 0
        || !DIAMOND_SHA256_PATTERN.test(checkpointHash)
        || !DIAMOND_SHA256_PATTERN.test(statConfigSnapshotHash)
        || !DIAMOND_SHA256_PATTERN.test(projectionHash)
    ) return null;
    return { instanceId, sourceRevision, checkpointHash, statConfigSnapshotHash, projectionHash };
}

function isStrictSortedStringArray(value, { maximum = MAX_DIAMOND_STAT_KEYS, allowed = null } = {}) {
    if (!Array.isArray(value) || value.length > maximum) return false;
    return value.every((entry, index) => (
        typeof entry === 'string'
        && entry.length > 0
        && entry.length <= 128
        && entry === entry.trim()
        && (!allowed || allowed.has(entry))
        && (index === 0 || value[index - 1].localeCompare(entry) < 0)
    ));
}

function isStrictDiamondStatValue(key, value) {
    if (key === 'innings_pitched') {
        return typeof value === 'string'
            && value.length <= 32
            && DIAMOND_INNINGS_PITCHED_VALUE.test(value);
    }
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isStrictDiamondStatMap(value, publicStatIds, expectedCoverage) {
    return isPlainRecord(value)
        && Object.keys(value).length <= MAX_DIAMOND_STAT_KEYS
        && Object.entries(value).every(([key, statValue]) => (
            DIAMOND_SAFE_STAT_KEY.test(key)
            && publicStatIds.has(key)
            && expectedCoverage.has(key)
            && isStrictDiamondStatValue(key, statValue)
        ));
}

function projectDiamondPublicPlayer(entry, identity, teamId, gameId) {
    const data = entry?.data;
    if (
        !isExactDiamondResourceId(entry?.id)
        || !isPlainRecord(data)
        || Object.keys(data).some((key) => !DIAMOND_PUBLIC_PLAYER_DOCUMENT_KEYS.has(key))
        || data.schemaVersion !== 1
        || data.trackingEngine !== 'diamond-v2'
        || data.projectionSchemaVersion !== 1
        || data.complete !== true
        || data.playerId !== entry.id
        || data.teamId !== teamId
        || data.diamondGameId !== gameId
        || data.instanceId !== identity.instanceId
        || data.diamondScorebookInstanceId !== identity.instanceId
        || data.projectionGeneration !== identity.instanceId
        || data.sourceRevision !== identity.sourceRevision
        || data.checkpointHash !== identity.checkpointHash
        || data.statConfigSnapshotHash !== identity.statConfigSnapshotHash
        || data.projectionHash !== identity.projectionHash
        || typeof data.playerName !== 'string'
        || data.playerName.length > 160
        || typeof data.playerNumber !== 'string'
        || data.playerNumber.length > 32
        || typeof data.participated !== 'boolean'
        || data.participationSource !== 'diamond-v2'
        || !['appeared', 'did-not-appear'].includes(data.participationStatus)
        || (data.participated && data.participationStatus !== 'appeared')
        || (!data.participated && data.participationStatus !== 'did-not-appear')
        || (data.participated && Object.hasOwn(data, 'didNotPlay'))
        || (!data.participated && data.didNotPlay !== true)
        || !isStrictSortedStringArray(data.publicStatIds, { allowed: DIAMOND_PLAYER_STAT_IDS })
    ) return null;

    const publicStatIds = new Set(data.publicStatIds);
    if (
        !isPlainRecord(data.statCoverage)
        || Object.keys(data.statCoverage).length !== publicStatIds.size
        || Object.entries(data.statCoverage).some(([key, status]) => !publicStatIds.has(key) || !DIAMOND_COVERAGE_STATUSES.has(status))
    ) return null;
    const completeStatIds = new Set(data.publicStatIds.filter((key) => data.statCoverage[key] === 'complete'));
    const partialStatIds = new Set(data.publicStatIds.filter((key) => data.statCoverage[key] === 'partial'));
    if (
        !isStrictDiamondStatMap(data.stats, publicStatIds, completeStatIds)
        || !isStrictDiamondStatMap(data.derivedStats, publicStatIds, completeStatIds)
        || !isStrictDiamondStatMap(data.observedStats, publicStatIds, partialStatIds)
        || !isStrictDiamondStatMap(data.observedDerivedStats, publicStatIds, partialStatIds)
        || [...Object.keys(data.stats), ...Object.keys(data.derivedStats)].some((key) => (
            Object.hasOwn(data.observedStats, key) || Object.hasOwn(data.observedDerivedStats, key)
        ))
        || !isPlainRecord(data.coverage)
        || Object.keys(data.coverage).length > 32
        || Object.entries(data.coverage).some(([family, status]) => (
            !DIAMOND_SAFE_STAT_KEY.test(family) || !DIAMOND_COVERAGE_STATUSES.has(status)
        ))
        || !isPlainRecord(data.statSources)
        || Object.keys(data.statSources).some((key) => !publicStatIds.has(key))
        || !Object.values(data.statSources).every((ids) => isStrictSortedStringArray(ids, { maximum: 5000 }))
        || !isStrictSortedStringArray(data.sourcePlayIds, { maximum: 5000 })
        || !isStrictSortedStringArray(data.unavailableDerivedStats, { allowed: DIAMOND_DERIVED_PLAYER_STAT_IDS })
        || !isStrictSortedStringArray(data.missingStatFamilies, { maximum: 32 })
    ) return null;
    const expectedSourcePlayIds = [...new Set(Object.values(data.statSources).flat())].sort();
    if (
        expectedSourcePlayIds.length !== data.sourcePlayIds.length
        || expectedSourcePlayIds.some((sourcePlayId, index) => sourcePlayId !== data.sourcePlayIds[index])
    ) return null;

    const completeStats = { ...data.stats, ...data.derivedStats };
    const completeStatKeys = Object.keys(completeStats).sort();
    return {
        playerId: entry.id,
        playerName: data.playerName || null,
        playerNumber: data.playerNumber || null,
        participated: data.participated,
        stats: completeStats,
        completeStatKeys,
        omittedOrIncompleteStatKeys: data.publicStatIds.filter((key) => !completeStatKeys.includes(key))
    };
}

async function loadCompleteDiamondPublicPlayerStats(db, teamId, gameId, game) {
    const identity = diamondProjectionIdentity(game);
    if (!identity || !isExactDiamondResourceId(teamId) || !isExactDiamondResourceId(gameId)) {
        throw new DomainError('unavailable', 'Complete public Diamond player stats are temporarily unavailable.');
    }
    const collectionPath = `teams/${teamId}/games/${gameId}/diamondStatGenerations/${identity.instanceId}/publicPlayerStats`;
    for (let attempt = 0; attempt < MAX_DIAMOND_LOAD_ATTEMPTS; attempt += 1) {
        try {
            const snapshot = await db.collection(collectionPath)
                .limit(MAX_DIAMOND_PUBLIC_PLAYER_STATS + 1)
                .get();
            if (!snapshot || !Array.isArray(snapshot.docs) || snapshot.docs.length > MAX_DIAMOND_PUBLIC_PLAYER_STATS) {
                throw new Error('Diamond public player stats exceeded the bounded result.');
            }
            const seenPlayerIds = new Set();
            const playerStats = snapshot.docs.map((doc) => {
                const entry = { id: doc.id, data: doc.data() || {} };
                if (seenPlayerIds.has(entry.id)) throw new Error('Diamond public player stats contained a duplicate player.');
                seenPlayerIds.add(entry.id);
                const projected = projectDiamondPublicPlayer(entry, identity, teamId, gameId);
                if (!projected) throw new Error('Diamond public player stats did not match the current generation.');
                return projected;
            });
            return {
                playerStats,
                evidence: {
                    complete: true,
                    visibility: 'public',
                    source: 'diamond-public-projection',
                    absenceConfirmed: playerStats.length === 0,
                    truncated: false,
                    generationBound: true,
                    instructions: 'Omitted or incomplete Diamond counters are unknown, never zero. Do not infer absence unless absenceConfirmed is true.'
                }
            };
        } catch {
            // Retry one complete, exact-generation read. Never retain a partial
            // or denied response as an empty authoritative result.
        }
    }
    throw new DomainError('unavailable', 'Complete public Diamond player stats are temporarily unavailable.');
}

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

    let playerStats;
    let playerStatsEvidence = null;
    if (cleanString(data.trackingEngine).trim().toLowerCase() === 'diamond-v2') {
        const projected = await loadCompleteDiamondPublicPlayerStats(db, teamId, gameId, data);
        playerStats = projected.playerStats;
        playerStatsEvidence = projected.evidence;
    } else {
        let statsSnap = { docs: [] };
        try {
            statsSnap = await db.collection(`teams/${teamId}/games/${gameId}/aggregatedStats`)
                .limit(MAX_PLAYER_STATS)
                .get();
        } catch (error) {
            if (!(error instanceof DomainError && error.code === 'permission_denied')) throw error;
        }
        playerStats = statsSnap.docs.map((doc) => {
            const player = doc.data() || {};
            const stats = player.stats && typeof player.stats === 'object' && !Array.isArray(player.stats)
                ? player.stats
                : {};
            return {
                playerId: doc.id,
                playerName: cleanString(player.playerName) || null,
                playerNumber: player.playerNumber ?? null,
                stats: Object.fromEntries(Object.entries(stats)
                    .filter(([, value]) => typeof value === 'number'))
            };
        });
    }

    return {
        game,
        playerStats,
        ...(playerStatsEvidence ? { playerStatsEvidence } : {}),
        deepLink: gameDeepLink(teamId, gameId, { replay: true })
    };
}
