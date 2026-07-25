// Browser- and server-safe private AI read-tool definitions.
//
// The React assistant and remote MCP service both construct their schedule
// tools from this module. Environment-specific adapters load authorized data;
// matching, filtering, field projection, and tool metadata live here once.

const MAX_SCHEDULE_RESULTS = 25;

export class SharedPrivateAiToolError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SharedPrivateAiToolError';
        this.code = code;
    }
}

function compactText(value) {
    return String(value || '').trim();
}

function normalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value && typeof value.toDate === 'function') {
        const converted = value.toDate();
        return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
    }
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateBoundary(value, { end = false } = {}) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(compactText(value))) {
        const [year, month, day] = compactText(value).split('-').map(Number);
        return end
            ? new Date(year, month - 1, day, 23, 59, 59, 999)
            : new Date(year, month - 1, day);
    }
    const parsed = normalizeDate(value);
    if (!parsed) return null;
    return parsed;
}

function scheduleTitle(event) {
    if (event?.type === 'practice') return compactText(event.title) || 'Practice';
    return `vs. ${compactText(event?.opponent) || 'TBD'}`;
}

function formatDateLabel(date) {
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    }).format(date);
}

function formatTimeLabel(date) {
    return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit'
    }).format(date);
}

function isOpenAssignment(assignment) {
    if (!assignment || assignment.claimable !== true || !compactText(assignment.role)) return false;
    if (compactText(assignment.value)) return false;
    if (assignment.claimed === true || compactText(assignment.claimedBy) || compactText(assignment.claimedByUserId)) {
        return false;
    }
    return !compactText(assignment.claim?.claimedByUserId);
}

export function pickPrivateAiFields(source, fields) {
    return fields.reduce((result, field) => {
        const value = source?.[field];
        if (value !== undefined && value !== null && value !== '') result[field] = value;
        return result;
    }, {});
}

export function summarizeSharedProfile(user, model = {}) {
    const profile = model?.profile && typeof model.profile === 'object' ? model.profile : model;
    return {
        account: {
            uid: compactText(user?.uid),
            email: compactText(user?.email),
            displayName: compactText(user?.displayName),
            roles: Array.isArray(user?.roles) ? user.roles : [],
            emailVerified: user?.emailVerified === true
        },
        profile: pickPrivateAiFields(profile || {}, [
            'fullName',
            'displayName',
            'email',
            'phone',
            'photoUrl',
            'emailVerified',
            'notificationPreferences',
            'parentTeamIds',
            'parentPlayerKeys',
            'coachTeamIds',
            'coachOf'
        ]),
        teams: Array.isArray(model?.teams) ? model.teams.slice(0, 25) : []
    };
}

export function summarizeSharedScheduleEvent(event) {
    const date = normalizeDate(event?.date);
    if (!date) return null;
    const assignments = Array.isArray(event?.assignments) ? event.assignments : [];
    const summary = {
        eventId: compactText(event?.id || event?.gameId),
        teamId: compactText(event?.teamId),
        teamName: compactText(event?.teamName),
        type: event?.type === 'practice' ? 'practice' : 'game',
        title: scheduleTitle(event),
        childId: compactText(event?.childId) || null,
        childName: compactText(event?.childName) || null,
        date: date.toISOString(),
        dateLabel: formatDateLabel(date),
        timeLabel: formatTimeLabel(date),
        location: compactText(event?.location) || 'TBD',
        status: compactText(event?.status) || null,
        isCancelled: event?.isCancelled === true || compactText(event?.status).toLowerCase() === 'cancelled',
        myRsvp: event?.myRsvp || 'not_responded',
        rsvpSummary: event?.rsvpSummary || null,
        rideshareSummary: event?.rideshareSummary || null,
        openAssignments: assignments.filter(isOpenAssignment).map((assignment) => compactText(assignment.role)).filter(Boolean),
        practiceHomePacketSummary: event?.practiceHomePacketSummary || null,
        score: typeof event?.homeScore === 'number' || typeof event?.awayScore === 'number'
            ? { home: event.homeScore ?? null, away: event.awayScore ?? null }
            : null,
        source: compactText(event?.source || event?.sourceType) || (event?.isDbGame === false ? 'calendar' : 'db'),
        isImported: event?.isImported === true || event?.isDbGame === false,
        deepLink: compactText(event?.deepLink) || null
    };
    return summary;
}

