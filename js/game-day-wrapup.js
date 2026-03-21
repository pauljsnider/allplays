export function shouldPromptWrapupOnCompletion({ prevLiveStatus, nextLiveStatus, mode }) {
    return nextLiveStatus === 'completed'
        && prevLiveStatus !== 'completed'
        && mode !== 'wrapup';
}

export function getWrapupFormState({ score, game }) {
    return {
        homeScore: score?.home || 0,
        awayScore: score?.away || 0,
        postGameNotes: game?.postGameNotes || ''
    };
}

export function buildFinishGamePayload({ homeScoreValue, awayScoreValue, postGameNotesValue }) {
    return {
        homeScore: parseInt(homeScoreValue, 10) || 0,
        awayScore: parseInt(awayScoreValue, 10) || 0,
        postGameNotes: (postGameNotesValue || '').trim(),
        status: 'completed',
        liveStatus: 'completed'
    };
}

export function buildMatchReportUrl({ teamId, gameId }) {
    return `game.html#teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`;
}
