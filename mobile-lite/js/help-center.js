const HELP_ROLE_ALIASES = {
    parent: 'parent',
    parents: 'parent',
    coach: 'coach',
    coaches: 'coach',
    admin: 'administrator',
    admins: 'administrator',
    administrator: 'administrator',
    administrators: 'administrator',
    member: 'member',
    user: 'member'
};

const HELP_CATEGORIES = [
    { id: 'account', label: 'Account Access' },
    { id: 'team-setup', label: 'Team Setup' },
    { id: 'planning', label: 'Planning' },
    { id: 'game-day', label: 'Game Day' },
    { id: 'watch-chat', label: 'Watch + Chat' },
    { id: 'troubleshooting', label: 'Troubleshooting' }
];

const HELP_GUIDES = [
    {
        id: 'login',
        title: 'Log in to ALL PLAYS',
        category: 'account',
        roles: ['member', 'parent', 'coach', 'administrator'],
        tags: ['login', 'sign in', 'access', 'account'],
        summary: 'Sign in with your existing account and verify that your role-specific navigation appears.',
        prerequisites: [
            'You have an existing ALL PLAYS account.',
            'You know your email and password.'
        ],
        steps: [
            'Open `login.html`.',
            'Enter your email address in the email field.',
            'Enter your password in the password field.',
            'Select `Sign In`.',
            'Confirm you are redirected to the correct landing page (dashboard, parent dashboard, or profile path).',
            'Verify the header shows signed-in actions like `Profile` and `Log out`.'
        ],
        commonErrors: [
            'Invalid credentials: verify email spelling and password casing.',
            'No redirect or blank screen: refresh once and try again.',
            'Expected team access missing: check that your account has the correct role assignment.'
        ],
        edgeCases: [
            'If your account has both parent and coach access, verify both dashboards are reachable from navigation.',
            'If browser autofill inserts an old password, clear and retype credentials manually.'
        ],
        relatedGuideIds: ['forgot-password', 'sign-up-activation'],
        quickLinks: [
            { label: 'Open Login', url: 'login.html' },
            { label: 'Open Dashboard', url: 'dashboard.html' },
            { label: 'Open Parent Dashboard', url: 'parent-dashboard.html' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'forgot-password',
        title: 'Reset a forgotten password',
        category: 'account',
        roles: ['member', 'parent', 'coach', 'administrator'],
        tags: ['forgot password', 'reset password', 'login'],
        summary: 'Send a password reset email and complete the reset flow safely.',
        prerequisites: [
            'You can access the email inbox tied to your ALL PLAYS account.'
        ],
        steps: [
            'Open `login.html`.',
            'Select the `Forgot password` option.',
            'Enter the account email address and submit.',
            'Open the reset email and select the reset link.',
            'Enter a new password that you can remember and confirm it.',
            'Return to `login.html` and sign in with the new password.'
        ],
        commonErrors: [
            'Reset email not found: check spam/junk and wait 1-2 minutes before retry.',
            'Expired reset link: request a new reset email and use the newest message.',
            'Weak password rejected: use a longer password with mixed character types.'
        ],
        edgeCases: [
            'If multiple reset emails exist, only the most recent link should be used.',
            'If using a corporate mailbox with link rewriting, copy the full link into a new tab.'
        ],
        relatedGuideIds: ['login', 'sign-up-activation'],
        quickLinks: [
            { label: 'Open Login', url: 'login.html' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'sign-up-activation',
        title: 'Sign up with activation code',
        category: 'account',
        roles: ['member', 'parent', 'coach', 'administrator'],
        tags: ['sign up', 'activation code', 'new account', 'invite'],
        summary: 'Create a new account from invite/activation flow and confirm access level.',
        prerequisites: [
            'You received an activation code or invite link from your team.',
            'You have access to the invite email.'
        ],
        steps: [
            'Open `login.html#signup` or your invite link.',
            'Enter your email, password, and requested profile details.',
            'Enter the activation code exactly as provided.',
            'Submit the sign-up form and wait for account creation confirmation.',
            'Complete email verification if prompted.',
            'Sign in and confirm expected team access and role-specific navigation.'
        ],
        commonErrors: [
            'Activation code invalid: confirm you copied the code exactly and it has not expired.',
            'Email already in use: use login/reset-password instead of creating another account.',
            'Missing team access after sign-up: contact team admin to reissue invite or role mapping.'
        ],
        edgeCases: [
            'If invite was accepted on another device, refresh and sign in instead of re-registering.',
            'If role appears incorrect, verify the invite source team and code.'
        ],
        relatedGuideIds: ['login', 'forgot-password'],
        quickLinks: [
            { label: 'Open Sign Up', url: 'login.html#signup' },
            { label: 'Accept Invite', url: 'accept-invite.html' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'create-team',
        title: 'Create a team',
        category: 'team-setup',
        roles: ['coach', 'administrator'],
        tags: ['create team', 'new team', 'setup', 'coach'],
        summary: 'Create a new team record, verify sport defaults, and publish it for use.',
        prerequisites: [
            'You are signed in as coach or administrator.',
            'You know team name, sport, season basics, and optional location details.'
        ],
        steps: [
            'Open `dashboard.html`.',
            'Select the create/new team action.',
            'Enter team details: name, sport, season, and optional description.',
            'Save the team and verify it appears in your team list.',
            'Open the team detail page (`team.html`) to confirm branding and access.',
            'Open edit pages (`edit-team.html`) to complete additional settings if needed.'
        ],
        commonErrors: [
            'Create action not visible: account is missing coach/admin rights.',
            'Team save fails: review required fields and retry once.',
            'Team appears but cannot edit: verify ownership/access mapping.'
        ],
        edgeCases: [
            'If you manage many teams, use distinct naming conventions (season + level).',
            'If sport changes after creation, re-check tracker and stat config defaults.'
        ],
        relatedGuideIds: ['manage-roster', 'plan-game', 'plan-practice'],
        quickLinks: [
            { label: 'Open My Teams', url: 'dashboard.html' },
            { label: 'Browse Teams', url: 'teams.html' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'manage-roster',
        title: 'Manage team roster',
        category: 'team-setup',
        roles: ['coach', 'administrator'],
        tags: ['roster', 'players', 'jersey', 'import'],
        summary: 'Add, edit, and maintain players for a team roster with consistent data.',
        prerequisites: [
            'You have a team selected.',
            'You have player names and optional jersey/position details.'
        ],
        steps: [
            'Open `edit-roster.html#teamId={teamId}` from team navigation.',
            'Add players one by one or using available bulk workflows.',
            'Set jersey numbers, names, and optional metadata.',
            'Save roster changes and verify rows render correctly.',
            'Open `team.html#teamId={teamId}` and confirm roster display.',
            'Before game day, verify no duplicate jersey numbers unless intentional.'
        ],
        commonErrors: [
            'Cannot save player row: required fields missing or invalid.',
            'Duplicate players: search roster first before adding new entries.',
            'Roster not visible in tracker: refresh and confirm teamId context.'
        ],
        edgeCases: [
            'For temporary call-ups, add notes or remove after event completion.',
            'If importing data externally, normalize casing for names and positions.'
        ],
        relatedGuideIds: ['create-team', 'plan-game', 'track-game'],
        quickLinks: [
            { label: 'Edit Roster', url: 'edit-roster.html#teamId={teamId}' },
            { label: 'Team Page', url: 'team.html#teamId={teamId}' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'plan-game',
        title: 'Plan a game',
        category: 'planning',
        roles: ['coach', 'administrator'],
        tags: ['schedule', 'game', 'opponent', 'arrival', 'assignments'],
        summary: 'Create and configure game events with opponent, location, assignments, and record behavior.',
        prerequisites: [
            'You have team schedule edit access.',
            'You know game date/time, opponent, and location details.'
        ],
        steps: [
            'Open `edit-schedule.html#teamId={teamId}`.',
            'Select `Add Game` and enter date/time, opponent, and location.',
            'Set home/away and competition type.',
            'Configure arrival time, notes, and assignments as needed.',
            'Save the game and verify it appears in schedule list and calendar filters.',
            'Use track button options to verify standard/live route availability before game day.'
        ],
        commonErrors: [
            'Game not visible after save: check active filter (Upcoming/Past/All).',
            'Wrong record counting behavior: verify `count toward season record` toggle.',
            'Opponent mismatch: use linked opponent search to avoid duplicate team names.'
        ],
        edgeCases: [
            'Recurring series edits can affect one event vs. entire series; choose carefully.',
            'Calendar imports can conflict with manually created events at same timestamp.'
        ],
        relatedGuideIds: ['plan-practice', 'track-game', 'watch-game'],
        quickLinks: [
            { label: 'Edit Schedule', url: 'edit-schedule.html#teamId={teamId}' },
            { label: 'Team Schedule View', url: 'team.html#teamId={teamId}' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'plan-practice',
        title: 'Plan a practice',
        category: 'planning',
        roles: ['coach', 'administrator'],
        tags: ['practice', 'schedule', 'drills', 'recurring'],
        summary: 'Schedule practices, manage recurring sessions, and connect planning details.',
        prerequisites: [
            'You have schedule edit rights for the team.',
            'You know practice cadence and location details.'
        ],
        steps: [
            'Open `edit-schedule.html#teamId={teamId}`.',
            'Select `Add Practice` and set start/end time, location, and notes.',
            'Configure recurrence when needed and confirm day pattern.',
            'Save and verify each occurrence in schedule views.',
            'Attach or review practice plan context from schedule actions.',
            'If cancellations occur, use per-occurrence or series-level cancellation intentionally.'
        ],
        commonErrors: [
            'Practice appears on wrong date: verify timezone and recurrence day settings.',
            'Edited one occurrence unexpectedly changed all: confirm occurrence scope choice.',
            'No practice reminders: check team chat/notification settings for participants.'
        ],
        edgeCases: [
            'Holiday weeks often need one-off override instead of editing whole series.',
            'Imported calendar practices may be hidden by current filters.'
        ],
        relatedGuideIds: ['plan-game', 'manage-roster'],
        quickLinks: [
            { label: 'Edit Schedule', url: 'edit-schedule.html#teamId={teamId}' },
            { label: 'Drills Library', url: 'drills.html#teamId={teamId}' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'track-game',
        title: 'Track a game (standard and live)',
        category: 'game-day',
        roles: ['member', 'parent', 'coach', 'administrator'],
        tags: ['track', 'tracking', 'racking', 'racking a game', 'live tracker', 'stats', 'undo', 'game log'],
        summary: 'Choose the correct tracker for sport/game context and capture reliable in-game data.',
        prerequisites: [
            'A game is scheduled or selected from schedule.',
            'Roster is complete for the selected team.'
        ],
        steps: [
            'Open `edit-schedule.html#teamId={teamId}` and select the game `Track` action.',
            'Choose the tracker type offered (standard, live, or sport-specific options).',
            'In live tracker, confirm lineup state and period/clock controls before first event.',
            'Record events into game log and use unified game note input for context.',
            'Use undo/remove actions immediately when correcting accidental entries.',
            'End tracking by saving and verify report outputs on `game.html` and team history.'
        ],
        commonErrors: [
            'Wrong tracker opened: return to schedule and choose the intended tracker type.',
            'Stats not updating: verify game clock state and team/opponent selection.',
            'Undo not applying as expected: undo newest event first and verify log order.'
        ],
        edgeCases: [
            'Basketball may route to dedicated live tracker while other sports use track-live.',
            'If offline/intermittent network occurs, refresh carefully to avoid duplicate entries.'
        ],
        relatedGuideIds: ['watch-game', 'team-chat-tagging'],
        quickLinks: [
            { label: 'Track (Standard)', url: 'track.html#teamId={teamId}' },
            { label: 'Track (Live)', url: 'track-live.html#teamId={teamId}' },
            { label: 'Basketball Live Tracker', url: 'live-tracker.html#teamId={teamId}' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'watch-game',
        title: 'Watch a game (live and replay)',
        category: 'watch-chat',
        roles: ['member', 'parent', 'coach', 'administrator'],
        tags: ['watch', 'live stream', 'replay', 'game page', 'viewer'],
        summary: 'Open live viewing experiences and understand when chat/replay modes are available.',
        prerequisites: [
            'Game has stream or live view enabled.',
            'You have access to the team/game.'
        ],
        steps: [
            'Open `team.html#teamId={teamId}` or `game.html#teamId={teamId}&gameId={gameId}`.',
            'Select `Watch Live` or equivalent viewer action when available.',
            'Confirm stream provider embed loads (YouTube/Twitch where configured).',
            'Verify score/state updates during active game.',
            'If replay mode is shown, confirm expected read-only behavior and chat availability.',
            'Use share/copy controls if you need to send the view link to others.'
        ],
        commonErrors: [
            'Watch button missing: stream link not configured or game not eligible.',
            'Embed blocked: verify provider URL format and allowed embedding settings.',
            'Stale viewer data: refresh and re-open from team/game page.'
        ],
        edgeCases: [
            'Replay mode can disable interactive chat depending on live status rules.',
            'Private/age-restricted streams may not embed for all viewers.'
        ],
        relatedGuideIds: ['track-game', 'team-chat-basics'],
        quickLinks: [
            { label: 'Team Page', url: 'team.html#teamId={teamId}' },
            { label: 'Game Viewer', url: 'live-game.html#teamId={teamId}&gameId={gameId}' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'team-chat-basics',
        title: 'Use team chat',
        category: 'watch-chat',
        roles: ['parent', 'coach', 'administrator'],
        tags: ['chat', 'messages', 'team communication', 'notifications'],
        summary: 'Send team messages, read updates, and keep communication organized during season workflows.',
        prerequisites: [
            'You have access to the team chat room.'
        ],
        steps: [
            'Open `team-chat.html#teamId={teamId}` from team navigation.',
            'Read recent messages before posting to avoid duplicate updates.',
            'Enter concise message text and send.',
            'Use chat for schedule changes, reminders, and game-day updates.',
            'Confirm message appears with expected timestamp and sender context.',
            'Adjust notification settings if message volume is too high or too low.'
        ],
        commonErrors: [
            'Cannot send message: verify team membership and authentication session.',
            'Messages not updating: refresh page or navigate out/in once.',
            'Notification mismatch: check device/browser notification permissions.'
        ],
        edgeCases: [
            'High-volume game-day chats should keep one-thread-per-topic discipline.',
            'Pinned/important announcements should be repeated near event start.'
        ],
        relatedGuideIds: ['team-chat-tagging', 'watch-game'],
        quickLinks: [
            { label: 'Open Team Chat', url: 'team-chat.html#teamId={teamId}' },
            { label: 'Open Team', url: 'team.html#teamId={teamId}' }
        ],
        lastUpdated: '2026-03-03'
    },
    {
        id: 'team-chat-tagging',
        title: 'Tag people in chat',
        category: 'watch-chat',
        roles: ['parent', 'coach', 'administrator'],
        tags: ['tag', 'mention', 'chat', 'notifications', '@'],
        summary: 'Mention the right people in chat without over-notifying the entire team.',
        prerequisites: [
            'Team chat is enabled and you can send messages.',
            'You know who should be notified for the message context.'
        ],
        steps: [
            'Open `team-chat.html#teamId={teamId}`.',
            'Start typing your message and include a mention format supported by chat UI.',
            'Tag only the people or groups that need action.',
            'Send the message and confirm mention formatting renders correctly.',
            'Watch for replies/acknowledgments from tagged recipients.',
            'If message is urgent, follow up with a clear action + deadline in same thread.'
        ],
        commonErrors: [
            'Tag does not link/notify: check exact mention formatting expected by current chat implementation.',
            'Too many people notified: narrow tags to responsible individuals.',
            'No response from tagged users: verify they have notification permissions enabled.'
        ],
        edgeCases: [
            'In mixed parent/coach chats, avoid tagging minors directly where policy requires parent-only comms.',
            'For repeated announcements, use one canonical message and reference it instead of retagging everyone.'
        ],
        relatedGuideIds: ['team-chat-basics', 'plan-game'],
        quickLinks: [
            { label: 'Open Team Chat', url: 'team-chat.html#teamId={teamId}' }
        ],
        lastUpdated: '2026-03-03'
    }
];

const REQUIRED_GUIDE_IDS = [
    'login',
    'forgot-password',
    'sign-up-activation',
    'create-team',
    'manage-roster',
    'plan-game',
    'plan-practice',
    'track-game',
    'watch-game',
    'team-chat-basics',
    'team-chat-tagging'
];

function dedupeById(items) {
    const seen = new Set();
    return items.filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

export function normalizeHelpRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    return HELP_ROLE_ALIASES[normalized] || 'member';
}

export function getHelpGuidesForRole(role) {
    const normalizedRole = normalizeHelpRole(role);
    return HELP_GUIDES.filter((guide) => (guide.roles || []).includes(normalizedRole));
}

export function getHelpCategoriesForRole(role) {
    const guides = getHelpGuidesForRole(role);
    const allowedCategoryIds = new Set(guides.map((guide) => guide.category));
    return HELP_CATEGORIES.filter((category) => allowedCategoryIds.has(category.id));
}

export function getGuideById(role, guideId) {
    const normalizedId = String(guideId || '').trim().toLowerCase();
    if (!normalizedId) return null;
    return getHelpGuidesForRole(role).find((guide) => guide.id === normalizedId) || null;
}

export function searchHelpGuides(guides, query, category = 'all') {
    const trimmed = String(query || '').trim().toLowerCase();
    const selectedCategory = String(category || 'all').trim().toLowerCase();

    let scoped = Array.isArray(guides) ? [...guides] : [];
    if (selectedCategory && selectedCategory !== 'all') {
        scoped = scoped.filter((guide) => guide.category === selectedCategory);
    }

    if (!trimmed) return scoped;

    return scoped.filter((guide) => {
        const values = [
            guide.title,
            guide.summary,
            ...(guide.tags || []),
            ...(guide.prerequisites || []),
            ...(guide.steps || []),
            ...(guide.commonErrors || []),
            ...(guide.edgeCases || [])
        ];
        return values.some((value) => String(value).toLowerCase().includes(trimmed));
    });
}

export function getTopHelpGuides(role, limit = 6) {
    const guides = getHelpGuidesForRole(role);
    return guides.slice(0, Math.max(1, limit));
}

export function resolveGuideLinks(guide, context = {}) {
    const teamId = context.teamId ? String(context.teamId) : '';
    const gameId = context.gameId ? String(context.gameId) : '';

    return (guide?.quickLinks || []).map((link) => {
        let resolved = String(link.url || '');
        resolved = resolved.replaceAll('{teamId}', encodeURIComponent(teamId));
        resolved = resolved.replaceAll('{gameId}', encodeURIComponent(gameId));
        resolved = resolved.replace(/#teamId=$/, '');
        resolved = resolved.replace(/\?teamId=$/, '');
        resolved = resolved.replace(/&gameId=$/, '');
        resolved = resolved.replace(/\?gameId=$/, '');
        return {
            ...link,
            url: resolved
        };
    });
}

export function getRelatedGuides(role, guide) {
    const byRole = getHelpGuidesForRole(role);
    const byId = new Map(byRole.map((item) => [item.id, item]));
    const relatedIds = guide?.relatedGuideIds || [];
    const related = relatedIds.map((id) => byId.get(id)).filter(Boolean);
    return dedupeById(related);
}

export function getRequiredGuideIds() {
    return [...REQUIRED_GUIDE_IDS];
}

// Backward compatibility for existing consumers/tests before help page upgrade.
export function getHelpSectionsForRole(role) {
    return getHelpGuidesForRole(role);
}

export function searchHelpSections(sections, query) {
    return searchHelpGuides(sections, query);
}
