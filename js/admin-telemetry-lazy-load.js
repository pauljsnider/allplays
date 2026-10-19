export async function reloadTelemetryDashboard({
    loadTelemetryData,
    updateTelemetryDashboard
}) {
    await loadTelemetryData();
    updateTelemetryDashboard();
}

export async function loadTelemetryOnTabActivation({
    tab,
    telemetryState,
    loadTelemetryData,
    updateTelemetryDashboard
}) {
    if (tab !== 'telemetry' || telemetryState.loaded || telemetryState.loading) {
        return false;
    }

    await reloadTelemetryDashboard({ loadTelemetryData, updateTelemetryDashboard });
    return true;
}
