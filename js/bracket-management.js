function nextPowerOfTwo(value) {
    let n = 1;
    while (n < value) {
        n *= 2;
    }
    return n;
}

function buildSeedOrder(size) {
    let seeds = [1, 2];
    while (seeds.length < size) {
        const nextSize = seeds.length * 2;
        const next = [];
        seeds.forEach((seed) => {
            next.push(seed);
            next.push(nextSize + 1 - seed);
        });
        seeds = next;
    }
    return seeds;
}

function normalizeSeeds(seeds = []) {
    return seeds
        .map((entry, index) => {
            const explicitSeed = Number(entry?.seed);
            const normalizedSeed = Number.isFinite(explicitSeed) && explicitSeed > 0
                ? Math.floor(explicitSeed)
                : index + 1;
            return {
                seed: normalizedSeed,
                teamId: entry?.teamId || null,
                teamName: entry?.teamName || null
            };
        })
        .sort((a, b) => a.seed - b.seed);
}

function copyBracket(bracket) {
    return JSON.parse(JSON.stringify(bracket));
}

function setSlotTeam(slot, teamId, teamName = null) {
    slot.teamId = teamId || null;
    slot.teamName = teamName || null;
}

function applyWinnerToNextGame(bracket, game, winnerTeamId, winnerTeamName = null) {
    const target = game?.next?.winner;
    if (!target?.gameId || !target?.slot) return;

    const nextGame = bracket.games.find((candidate) => candidate.id === target.gameId);
    if (!nextGame) return;

    const targetSlot = target.slot === 'away' ? nextGame.awaySlot : nextGame.homeSlot;
    setSlotTeam(targetSlot, winnerTeamId, winnerTeamName);

    if (nextGame.homeSlot.teamId && nextGame.awaySlot.teamId && nextGame.status !== 'completed') {
        nextGame.status = 'scheduled';
    } else if (nextGame.status !== 'completed') {
        nextGame.status = 'pending';
    }
}

function applyLoserToNextGame(bracket, game, loserTeamId, loserTeamName = null) {
    const target = game?.next?.loser;
    if (!target?.gameId || !target?.slot) return;

    const nextGame = bracket.games.find((candidate) => candidate.id === target.gameId);
    if (!nextGame) return;

    const targetSlot = target.slot === 'away' ? nextGame.awaySlot : nextGame.homeSlot;
    setSlotTeam(targetSlot, loserTeamId, loserTeamName);

    if (nextGame.homeSlot.teamId && nextGame.awaySlot.teamId && nextGame.status !== 'completed') {
        nextGame.status = 'scheduled';
    } else if (nextGame.status !== 'completed') {
        nextGame.status = 'pending';
    }
}

function autoAdvanceByes(bracket) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const game of bracket.games) {
            if (game.status === 'completed') continue;

            const homeTeamId = game.homeSlot?.teamId || null;
            const awayTeamId = game.awaySlot?.teamId || null;
            if (homeTeamId && !awayTeamId) {
                game.status = 'completed';
                game.winnerTeamId = homeTeamId;
                game.loserTeamId = null;
                game.completedBy = 'auto_bye';
                applyWinnerToNextGame(bracket, game, homeTeamId, game.homeSlot.teamName || null);
                changed = true;
            } else if (!homeTeamId && awayTeamId) {
                game.status = 'completed';
                game.winnerTeamId = awayTeamId;
                game.loserTeamId = null;
                game.completedBy = 'auto_bye';
                applyWinnerToNextGame(bracket, game, awayTeamId, game.awaySlot.teamName || null);
                changed = true;
            }
        }
    }
    return bracket;
}

