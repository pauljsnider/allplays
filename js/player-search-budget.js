export const playerSearchResultLimit = 20;
export const playerSearchFirestoreQueryBudget = 12;

export async function executeBoundedPlayerSearch({
    teamIds,
    prefixes,
    rawQuery,
    isNumeric,
    runNameQuery,
    runNumberQuery,
    queryLimit = playerSearchResultLimit,
    queryBudget = playerSearchFirestoreQueryBudget
}) {
    const snapshots = [];
    const seenPaths = new Set();
    let nameQueryCount = 0;
    let queriesUsed = 0;
    let completedAllQueries = true;

    const runQuery = async (loadQuery, { countsTowardNameBudget = false } = {}) => {
        if (queriesUsed >= queryBudget || seenPaths.size >= queryLimit) {
            completedAllQueries = false;
            return false;
        }

        queriesUsed += 1;
        if (countsTowardNameBudget) {
            nameQueryCount += 1;
        }

        try {
            const value = await loadQuery();
            snapshots.push({ status: 'fulfilled', value });
            for (const doc of value?.docs || []) {
                seenPaths.add(doc?.ref?.path || doc?.id || `${queriesUsed}:${seenPaths.size}`);
            }
        } catch (reason) {
            snapshots.push({ status: 'rejected', reason });
        }

        return true;
    };

    for (const teamId of teamIds) {
        for (const prefix of prefixes) {
            const didRun = await runQuery(() => runNameQuery(teamId, prefix), { countsTowardNameBudget: true });
            if (!didRun) {
                return { snapshots, nameQueryCount, completedAllQueries, queriesUsed };
            }
            if (seenPaths.size >= queryLimit) {
                completedAllQueries = false;
                return { snapshots, nameQueryCount, completedAllQueries, queriesUsed };
            }
        }

        if (!isNumeric) continue;

        const didRun = await runQuery(() => runNumberQuery(teamId, rawQuery));
        if (!didRun) {
            return { snapshots, nameQueryCount, completedAllQueries, queriesUsed };
        }
        if (seenPaths.size >= queryLimit) {
            completedAllQueries = false;
            return { snapshots, nameQueryCount, completedAllQueries, queriesUsed };
        }
    }

    return { snapshots, nameQueryCount, completedAllQueries, queriesUsed };
}
