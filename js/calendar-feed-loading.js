function waitForCalendarImportCapacity() {
    return new Promise((resolve) => setTimeout(resolve, 250));
}

export async function fetchLegacyCalendarFeed(calUrl, fetchCalendar, waitForCapacity = waitForCalendarImportCapacity) {
    while (true) {
        try {
            return await fetchCalendar(calUrl);
        } catch (error) {
            if (error?.code !== 'CALENDAR_IMPORT_QUEUE_FULL') {
                throw error;
            }
            await waitForCapacity();
        }
    }
}
