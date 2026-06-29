export function createAthleteProfileAuthLoader(loadProfile) {
    let hasLoadedWithoutUser = false;
    let hasLoadedWithUser = false;

    return function handleAthleteProfileAuthChange(user) {
        if (user) {
            if (hasLoadedWithUser) return;
            hasLoadedWithUser = true;
            loadProfile(user);
            return;
        }

        if (hasLoadedWithoutUser || hasLoadedWithUser) return;
        hasLoadedWithoutUser = true;
        loadProfile(null);
    };
}
