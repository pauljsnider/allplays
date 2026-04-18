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

function buildFinishWritePlan(gameLogEntries, aggregatedStatsWrites, maxAggregatedStatsBatchWrites = 450) {
    const primaryBatchWriteCount = gameLogEntries.length + 1;
    const canCommitPrimaryBatch = primaryBatchWriteCount <= 500;
    const aggregatedStatsBatchSizes = [];

    if (canCommitPrimaryBatch) {
        for (let i = 0; i < aggregatedStatsWrites.length; i += maxAggregatedStatsBatchWrites) {
            aggregatedStatsBatchSizes.push(
                aggregatedStatsWrites.slice(i, i + maxAggregatedStatsBatchWrites).length
            );
        }
    }

    return {
        primaryBatchWriteCount,
        canCommitPrimaryBatch,
        aggregatedStatsBatchSizes
    };
}

test('keeps roster-wide aggregated stats writes out of the primary finish batch', () => {
    const plan = buildFinishWritePlan(
        new Array(490).fill({}),
        new Array(25).fill({})
    );

    assertEquals(
        plan.primaryBatchWriteCount,
        491,
        'Primary finish batch should only contain game-log writes plus the final game update'
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

    assertEquals(
        plan.canCommitPrimaryBatch,
        true,
        'Primary batch should remain commit-safe at 499 event writes plus the game update'
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

test('fails cleanly before writing secondary batches when the primary batch would overflow', () => {
    const plan = buildFinishWritePlan(
        new Array(500).fill({}),
        new Array(25).fill({})
    );

    assertEquals(
        plan.primaryBatchWriteCount,
        501,
        '500 event writes plus the final game update should exceed Firestore batch limits'
    );
    assertEquals(
        plan.canCommitPrimaryBatch,
        false,
        'Primary batch should be rejected before any secondary aggregated stats batches are committed'
    );
    assertDeepEquals(
        plan.aggregatedStatsBatchSizes,
        [],
        'No secondary aggregated stats batches should be planned when the primary batch is already unsafe'
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
