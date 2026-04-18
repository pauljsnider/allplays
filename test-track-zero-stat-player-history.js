const results = [];

function test(name, fn) {
    try {
        fn();
        results.push({ name, pass: true });
    } catch (error) {
        results.push({ name, pass: false, error: error.message });
    }
}

function assertEquals(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
}

function assertDeepEquals(actual, expected, label) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
        throw new Error(`${label}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
    }
}

function buildNormalizedPlayerStats(playerStats = {}, columns = []) {
    const playerStatsByLowerKey = {};
    const normalizedStats = {};

    Object.entries(playerStats).forEach(([statKey, value]) => {
        playerStatsByLowerKey[String(statKey).toLowerCase()] = Number(value) || 0;
    });

    columns.forEach((col) => {
        const key = String(col || '').toLowerCase();
        normalizedStats[key] = Object.prototype.hasOwnProperty.call(playerStatsByLowerKey, key)
            ? playerStatsByLowerKey[key]
            : 0;
    });

    Object.entries(playerStats).forEach(([statKey, value]) => {
        const normalizedKey = String(statKey).toLowerCase();
        if (normalizedStats[statKey] === undefined && normalizedStats[normalizedKey] === undefined) {
            normalizedStats[statKey] = Number(value) || 0;
        }
    });

    return normalizedStats;
}

function buildAggregatedStatsWrites(players, columns, playerStatsById) {
    return players.map((player) => {
        const playerStats = playerStatsById[player.id] || {};

        return {
            playerId: player.id,
            data: {
                playerName: player.name,
                playerNumber: player.number,
                stats: buildNormalizedPlayerStats(playerStats, columns)
            }
        };
    });
}

test('writes one aggregated stats doc per rostered player', () => {
    const writes = buildAggregatedStatsWrites(
        [
            { id: 'player-a', name: 'Player A', number: '12' },
            { id: 'player-b', name: 'Player B', number: '34' }
        ],
        ['PTS', 'REB', 'AST'],
        {
            'player-a': { pts: 10, reb: 4, ast: 2 }
        }
    );

    assertEquals(writes.length, 2, 'Expected one write per rostered player');
    assertEquals(writes[1].playerId, 'player-b', 'Second write should belong to scoreless player');
});

test('zero-stat players get zeroed configured stats', () => {
    const writes = buildAggregatedStatsWrites(
        [{ id: 'player-b', name: 'Player B', number: '34' }],
        ['PTS', 'REB', 'AST'],
        {}
    );

    assertDeepEquals(
        writes[0].data.stats,
        { pts: 0, reb: 0, ast: 0 },
        'Scoreless player should still get a zeroed stats object'
    );
});

test('uppercase source stat keys survive lowercase configured lookups', () => {
    const writes = buildAggregatedStatsWrites(
        [{ id: 'player-a', name: 'Player A', number: '12' }],
        ['PTS', 'REB'],
        {
            'player-a': { PTS: 5, REB: 3 }
        }
    );

    assertDeepEquals(
        writes[0].data.stats,
        { pts: 5, reb: 3 },
        'Configured stat values should survive uppercase source keys when config columns normalize to lowercase'
    );
});

test('mixed-case configured stat keys are normalized without losing values', () => {
    const writes = buildAggregatedStatsWrites(
        [{ id: 'player-a', name: 'Player A', number: '12' }],
        ['PTS', 'REB', 'AST'],
        {
            'player-a': { PTS: 8, ReB: 5, ast: 2 }
        }
    );

    assertDeepEquals(
        writes[0].data.stats,
        { pts: 8, reb: 5, ast: 2 },
        'Configured stat values should survive mixed-case source keys without duplicate variants'
    );
});

test('existing non-config stat keys are preserved', () => {
    const writes = buildAggregatedStatsWrites(
        [{ id: 'player-a', name: 'Player A', number: '12' }],
        ['PTS', 'REB'],
        {
            'player-a': { pts: 8, reb: 5, blocks: 3 }
        }
    );

    assertDeepEquals(
        writes[0].data.stats,
        { pts: 8, reb: 5, blocks: 3 },
        'Unexpected stat keys should be preserved when saving'
    );
});

const failed = results.filter((result) => !result.pass);
results.forEach((result) => {
    if (result.pass) {
        console.log(`PASS ${result.name}`);
        return;
    }
    console.error(`FAIL ${result.name}`);
    console.error(result.error);
});

if (failed.length > 0) {
    process.exit(1);
}

console.log(`All ${results.length} tests passed.`);
