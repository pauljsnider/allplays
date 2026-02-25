export function buildDrillDiagramUploadPaths(drillId, fileName, ts = Date.now()) {
    const safeDrillId = String(drillId || 'unknown').replace(/[^\w.\-]+/g, '_');
    const safeName = String(fileName || 'diagram').replace(/[^\w.\-]+/g, '_');

    return {
        imagePath: `drill-diagrams/${safeDrillId}/${ts}_${safeName}`,
        fallbackPath: `stat-sheets/${ts}_drill_${safeDrillId}_${safeName}`
    };
}
