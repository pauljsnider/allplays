export function createAthleteProfileAuthLoader(loadProfile) {
    let hasLoadedWithoutUser = false;
    let hasLoadedWithUser = false;
    let latestLoadId = 0;

    function startLoad(user) {
        latestLoadId += 1;
        const loadId = latestLoadId;
        loadProfile(user, () => loadId === latestLoadId);
    }

    return function handleAthleteProfileAuthChange(user) {
        if (user) {
            if (hasLoadedWithUser) return;
            hasLoadedWithUser = true;
            startLoad(user);
            return;
        }

        if (hasLoadedWithoutUser || hasLoadedWithUser) return;
        hasLoadedWithoutUser = true;
        startLoad(null);
    };
}
