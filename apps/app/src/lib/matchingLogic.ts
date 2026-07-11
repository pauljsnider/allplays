import type { ParentHomeModel } from './homeLogic';
import type { SocialFeedItem } from './socialLogic';
import { toSocialDate } from './socialLogic';

export type MatchingPostKind = 'player_seeking_team' | 'team_seeking_players';
export type MatchingPostStatus = 'open' | 'filled' | 'closed';

export type MatchingDetails = {
    kind: MatchingPostKind;
    sport: string;
    ageGroup: string;
    city: string;
    state: string;
    zip: string;
    positions: string;
    level: string;
    timeframe: string;
    openSpots: number | null;
    playerFirstName: string;
    signupUrl: string;
};

export type MatchingPost = {
    id: string;
    kind: MatchingPostKind;
    status: MatchingPostStatus;
    authorId: string;
    authorName: string;
    authorPhotoUrl: string | null;
    teamId: string | null;
    teamName: string | null;
    title: string;
    description: string;
    matching: MatchingDetails;
    createdAt: Date;
    expiresAt: Date | null;
    hidden: boolean;
};

export type MatchingResponse = {
    id: string;
    responderId: string;
    responderName: string;
    responderPhotoUrl: string | null;
    teamId: string | null;
    teamName: string | null;
    message: string;
    createdAt: Date;
};

export type MatchingPostFilters = {
    kind: 'all' | MatchingPostKind;
    sport: string;
    ageGroup: string;
    location: string;
};

export type MatchingPostDraft = {
    kind: MatchingPostKind;
    sport: string;
    ageGroup: string;
    city?: string;
    state?: string;
    zip?: string;
    positions?: string;
    level?: string;
    timeframe?: string;
    openSpots?: number | string | null;
    playerFirstName?: string;
    signupUrl?: string;
    description?: string;
    teamId?: string | null;
    teamName?: string | null;
};

export const MATCHING_DEFAULT_EXPIRY_DAYS = 60;
export const MATCHING_MAX_EXPIRY_DAYS = 90;
export const MATCHING_DESCRIPTION_MAX_LENGTH = 500;
export const MATCHING_RESPONSE_MAX_LENGTH = 600;

export const matchingAgeGroups = ['U6', 'U8', 'U10', 'U12', 'U14', 'U16', 'U19', 'Adult'];
export const matchingLevels = ['Recreational', 'Competitive', 'Elite'];

export const emptyMatchingFilters: MatchingPostFilters = {
    kind: 'all',
    sport: '',
    ageGroup: '',
    location: ''
};

