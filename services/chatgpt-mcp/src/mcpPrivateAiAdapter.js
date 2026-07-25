// User-credentialed adapter from the shared private AI read tools to the MCP
// service's Firestore REST domain layer.

import {
    DomainError,
    getFamilySchedule,
    listMyTeams
} from './core.js';

const FAR_PAST = '2000-01-01T00:00:00.000Z';
const FAR_FUTURE = '2100-12-31T23:59:59.999Z';

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function roleList(context) {
    const roles = new Set();
    if (context.isGlobalAdmin) roles.add('admin');
    for (const entry of context.teams.values()) {
        for (const role of entry.roles) roles.add(role === 'owner' || role === 'admin' ? 'coach' : role);
    }
    return [...roles].sort();
}

function requireContextTeam(context, teamId) {
    const normalized = cleanString(teamId);
    if (!normalized || (!context.teams.has(normalized) && !context.isGlobalAdmin)) {
        throw new DomainError('permission_denied', 'You do not have access to this team.');
    }
}

async function safeQuery(query) {
    try {
        return await query.get();
    } catch (error) {
        if (error instanceof DomainError && error.code === 'permission_denied') return { docs: [] };
        throw error;
    }
}

async function safeDoc(db, path) {
    try {
        return await db.doc(path).get();
    } catch (error) {
        if (error instanceof DomainError && error.code === 'permission_denied') {
            return { exists: false, id: path.split('/').pop(), data: () => undefined };
        }
        throw error;
    }
}

function uniqueWarnings(...groups) {
    return [...new Set(groups.flat().filter((warning) => typeof warning === 'string' && warning))];
}