export function createSingleEliminationBracket({ teamId, name, seeds = [], bracketId = null, createdBy = null } = {}) {
    const normalizedSeeds = normalizeSeeds(seeds);
    if (!teamId) {
        throw new Error('teamId is required to create a bracket');
    }
    if (normalizedSeeds.length < 2) {
        throw new Error('at least two seeded slots are required to create a bracket');
    }

    const slotCount = nextPowerOfTwo(normalizedSeeds.length);
    const roundCount = Math.log2(slotCount);
    const seedOrder = buildSeedOrder(slotCount);
    const seedsByNumber = new Map(normalizedSeeds.map((entry) => [entry.seed, entry]));
    const games = [];

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
        const gamesInRound = slotCount / (2 ** (roundIndex + 1));
        for (let gameNumber = 1; gameNumber <= gamesInRound; gameNumber += 1) {
            const gameId = `R${roundIndex + 1}G${gameNumber}`;
            let homeSlot;
            let awaySlot;

            if (roundIndex === 0) {
                const homeSeed = seedOrder[(gameNumber - 1) * 2];
                const awaySeed = seedOrder[(gameNumber - 1) * 2 + 1];
                const homeSeedEntry = seedsByNumber.get(homeSeed) || null;
                const awaySeedEntry = seedsByNumber.get(awaySeed) || null;
                homeSlot = {
                    sourceType: 'seed',
                    sourceRef: `seed:${homeSeed}`,
                    seed: homeSeed,
                    teamId: homeSeedEntry?.teamId || null,
                    teamName: homeSeedEntry?.teamName || null
                };
                awaySlot = {
                    sourceType: 'seed',
                    sourceRef: `seed:${awaySeed}`,
                    seed: awaySeed,
                    teamId: awaySeedEntry?.teamId || null,
                    teamName: awaySeedEntry?.teamName || null
                };
            } else {
                const previousRound = roundIndex;
                const leftSourceGame = `R${previousRound}G${(gameNumber - 1) * 2 + 1}`;
                const rightSourceGame = `R${previousRound}G${(gameNumber - 1) * 2 + 2}`;
                homeSlot = {
                    sourceType: 'winner',
                    sourceRef: leftSourceGame,
                    seed: null,
                    teamId: null,
                    teamName: null
                };
                awaySlot = {
                    sourceType: 'winner',
                    sourceRef: rightSourceGame,
                    seed: null,
                    teamId: null,
                    teamName: null
                };
            }

            const isFinalRound = roundIndex === roundCount - 1;
            const nextGameId = isFinalRound ? null : `R${roundIndex + 2}G${Math.ceil(gameNumber / 2)}`;
            const nextSlot = gameNumber % 2 === 1 ? 'home' : 'away';

            games.push({
                id: gameId,
                roundIndex,
                gameNumber,
                status: homeSlot.teamId && awaySlot.teamId ? 'scheduled' : 'pending',
                homeSlot,
                awaySlot,
                winnerTeamId: null,
                loserTeamId: null,
                scores: null,
                next: {
                    winner: nextGameId ? { gameId: nextGameId, slot: nextSlot } : null,
                    loser: null
                }
            });
        }
    }

    const bracket = {
        id: bracketId || null,
        teamId,
        name: name || 'Tournament Bracket',
        format: 'single_elimination',
        status: 'draft',
        seedOrder,
        seeds: normalizedSeeds,
        roundCount,
        games,
        createdBy: createdBy || null,
        publishedBy: null,
        publishedAt: null,
        internalNotes: null
    };

    return autoAdvanceByes(bracket);
}

export function reportBracketGameResult(bracketInput, { gameId, winnerSlot, scores = null } = {}) {
    if (!gameId) {
        throw new Error('gameId is required to report bracket result');
    }
    if (winnerSlot !== 'home' && winnerSlot !== 'away') {
        throw new Error('winnerSlot must be either home or away');
    }

    const bracket = copyBracket(bracketInput);
    const game = bracket.games.find((candidate) => candidate.id === gameId);
    if (!game) {
        throw new Error(`game ${gameId} not found in bracket`);
    }

    const winnerSource = winnerSlot === 'home' ? game.homeSlot : game.awaySlot;
    const loserSource = winnerSlot === 'home' ? game.awaySlot : game.homeSlot;
    if (!winnerSource?.teamId) {
        throw new Error(`winner slot ${winnerSlot} has no team assigned`);
    }

    game.status = 'completed';
    game.winnerTeamId = winnerSource.teamId;
    game.loserTeamId = loserSource?.teamId || null;
    game.scores = scores && typeof scores === 'object'
        ? {
            home: Number.isFinite(Number(scores.home)) ? Number(scores.home) : null,
            away: Number.isFinite(Number(scores.away)) ? Number(scores.away) : null
        }
        : null;
    game.completedBy = 'result';

    applyWinnerToNextGame(bracket, game, game.winnerTeamId, winnerSource.teamName || null);
    applyLoserToNextGame(bracket, game, game.loserTeamId, loserSource?.teamName || null);

    return autoAdvanceByes(bracket);
}

export function publishBracket(bracketInput, { publishedBy = null, publishedAt = null } = {}) {
    const bracket = copyBracket(bracketInput);
    bracket.status = 'published';
    bracket.publishedBy = publishedBy;
    bracket.publishedAt = publishedAt || new Date().toISOString();
    return bracket;
}

export function buildPublishedBracketView(bracket) {
    return {
        id: bracket.id || null,
        teamId: bracket.teamId,
        name: bracket.name,
        format: bracket.format,
        status: bracket.status,
        publishedAt: bracket.publishedAt || null,
        roundCount: bracket.roundCount,
        games: (Array.isArray(bracket.games) ? bracket.games : []).map((game) => ({
            id: game.id,
            roundIndex: game.roundIndex,
            gameNumber: game.gameNumber,
            status: game.status,
            homeSlot: {
                sourceType: game.homeSlot?.sourceType || null,
                sourceRef: game.homeSlot?.sourceRef || null,
                seed: game.homeSlot?.seed || null,
                teamId: game.homeSlot?.teamId || null,
                teamName: game.homeSlot?.teamName || null
            },
            awaySlot: {
                sourceType: game.awaySlot?.sourceType || null,
                sourceRef: game.awaySlot?.sourceRef || null,
                seed: game.awaySlot?.seed || null,
                teamId: game.awaySlot?.teamId || null,
                teamName: game.awaySlot?.teamName || null
            },
            winnerTeamId: game.winnerTeamId || null,
            loserTeamId: game.loserTeamId || null,
            scores: game.scores || null
        }))
    };
}