export function summarizeSharedSchedule(schedule, args = {}, { now = new Date() } = {}) {
    const requestedLimit = Number(args.limit || 12);
    const itemLimit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_SCHEDULE_RESULTS)
        : 12;
    const range = compactText(args.range || (args.startDate || args.endDate ? 'all' : 'upcoming')).toLowerCase();
    const eventType = compactText(args.type).toLowerCase();
    const teamId = compactText(args.teamId);
    const teamName = compactText(args.teamName).toLowerCase();
    const playerName = compactText(args.playerName).toLowerCase();
    const startDate = dateBoundary(args.startDate);
    const endDate = dateBoundary(args.endDate, { end: true });

    let events = (Array.isArray(schedule?.events) ? schedule.events : [])
        .map((event) => ({ event, date: normalizeDate(event?.date) }))
        .filter((entry) => entry.date);
    if (range === 'upcoming') {
        events = events.filter((entry) => entry.date.getTime() >= startOfDay(now).getTime());
    } else if (range === 'recent') {
        events = events.filter((entry) => entry.date.getTime() < startOfDay(now).getTime()).reverse();
    }
    if (startDate) events = events.filter((entry) => entry.date >= startDate);
    if (endDate) events = events.filter((entry) => entry.date <= endDate);
    if (eventType === 'game' || eventType === 'practice') {
        events = events.filter((entry) => entry.event.type === eventType);
    }
    if (teamId) events = events.filter((entry) => compactText(entry.event.teamId) === teamId);
    if (teamName) {
        events = events.filter((entry) => compactText(entry.event.teamName).toLowerCase().includes(teamName));
    }
    if (playerName) {
        events = events.filter((entry) => compactText(entry.event.childName).toLowerCase().includes(playerName));
    }

    return {
        children: (Array.isArray(schedule?.children) ? schedule.children : [])
            .slice(0, 20)
            .map((child) => pickPrivateAiFields(child, [
                'playerId',
                'childId',
                'name',
                'childName',
                'teamId',
                'teamName'
            ])),
        events: events
            .slice(0, itemLimit)
            .map((entry) => summarizeSharedScheduleEvent(entry.event))
            .filter(Boolean),
        warnings: Array.isArray(schedule?.warnings) ? schedule.warnings.slice(0, 10) : []
    };
}

export function summarizeSharedLastGame(schedule, args = {}, { now = new Date() } = {}) {
    const teamId = compactText(args.teamId);
    const childId = compactText(args.childId || args.playerId);
    const teamName = compactText(args.teamName).toLowerCase();
    const playerName = compactText(args.playerName || args.childName).toLowerCase();
    const games = (Array.isArray(schedule?.events) ? schedule.events : [])
        .map((event) => ({ event, date: normalizeDate(event?.date) }))
        .filter((entry) => entry.date && entry.event.type === 'game')
        .filter((entry) => !teamId || compactText(entry.event.teamId) === teamId)
        .filter((entry) => !childId || compactText(entry.event.childId) === childId)
        .filter((entry) => !teamName || compactText(entry.event.teamName).toLowerCase().includes(teamName))
        .filter((entry) => !playerName || compactText(entry.event.childName).toLowerCase().includes(playerName));
    const pastGames = games
        .filter((entry) => entry.date.getTime() < now.getTime())
        .sort((left, right) => right.date - left.date);
    const upcomingGames = games
        .filter((entry) => entry.date.getTime() >= now.getTime())
        .sort((left, right) => left.date - right.date);

    return {
        lastGame: pastGames[0] ? summarizeSharedScheduleEvent(pastGames[0].event) : null,
        recentGames: pastGames.slice(0, 5).map((entry) => summarizeSharedScheduleEvent(entry.event)),
        upcomingGames: upcomingGames.slice(0, 3).map((entry) => summarizeSharedScheduleEvent(entry.event)),
        message: pastGames.length ? '' : 'No past games were found for the requested player or team.'
    };
}