function dedupeScheduleEvents(events) {
    const seen = new Set();
    return events.filter((event) => {
        const key = [
            event.teamId,
            event.id || event.gameId,
            event.childId,
            new Date(event.date).toISOString()
        ].join('::');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function projectScheduleModel(familySchedule, teams) {
    const children = teams.flatMap((team) => {
        const linkedPlayers = Array.isArray(team.linkedPlayers) ? team.linkedPlayers : [];
        if (linkedPlayers.length) {
            return linkedPlayers.map((player) => ({
                playerId: player.playerId,
                childId: player.playerId,
                name: player.name,
                childName: player.name,
                teamId: team.teamId,
                teamName: team.name
            }));
        }
        return [{
            playerId: `staff-team-${team.teamId}`,
            childId: `staff-team-${team.teamId}`,
            name: team.name || 'Team',
            childName: team.name || 'Team',
            teamId: team.teamId,
            teamName: team.name
        }];
    });
    const childrenByTeam = new Map();
    for (const child of children) {
        if (!childrenByTeam.has(child.teamId)) childrenByTeam.set(child.teamId, []);
        childrenByTeam.get(child.teamId).push(child);
    }

    const events = familySchedule.events.flatMap((event) => {
        const teamChildren = childrenByTeam.get(event.teamId) || [{
            playerId: `staff-team-${event.teamId}`,
            childId: `staff-team-${event.teamId}`,
            name: event.teamName || 'Team',
            childName: event.teamName || 'Team',
            teamId: event.teamId,
            teamName: event.teamName
        }];
        return teamChildren.map((child) => {
            const rsvpPlayerIds = Array.isArray(event.myRsvp?.playerIds) ? event.myRsvp.playerIds : [];
            const appliesToEveryLinkedPlayer = event.myRsvp && rsvpPlayerIds.length === 0;
            const myRsvp = event.myRsvp && (appliesToEveryLinkedPlayer || rsvpPlayerIds.includes(child.playerId))
                ? event.myRsvp.response
                : 'not_responded';
            return {
                ...event,
                id: event.gameId,
                childId: child.childId,
                childName: child.childName,
                myRsvp
            };
        });
    });

    return {
        children,
        events,
        warnings: familySchedule.warnings || []
    };
}

function dayStart(value) {
    const date = new Date(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayBefore(value) {
    return new Date(dayStart(value).getTime() - 1);
}

function whitelistRideRequest(doc) {
    const data = doc.data() || {};
    return {
        id: doc.id,
        parentUserId: cleanString(data.parentUserId) || null,
        childId: cleanString(data.childId) || null,
        childName: cleanString(data.childName) || null,
        status: cleanString(data.status) || 'pending'
    };
}

function whitelistCompletion(doc) {
    const data = doc.data() || {};
    return {
        id: doc.id,
        childId: cleanString(data.childId) || null,
        childName: cleanString(data.childName) || null,
        status: cleanString(data.status) || null,
        completedAt: data.completedAt || null,
        updatedAt: data.updatedAt || null
    };
}

export function createMcpSharedUser(identity, context) {
    return {
        uid: context.uid,
        email: context.email || identity.email || '',
        displayName: '',
        roles: roleList(context),
        emailVerified: true
    };
}

export function createMcpPrivateAiReadAdapter(db, context, { now = () => new Date() } = {}) {
    let cachedTeams = null;
    let lastSchedule = null;

    const loadTeams = async () => {
        if (!cachedTeams) cachedTeams = (await listMyTeams(db, context)).teams;
        return cachedTeams;
    };

    const loadScheduleRange = async (args, options = {}) => {
        const teams = await loadTeams();
        const family = await getFamilySchedule(db, context, args, now(), options);
        return projectScheduleModel(family, teams);
    };

    const adapter = {
        now,

        async loadProfile() {
            const teams = await loadTeams();
            return {
                profile: {
                    email: context.email,
                    parentTeamIds: teams
                        .filter((team) => team.roles.includes('parent'))
                        .map((team) => team.teamId),
                    coachOf: teams
                        .filter((team) => team.roles.some((role) => role === 'owner' || role === 'admin'))
                        .map((team) => team.teamId)
                },
                teams
            };
        },

        async loadSchedule(_user, { includePastGames, args = {} }) {
            const hasExplicitRange = Boolean(args.startDate || args.endDate);
            if (hasExplicitRange) {
                lastSchedule = await loadScheduleRange({
                    startDate: args.startDate,
                    endDate: args.endDate
                });
                return lastSchedule;
            }

            if (includePastGames) {
                const current = now();
                const [past, future] = await Promise.all([
                    loadScheduleRange({
                        startDate: FAR_PAST,
                        endDate: dayBefore(current).toISOString()
                    }, {
                        orderDirection: 'desc',
                        maxEventsPerTeam: 50
                    }),
                    loadScheduleRange({
                        startDate: dayStart(current).toISOString(),
                        endDate: FAR_FUTURE
                    }, {
                        orderDirection: 'asc',
                        maxEventsPerTeam: 50
                    })
                ]);
                lastSchedule = {
                    children: past.children,
                    events: dedupeScheduleEvents([...past.events, ...future.events])
                        .sort((left, right) => new Date(left.date) - new Date(right.date)),
                    warnings: uniqueWarnings(past.warnings, future.warnings)
                };
                return lastSchedule;
            }

            lastSchedule = await loadScheduleRange({
                startDate: dayStart(now()).toISOString(),
                endDate: FAR_FUTURE
            }, {
                orderDirection: 'asc',
                maxEventsPerTeam: 100
            });
            return lastSchedule;
        },

        async loadScheduleEventDetail(_user, event) {
            return {
                events: (lastSchedule?.events || []).filter((candidate) => (
                    candidate.teamId === event.teamId && candidate.id === event.id
                ))
            };
        },

        async loadAssignments(_user, event) {
            requireContextTeam(context, event.teamId);
            const assignments = Array.isArray(event.assignments)
                ? event.assignments.map((assignment) => ({ ...assignment }))
                : [];
            if (!event.isDbGame || event.isCancelled || !assignments.length) return assignments;

            const claims = await safeQuery(
                db.collection(`teams/${event.teamId}/games/${event.id}/assignmentClaims`).limit(50)
            );
            const claimByRole = new Map(claims.docs.map((doc) => {
                const data = doc.data() || {};
                const role = cleanString(data.role || doc.id).toLowerCase();
                return [role, data];
            }));
            return assignments.map((assignment) => {
                const claim = claimByRole.get(cleanString(assignment.role).toLowerCase());
                if (!claim) return assignment;
                return {
                    ...assignment,
                    claimed: true,
                    claimedBy: cleanString(claim.claimedByUserId || claim.userId) || null,
                    claimedByName: cleanString(claim.claimedByName || claim.userName || claim.displayName) || null
                };
            });
        },

        async loadRideOffers(_user, event) {
            requireContextTeam(context, event.teamId);
            if (!event.isDbGame || event.isCancelled) return [];
            const offers = await safeQuery(
                db.collection(`teams/${event.teamId}/games/${event.id}/rideOffers`).limit(20)
            );
            return Promise.all(offers.docs.map(async (doc) => {
                const data = doc.data() || {};
                const requests = await safeQuery(
                    db.collection(`teams/${event.teamId}/games/${event.id}/rideOffers/${doc.id}/requests`).limit(20)
                );
                return {
                    id: doc.id,
                    sourceGameId: cleanString(data.sourceGameId) || event.id,
                    driverUserId: cleanString(data.driverUserId) || null,
                    driverName: cleanString(data.driverName) || null,
                    seatCapacity: Number(data.seatCapacity || 0),
                    seatCountConfirmed: Number(data.seatCountConfirmed || 0),
                    direction: cleanString(data.direction) || 'to',
                    status: cleanString(data.status) || 'open',
                    note: cleanString(data.note) || null,
                    requests: requests.docs.map(whitelistRideRequest)
                };
            }));
        },

        async loadPracticePacket(_user, event, schedule) {
            requireContextTeam(context, event.teamId);
            if (event.type !== 'practice') return null;
            let session = null;
            if (cleanString(event.practiceSessionId)) {
                const snap = await safeDoc(db, `teams/${event.teamId}/practiceSessions/${event.practiceSessionId}`);
                if (snap.exists) session = { id: snap.id, ...(snap.data() || {}) };
            }
            if (!session) {
                const sessions = await safeQuery(
                    db.collection(`teams/${event.teamId}/practiceSessions`)
                        .where('eventId', '==', event.id)
                        .limit(3)
                );
                const doc = sessions.docs[0];
                if (doc) session = { id: doc.id, ...(doc.data() || {}) };
            }

            const homePacket = session?.homePacketContent;
            if (!homePacket || typeof homePacket !== 'object') return null;
            const sessionId = cleanString(session?.id || event.practiceSessionId || event.id);
            const completions = sessionId
                ? await safeQuery(
                    db.collection(`teams/${event.teamId}/practiceSessions/${sessionId}/packetCompletions`).limit(50)
                )
                : { docs: [] };
            const children = (schedule?.events || [])
                .filter((candidate) => candidate.teamId === event.teamId && candidate.id === event.id)
                .map((candidate) => ({ id: candidate.childId, name: candidate.childName }))
                .filter((child, index, rows) => child.id && rows.findIndex((row) => row.id === child.id) === index);
            return {
                sessionId,
                teamId: event.teamId,
                eventId: event.id,
                title: event.title || 'Practice',
                date: event.date,
                location: event.location,
                homePacket,
                children,
                completions: completions.docs.map(whitelistCompletion)
            };
        }
    };

    return adapter;
}
