const DEFAULT_TEAM_ID = 'ikouRgrXG66iHqgiDOxr';

export function getSmokeContext() {
    return {
        suite: process.env.SMOKE_SUITE || 'preview',
        teamId: process.env.SMOKE_TEAM_ID || DEFAULT_TEAM_ID,
        gameId: process.env.SMOKE_GAME_ID || '',
        playerId: process.env.SMOKE_PLAYER_ID || '',
        authEmail: process.env.SMOKE_AUTH_EMAIL || '',
        authPassword: process.env.SMOKE_AUTH_PASSWORD || ''
    };
}

function buildOptionalCorePages({ teamId, gameId, playerId }) {
    const pages = [
        {
            name: 'team details',
            path: `/team.html#teamId=${teamId}`,
            titlePatterns: [/Team Details - ALL PLAYS/i],
            readySelectors: ['#schedule-list', 'main'],
            forbiddenTexts: [/Team not found/i]
        }
    ];

    if (gameId) {
        pages.push(
            {
                name: 'game report',
                path: `/game.html#teamId=${teamId}&gameId=${gameId}`,
                titlePatterns: [/Match Report - ALL PLAYS/i],
                readySelectors: ['#game-header', '#stats-body', '#game-log'],
                forbiddenTexts: [/Error loading game\./i, /Game not found/i, /Please sign in to view this game\./i]
            },
            {
                name: 'live game',
                path: `/live-game.html?teamId=${teamId}&gameId=${gameId}`,
                titlePatterns: [/Live Game - ALL PLAYS/i],
                readySelectors: ['#scoreboard', '#plays-feed', '#stats-panel'],
                forbiddenTexts: [/Game not found\./i]
            }
        );
    }

    if (gameId && playerId) {
        pages.push({
            name: 'player details',
            path: `/player.html#teamId=${teamId}&gameId=${gameId}&playerId=${playerId}`,
            titlePatterns: [/Player Details - ALL PLAYS/i],
            readySelectors: ['#player-header', '#season-overview', '#game-stats'],
            forbiddenTexts: [/Player not found/i, /Error loading player details/i]
        });
    }

    return pages;
}

export function getPublicSmokePages() {
    return [
        {
            name: 'homepage',
            path: '/',
            titlePatterns: [/ALL PLAYS/i],
            readySelectors: ['body']
        },
        {
            name: 'login',
            path: '/login.html',
            titlePatterns: [/Login - ALL PLAYS/i],
            readySelectors: ['#login-form']
        },
        {
            name: 'teams',
            path: '/teams.html',
            titlePatterns: [/Teams - ALL PLAYS/i],
            readySelectors: ['#teams-list']
        }
    ];
}

export function getPreviewBootPages(context) {
    const { teamId } = context;

    return [
        {
            name: 'dashboard boot',
            path: '/dashboard.html',
            titlePatterns: [/My Teams/i, /Login - ALL PLAYS/i],
            readySelectors: ['main', '#login-form']
        },
        {
            name: 'parent dashboard boot',
            path: '/parent-dashboard.html',
            titlePatterns: [/Parent Dashboard/i, /Login - ALL PLAYS/i],
            readySelectors: ['main', '#login-form']
        },
        {
            name: 'edit schedule boot',
            path: `/edit-schedule.html#teamId=${teamId}`,
            titlePatterns: [/Edit Schedule - ALL PLAYS/i, /Login - ALL PLAYS/i],
            readySelectors: ['#add-game-form', '#login-form']
        },
        {
            name: 'team chat boot',
            path: `/team-chat.html#teamId=${teamId}`,
            titlePatterns: [/Team Chat - ALL PLAYS/i, /Login - ALL PLAYS/i],
            readySelectors: ['#messages-container', '#login-form']
        },
        ...buildOptionalCorePages(context)
    ];
}

export function getAuthenticatedSmokePages(context) {
    const { teamId } = context;

    return [
        {
            name: 'dashboard',
            path: '/dashboard.html',
            titlePatterns: [/My Teams/i],
            readySelectors: ['main h1']
        },
        {
            name: 'parent dashboard',
            path: '/parent-dashboard.html',
            titlePatterns: [/Parent Dashboard/i],
            readySelectors: ['#my-players-list', '#schedule-list']
        },
        {
            name: 'edit schedule',
            path: `/edit-schedule.html#teamId=${teamId}`,
            titlePatterns: [/Edit Schedule - ALL PLAYS/i],
            readySelectors: ['#add-game-form', '#schedule-list']
        },
        {
            name: 'team chat',
            path: `/team-chat.html#teamId=${teamId}`,
            titlePatterns: [/Team Chat - ALL PLAYS/i],
            readySelectors: ['#messages-container', '#message-input']
        },
        ...buildOptionalCorePages(context)
    ];
}