export function findSharedScheduleEvent(schedule, args = {}) {
    const eventId = compactText(args.eventId || args.gameId || args.id);
    const teamId = compactText(args.teamId);
    const childId = compactText(args.childId || args.playerId);
    const eventType = compactText(args.type || args.eventType).toLowerCase();
    const teamName = compactText(args.teamName).toLowerCase();
    const playerName = compactText(args.playerName || args.childName).toLowerCase();
    const title = compactText(args.title || args.opponent).toLowerCase();
    return (Array.isArray(schedule?.events) ? schedule.events : []).find((event) => {
        if (eventId && compactText(event.id || event.gameId) !== eventId) return false;
        if (teamId && compactText(event.teamId) !== teamId) return false;
        if (childId && compactText(event.childId) !== childId) return false;
        if ((eventType === 'game' || eventType === 'practice') && event.type !== eventType) return false;
        if (teamName && !compactText(event.teamName).toLowerCase().includes(teamName)) return false;
        if (playerName && !compactText(event.childName).toLowerCase().includes(playerName)) return false;
        if (title && !`${scheduleTitle(event)} ${compactText(event.opponent)}`.toLowerCase().includes(title)) return false;
        return true;
    }) || null;
}

export function summarizeSharedAssignment(assignment) {
    return pickPrivateAiFields(assignment || {}, [
        'role',
        'value',
        'claimable',
        'claimed',
        'claimedBy',
        'claimedByName',
        'claimantName',
        'note'
    ]);
}

export function summarizeSharedRideOffer(offer) {
    return {
        id: compactText(offer?.id),
        sourceGameId: compactText(offer?.sourceGameId) || null,
        driverUserId: compactText(offer?.driverUserId) || null,
        driverName: compactText(offer?.driverName) || null,
        seatCapacity: Number(offer?.seatCapacity || 0),
        seatCountConfirmed: Number(offer?.seatCountConfirmed || 0),
        seatsLeft: Math.max(0, Number(offer?.seatCapacity || 0) - Number(offer?.seatCountConfirmed || 0)),
        direction: compactText(offer?.direction),
        status: compactText(offer?.status),
        note: compactText(offer?.note) || null,
        requests: (Array.isArray(offer?.requests) ? offer.requests : []).slice(0, 12).map((request) => (
            pickPrivateAiFields(request, ['id', 'parentUserId', 'childId', 'childName', 'status'])
        ))
    };
}

function summarizeRideOffers(offers) {
    const normalized = Array.isArray(offers) ? offers : [];
    return {
        offers: normalized.length,
        openOffers: normalized.filter((offer) => compactText(offer.status || 'open') === 'open').length,
        seatsLeft: normalized.reduce((sum, offer) => (
            sum + Math.max(0, Number(offer.seatCapacity || 0) - Number(offer.seatCountConfirmed || 0))
        ), 0),
        requests: normalized.reduce((sum, offer) => sum + (Array.isArray(offer.requests) ? offer.requests.length : 0), 0)
    };
}

export function summarizeSharedPracticePacket(packet) {
    return {
        sessionId: compactText(packet?.sessionId),
        teamId: compactText(packet?.teamId),
        eventId: compactText(packet?.eventId),
        title: compactText(packet?.title),
        date: normalizeDate(packet?.date)?.toISOString() || null,
        location: compactText(packet?.location),
        homePacket: packet?.homePacket || null,
        children: (Array.isArray(packet?.children) ? packet.children : [])
            .map((child) => pickPrivateAiFields(child, ['id', 'name'])),
        completions: (Array.isArray(packet?.completions) ? packet.completions : [])
            .map((completion) => pickPrivateAiFields(completion, [
                'id',
                'childId',
                'childName',
                'status',
                'completedAt',
                'updatedAt'
            ]))
    };
}

