import { hasPlayerProfileParticipation } from '../player-profile-stats.js';

function runTest(name, testFn) {
    try {
        testFn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        console.error(error);
        process.exit(1); // Exit with error on failure
    }
}

// Test Suite for hasPlayerProfileParticipation
console.log('Running tests for hasPlayerProfileParticipation...');

runTest('should return false if didNotPlay is true, regardless of other fields', () => {
    // Case 1: didNotPlay true, participationStatus unused
    let result = hasPlayerProfileParticipation({ didNotPlay: true, participationStatus: 'unused' });
    console.assert(result === false, 'Test Case 1 failed: didNotPlay true, unused status');

    // Case 2: didNotPlay true, participated true (should still be false)
    result = hasPlayerProfileParticipation({ didNotPlay: true, participated: true });
    console.assert(result === false, 'Test Case 2 failed: didNotPlay true, participated true');

    // Case 3: didNotPlay true, timeMs > 0 (should still be false)
    result = hasPlayerProfileParticipation({ didNotPlay: true, timeMs: 1000 });
    console.assert(result === false, 'Test Case 3 failed: didNotPlay true, timeMs > 0');

    // Case 4: didNotPlay true, with stats (should still be false)
    result = hasPlayerProfileParticipation({ didNotPlay: true, stats: { points: 5 } });
    console.assert(result === false, 'Test Case 4 failed: didNotPlay true, with stats');
});

runTest('should return true if participated is true', () => {
    const result = hasPlayerProfileParticipation({ participated: true });
    console.assert(result === true, 'Test Case 5 failed: participated true');
});

runTest('should return true if participationStatus is "appeared"', () => {
    const result = hasPlayerProfileParticipation({ participationStatus: 'appeared' });
    console.assert(result === true, 'Test Case 6 failed: participationStatus appeared');
});

runTest('should return true if timeMs > 0', () => {
    const result = hasPlayerProfileParticipation({ timeMs: 100 });
    console.assert(result === true, 'Test Case 7 failed: timeMs > 0');
});

runTest('should return true if any stat value is non-zero', () => {
    const result = hasPlayerProfileParticipation({ stats: { points: 5, assists: 0 } });
    console.assert(result === true, 'Test Case 8 failed: non-zero stat');
});

runTest('should return false for empty statData (no participation)', () => {
    const result = hasPlayerProfileParticipation({});
    console.assert(result === false, 'Test Case 9 failed: empty statData');
});

runTest('should return false if no explicit participation and no stats', () => {
    const result = hasPlayerProfileParticipation({ participated: false, timeMs: 0, stats: { points: 0 } });
    console.assert(result === false, 'Test Case 10 failed: no explicit participation');
});

runTest('should return true if participationStatus is "unused" but didNotPlay is not true and other participation exists (post-fix behavior)', () => {
    // This tests the behavior *after* the fix, where 'unused' itself no longer triggers false,
    // so if other participation *would* trigger true, it now will.
    // Example: if 'unused' but also 'timeMs: 100' -- previously 'unused' would short-circuit to false.
    // Now, with the 'unused' check removed, timeMs > 0 should make it true.
    let result = hasPlayerProfileParticipation({ participationStatus: 'unused', timeMs: 100 });
    console.assert(result === true, 'Test Case 11 failed: unused status with timeMs > 0 (expected true after fix)');

    result = hasPlayerProfileParticipation({ participationStatus: 'unused', participated: true });
    console.assert(result === true, 'Test Case 12 failed: unused status with participated: true (expected true after fix)');

    result = hasPlayerProfileParticipation({ participationStatus: 'unused', stats: { points: 1 } });
    console.assert(result === true, 'Test Case 13 failed: unused status with stats (expected true after fix)');
});

runTest('should return false if participationStatus is "unused" and no other participation exists', () => {
    // This case would have returned false before, and still returns false after,
    // but now by falling through to the default logic.
    const result = hasPlayerProfileParticipation({ participationStatus: 'unused', timeMs: 0, stats: {} });
    console.assert(result === false, 'Test Case 14 failed: unused status with no other participation');
});
