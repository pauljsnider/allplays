export async function persistThenPublishLiveLineup({ persistLineup, publishLineup, shouldPublish = false } = {}) {
    if (typeof persistLineup !== 'function') {
        throw new TypeError('A lineup persistence function is required.');
    }

    await persistLineup();

    if (shouldPublish && typeof publishLineup === 'function') {
        await publishLineup();
    }
}