export const SHARED_PRIVATE_AI_READ_TOOL_CATALOG = Object.freeze([
    {
        name: 'get_profile',
        mode: 'read',
        description: 'Account profile, roles, notification preferences, linked teams, and linked players.',
        parameters: {}
    },
    {
        name: 'list_schedule',
        mode: 'read',
        description: 'Schedule events with RSVP, rideshare, assignments, score, location, imported calendars, and player context. Args: startDate, endDate, range, limit, type, teamId, teamName, playerName.',
        aliases: ['get_schedule'],
        parameters: {
            startDate: 'string',
            endDate: 'string',
            range: 'string',
            limit: 'number',
            type: 'string',
            teamId: 'string',
            teamName: 'string',
            playerName: 'string'
        }
    },
    {
        name: 'get_last_game',
        mode: 'read',
        description: 'Most recent past game for the account, including RSVP status. Args: teamId, teamName, playerId, childId, playerName, childName.',
        aliases: ['last_game', 'get_previous_game'],
        parameters: {
            teamId: 'string',
            teamName: 'string',
            playerId: 'string',
            childId: 'string',
            playerName: 'string',
            childName: 'string'
        }
    },
    {
        name: 'get_schedule_event',
        mode: 'read',
        description: 'One schedule event with detail context. Args: eventId, teamId, playerName, teamName.',
        parameters: {
            eventId: 'string',
            teamId: 'string',
            playerName: 'string',
            teamName: 'string'
        }
    },
    {
        name: 'list_rsvps',
        mode: 'read',
        description: 'RSVP status and summaries for schedule events. Args: startDate, endDate, range, limit, teamId, teamName, playerName.',
        parameters: {
            startDate: 'string',
            endDate: 'string',
            range: 'string',
            limit: 'number',
            teamId: 'string',
            teamName: 'string',
            playerName: 'string'
        }
    },
    {
        name: 'list_ride_offers',
        mode: 'read',
        description: 'Rideshare offers and requests for one schedule event. Args: eventId, teamId, playerName, teamName.',
        parameters: { eventId: 'string', teamId: 'string', playerName: 'string', teamName: 'string' }
    },
    {
        name: 'list_assignments',
        mode: 'read',
        description: 'Volunteer and task assignments for one schedule event. Args: eventId, teamId, playerName, teamName.',
        aliases: ['get_assignments', 'list_tasks_for_event'],
        parameters: { eventId: 'string', teamId: 'string', playerName: 'string', teamName: 'string' }
    },
    {
        name: 'get_practice_packet',
        mode: 'read',
        description: 'Parent practice packet details and completion status for a practice. Args: eventId, teamId, teamName.',
        parameters: { eventId: 'string', teamId: 'string', teamName: 'string' }
    }
]);

export function getSharedPrivateAiReadToolDefinition(name) {
    const normalized = compactText(name);
    return SHARED_PRIVATE_AI_READ_TOOL_CATALOG.find((definition) => (
        definition.name === normalized || (definition.aliases || []).includes(normalized)
    )) || null;
}

/**
 * Create the shared app/MCP read tools around an authorized data adapter.
 */