const matchingSignupUrlPattern = /^https:\/\/(www\.)?allplays\.ai\//i;
const emailPattern = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const phonePattern = /(\+?\d{1,2}[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/;

function compact(value: unknown): string {
    return String(value ?? '').trim();
}

export function isMatchingPostKind(value: unknown): value is MatchingPostKind {
    return value === 'player_seeking_team' || value === 'team_seeking_players';
}

export function getMatchingKindLabel(kind: MatchingPostKind): string {
    return kind === 'player_seeking_team' ? 'Player looking for team' : 'Team looking for players';
}

/**
 * Community matching posts must never carry direct contact details (requirement 3.5/5.1).
 * This is the client-side guard; Firestore rules enforce the structural allowlist.
 */
export function containsContactInfo(text: string): boolean {
    const value = compact(text);
    if (!value) return false;
    return emailPattern.test(value) || phonePattern.test(value);
}

export function clampMatchingExpiryDays(days: unknown): number {
    const parsed = Number(days);
    if (!Number.isFinite(parsed) || parsed <= 0) return MATCHING_DEFAULT_EXPIRY_DAYS;
    return Math.min(Math.max(Math.round(parsed), 1), MATCHING_MAX_EXPIRY_DAYS);
}

export function getMatchingExpiryDate(now: Date, days?: unknown): Date {
    return new Date(now.getTime() + clampMatchingExpiryDays(days ?? MATCHING_DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000);
}

function normalizeOpenSpots(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    if (rounded < 1 || rounded > 99) return null;
    return rounded;
}

export function getMatchingLocationLabel(details: Pick<MatchingDetails, 'city' | 'state' | 'zip'>): string {
    if (details.city && details.state) return `${details.city}, ${details.state}`;
    if (details.state) return details.state;
    return details.zip;
}

export function buildMatchingTitle(details: MatchingDetails, teamName?: string | null): string {
    if (details.kind === 'player_seeking_team') {
        return `${details.playerFirstName} (${details.ageGroup} ${details.sport}) is looking for a team`;
    }
    const name = compact(teamName) || 'A team';
    return `${name} (${details.ageGroup} ${details.sport}) is looking for players`;
}

export function buildMatchingSummary(details: MatchingDetails): string {
    const parts = [details.ageGroup, details.sport, getMatchingLocationLabel(details)];
    if (details.level) parts.push(details.level);
    if (details.positions) parts.push(details.positions);
    if (details.kind === 'team_seeking_players' && details.openSpots) {
        parts.push(`${details.openSpots} open spot${details.openSpots === 1 ? '' : 's'}`);
    }
    if (details.timeframe) parts.push(details.timeframe);
    return parts.filter(Boolean).join(' · ');
}

/**
 * Validates and normalizes a composer draft. Throws with a user-facing message
 * when a required field is missing or a privacy guard fails.
 */
export function buildMatchingDetails(draft: MatchingPostDraft): MatchingDetails {
    const kind = draft.kind;
    if (!isMatchingPostKind(kind)) {
        throw new Error('Choose whether this post is for a player or a team.');
    }
    const sport = compact(draft.sport).slice(0, 40);
    if (!sport) throw new Error('Add a sport before posting.');
    const ageGroup = compact(draft.ageGroup).slice(0, 20);
    if (!ageGroup) throw new Error('Add an age group before posting.');

    const city = compact(draft.city).slice(0, 60);
    const state = compact(draft.state).slice(0, 2).toUpperCase();
    const zip = compact(draft.zip).slice(0, 10);
    if (!zip && !(city && state)) {
        throw new Error('Add a location: city and state, or a ZIP code.');
    }

    const playerFirstName = compact(draft.playerFirstName).slice(0, 40);
    const signupUrl = compact(draft.signupUrl);
    if (kind === 'player_seeking_team') {
        if (!playerFirstName) throw new Error("Add the player's first name or a display name.");
        if (signupUrl) throw new Error('Signup links are only for team posts.');
    } else {
        if (!compact(draft.teamId)) throw new Error('Choose the team that is looking for players.');
        if (signupUrl && !matchingSignupUrlPattern.test(signupUrl)) {
            throw new Error('Signup links must be ALL PLAYS links (https://allplays.ai/...).');
        }
    }

    const description = compact(draft.description);
    if (description.length > MATCHING_DESCRIPTION_MAX_LENGTH) {
        throw new Error(`Keep the description under ${MATCHING_DESCRIPTION_MAX_LENGTH} characters.`);
    }
    if (containsContactInfo(description) || containsContactInfo(playerFirstName)) {
        throw new Error('Remove emails and phone numbers — interested users respond in the app.');
    }

    return {
        kind,
        sport,
        ageGroup,
        city,
        state,
        zip,
        positions: compact(draft.positions).slice(0, 120),
        level: compact(draft.level).slice(0, 40),
        timeframe: compact(draft.timeframe).slice(0, 80),
        openSpots: kind === 'team_seeking_players' ? normalizeOpenSpots(draft.openSpots) : null,
        playerFirstName: kind === 'player_seeking_team' ? playerFirstName : '',
        signupUrl: kind === 'team_seeking_players' ? signupUrl : ''
    };
}

export function normalizeMatchingPost(docData: Record<string, any> & { id: string }): MatchingPost | null {
    const kind = docData.type;
    if (!isMatchingPostKind(kind)) return null;
    const matching = docData.matching && typeof docData.matching === 'object' ? docData.matching : {};
    const status = ['open', 'filled', 'closed'].includes(docData.status) ? docData.status : 'closed';
    return {
        id: docData.id,
        kind,
        status,
        authorId: compact(docData.authorId),
        authorName: compact(docData.authorName) || 'ALL PLAYS user',
        authorPhotoUrl: docData.authorPhotoUrl || null,
        teamId: docData.teamId || null,
        teamName: docData.teamName || null,
        title: compact(docData.title) || 'ALL PLAYS opportunity',
        description: compact(docData.caption),
        matching: {
            kind,
            sport: compact(matching.sport),
            ageGroup: compact(matching.ageGroup),
            city: compact(matching.city),
            state: compact(matching.state),
            zip: compact(matching.zip),
            positions: compact(matching.positions),
            level: compact(matching.level),
            timeframe: compact(matching.timeframe),
            openSpots: normalizeOpenSpots(matching.openSpots),
            playerFirstName: compact(matching.playerFirstName),
            signupUrl: compact(matching.signupUrl)
        },
        createdAt: toSocialDate(docData.createdAt),
        expiresAt: docData.expiresAt ? toSocialDate(docData.expiresAt) : null,
        hidden: docData.hidden === true
    };
}

export function isMatchingPostOpen(post: MatchingPost, now = new Date()): boolean {
    if (post.hidden || post.status !== 'open') return false;
    if (post.expiresAt && post.expiresAt.getTime() <= now.getTime()) return false;
    return true;
}

export function sortMatchingPosts(posts: MatchingPost[]): MatchingPost[] {
    return posts.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function filterMatchingPosts(posts: MatchingPost[], filters: MatchingPostFilters, now = new Date()): MatchingPost[] {
    const sport = compact(filters.sport).toLowerCase();
    const ageGroup = compact(filters.ageGroup).toLowerCase();
    const location = compact(filters.location).toLowerCase();
    return sortMatchingPosts(posts.filter((post) => {
        if (!isMatchingPostOpen(post, now)) return false;
        if (filters.kind !== 'all' && post.kind !== filters.kind) return false;
        if (sport && !post.matching.sport.toLowerCase().includes(sport)) return false;
        if (ageGroup && post.matching.ageGroup.toLowerCase() !== ageGroup) return false;
        if (location) {
            const haystack = [post.matching.city, post.matching.state, post.matching.zip, getMatchingLocationLabel(post.matching)]
                .join(' ')
                .toLowerCase();
            if (!haystack.includes(location)) return false;
        }
        return true;
    }));
}

export function matchingPostToFeedItem(post: MatchingPost): SocialFeedItem {
    return {
        id: post.id,
        type: post.kind,
        visibility: 'community',
        authorId: post.authorId,
        authorName: post.authorName,
        authorPhotoUrl: post.authorPhotoUrl,
        teamId: post.teamId,
        teamName: post.teamName,
        playerIds: [],
        playerNames: post.matching.playerFirstName ? [post.matching.playerFirstName] : [],
        sourceType: 'matching',
        sourceId: post.id,
        title: post.title,
        detail: buildMatchingSummary(post.matching),
        caption: post.description || null,
        media: [],
        route: '/opportunities',
        href: null,
        createdAt: post.createdAt,
        reactionCounts: {},
        commentCount: 0,
        autoGenerated: false
    };
}

/**
 * Picks community posts worth surfacing on the home feed: not the user's own,
 * matching a sport or state from their linked teams first, newest first (req 2.1).
 */
export function selectRelevantMatchingPosts(
    posts: MatchingPost[],
    home: ParentHomeModel,
    currentUserId: string,
    max = 5,
    now = new Date()
): MatchingPost[] {
    const open = sortMatchingPosts(posts.filter((post) => isMatchingPostOpen(post, now) && post.authorId !== currentUserId));
    const sports = new Set((home.teams || []).map((team) => compact(team.sport).toLowerCase()).filter(Boolean));
    const states = new Set((home.teams || []).map((team) => compact(team.state).toUpperCase()).filter(Boolean));
    const relevant = open.filter((post) =>
        sports.has(post.matching.sport.toLowerCase()) || (post.matching.state && states.has(post.matching.state))
    );
    const picked = relevant.slice(0, max);
    if (picked.length < max) {
        const pickedIds = new Set(picked.map((post) => post.id));
        for (const post of open) {
            if (picked.length >= max) break;
            if (!pickedIds.has(post.id)) picked.push(post);
        }
    }
    return picked;
}
