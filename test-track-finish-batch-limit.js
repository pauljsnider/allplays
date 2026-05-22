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

function buildFinishWritePlan(gameLogEntries, aggregatedStatsWrites, maxEventBatchWrites = 500, maxAggregatedStatsBatchWrites = 450) {
    const eventBatchSizes = [];
    for (let i = 0; i < gameLogEntries.length; i += maxEventBatchWrites) {
        eventBatchSizes.push(gameLogEntries.slice(i, i + maxEventBatchWrites).length);
    }

    const aggregatedStatsBatchSizes = [];
    for (let i = 0; i < aggregatedStatsWrites.length; i += maxAggregatedStatsBatchWrites) {
        aggregatedStatsBatchSizes.push(
            aggregatedStatsWrites.slice(i, i + maxAggregatedStatsBatchWrites).length
        );
    }

    return {
        eventBatchSizes,
        aggregatedStatsBatchSizes,
        gameUpdateBatchSize: 1
    };
}

test('keeps roster-wide aggregated stats writes out of event finish batches', () => {
    const plan = buildFinishWritePlan(
        new Array(490).fill({}),
        new Array(25).fill({})
    );

    assertDeepEquals(
        plan.eventBatchSizes,
        [490],
        'Event writes should be committed separately from stats and final game update'
    );
    assertDeepEquals(
        plan.aggregatedStatsBatchSizes,
        [25],
        'Roster-wide aggregated stats should be committed in a separate batch'
    );
});

test('chunks aggregated stats writes into sub-500 secondary batches', () => {
    const plan = buildFinishWritePlan(
        new Array(499).fill({}),
        new Array(905).fill({})
    );

    assertDeepEquals(
        plan.eventBatchSizes,
        [499],
        'Event batch should remain commit-safe at 499 event writes'
    );
    assertDeepEquals(
        plan.aggregatedStatsBatchSizes,
        [450, 450, 5],
        'Large roster-wide aggregated stats writes should be split across multiple secondary batches'
    );
    plan.aggregatedStatsBatchSizes.forEach((size) => {
        if (size > 450) {
            throw new Error(`Secondary batch exceeded the configured write cap: ${size}`);
        }
    });
});

test('chunks event writes when event count exceeds Firestore batch limit', () => {
    const plan = buildFinishWritePlan(
        new Array(1001).fill({}),
        new Array(25).fill({})
    );

    assertDeepEquals(
        plan.eventBatchSizes,
        [500, 500, 1],
        'Event writes over 500 should be split across multiple batches'
    );
    assertDeepEquals(
        plan.aggregatedStatsBatchSizes,
        [25],
        'Aggregated stats should still be planned after event chunking'
    );
    assertEquals(
        plan.gameUpdateBatchSize,
        1,
        'Final game completion update should be committed in its own batch'
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