export function createSharedPrivateAiReadToolDefinitions(adapter) {
    const now = () => typeof adapter.now === 'function' ? adapter.now() : new Date();
    const loadSchedule = (user, args, includePastGames) => adapter.loadSchedule(user, {
        includePastGames,
        args
    });
    const resolveEvent = async (user, args, { practiceOnly = false } = {}) => {
        const lookupArgs = practiceOnly
            ? { ...args, childId: '', childName: '', playerId: '', playerName: '', type: 'practice' }
            : args;
        const schedule = await loadSchedule(user, lookupArgs, true);
        return {
            schedule,
            event: findSharedScheduleEvent(schedule, lookupArgs)
        };
    };
    const catalog = new Map(SHARED_PRIVATE_AI_READ_TOOL_CATALOG.map((definition) => [definition.name, definition]));

    return [
        {
            ...catalog.get('get_profile'),
            resolve: async (user) => summarizeSharedProfile(user, await adapter.loadProfile(user))
        },
        {
            ...catalog.get('list_schedule'),
            resolve: async (user, args = {}) => {
                const requestedStart = dateBoundary(args.startDate);
                const includePastGames = compactText(args.range).toLowerCase() === 'all'
                    || Boolean(requestedStart && requestedStart < startOfDay(now()));
                return summarizeSharedSchedule(
                    await loadSchedule(user, args, includePastGames),
                    args,
                    { now: now() }
                );
            }
        },
        {
            ...catalog.get('get_last_game'),
            resolve: async (user, args = {}) => summarizeSharedLastGame(
                await loadSchedule(user, args, true),
                args,
                { now: now() }
            )
        },
        {
            ...catalog.get('get_schedule_event'),
            resolve: async (user, args = {}) => {
                const { event } = await resolveEvent(user, args);
                if (!event) {
                    throw new SharedPrivateAiToolError(
                        'not_found',
                        'No matching event was found for this account.'
                    );
                }
                const detail = typeof adapter.loadScheduleEventDetail === 'function'
                    ? await adapter.loadScheduleEventDetail(user, event).catch(() => null)
                    : null;
                return {
                    event: summarizeSharedScheduleEvent(event),
                    childEvents: (Array.isArray(detail?.events) ? detail.events : [event])
                        .slice(0, 8)
                        .map(summarizeSharedScheduleEvent)
                        .filter(Boolean)
                };
            }
        },
        {
            ...catalog.get('list_rsvps'),
            resolve: async (user, args = {}) => {
                const includePastGames = compactText(args.range).toLowerCase() === 'all';
                const schedule = summarizeSharedSchedule(
                    await loadSchedule(user, args, includePastGames),
                    args,
                    { now: now() }
                );
                return {
                    events: schedule.events.map((event) => pickPrivateAiFields(event, [
                        'eventId',
                        'teamId',
                        'teamName',
                        'title',
                        'childId',
                        'childName',
                        'date',
                        'dateLabel',
                        'timeLabel',
                        'myRsvp',
                        'rsvpSummary'
                    ])),
                    warnings: schedule.warnings
                };
            }
        },
        {
            ...catalog.get('list_ride_offers'),
            resolve: async (user, args = {}) => {
                const { event } = await resolveEvent(user, args);
                if (!event) {
                    throw new SharedPrivateAiToolError(
                        'not_found',
                        'No matching event was found for this account.'
                    );
                }
                const offers = typeof adapter.loadRideOffers === 'function'
                    ? await adapter.loadRideOffers(user, event)
                    : [];
                return {
                    event: summarizeSharedScheduleEvent(event),
                    summary: summarizeRideOffers(offers),
                    offers: offers.slice(0, 20).map(summarizeSharedRideOffer)
                };
            }
        },
        {
            ...catalog.get('list_assignments'),
            resolve: async (user, args = {}) => {
                const { event } = await resolveEvent(user, args);
                if (!event) {
                    throw new SharedPrivateAiToolError(
                        'not_found',
                        'No matching event was found for this account.'
                    );
                }
                const assignments = typeof adapter.loadAssignments === 'function'
                    ? await adapter.loadAssignments(user, event)
                    : (Array.isArray(event.assignments) ? event.assignments : []);
                return {
                    event: summarizeSharedScheduleEvent(event),
                    assignments: assignments.map(summarizeSharedAssignment)
                };
            }
        },
        {
            ...catalog.get('get_practice_packet'),
            resolve: async (user, args = {}) => {
                const { schedule, event } = await resolveEvent(user, args, { practiceOnly: true });
                if (!event) {
                    throw new SharedPrivateAiToolError(
                        'not_found',
                        'No matching practice was found for this account.'
                    );
                }
                const packet = typeof adapter.loadPracticePacket === 'function'
                    ? await adapter.loadPracticePacket(user, event, schedule)
                    : null;
                if (!packet) {
                    throw new SharedPrivateAiToolError(
                        'not_found',
                        'No practice packet was found for this practice.'
                    );
                }
                return summarizeSharedPracticePacket(packet);
            }
        }
    ];
}
