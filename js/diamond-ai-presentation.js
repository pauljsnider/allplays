function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBlock(value) {
    const source = asRecord(value);
    const text = String(source.text || '').trim().slice(0, 2400);
    if (!text) return null;
    const seen = new Set();
    const citations = (Array.isArray(source.citations) ? source.citations : []).flatMap((entry) => {
        const citation = asRecord(entry);
        const eventId = String(citation.eventId || '').trim();
        const revision = Number(citation.revision);
        const key = `${eventId}:${revision}`;
        if (!eventId || eventId.length > 128 || eventId.includes('/') || !Number.isSafeInteger(revision) || revision < 1 || seen.has(key)) return [];
        seen.add(key);
        return [{ eventId, revision }];
    }).slice(0, 30);
    return citations.length ? { text, citations } : null;
}

export function normalizePublishedDiamondAiArtifact(value, authoritativeRevision = null) {
    const source = asRecord(value);
    const recap = normalizeBlock(source.recap);
    const sourceRevision = Number(source.sourceRevision);
    if (
        source.schemaVersion !== 1 ||
        source.trackingEngine !== 'diamond-v2' ||
        source.published !== true ||
        !recap ||
        !Number.isSafeInteger(sourceRevision) ||
        sourceRevision < 1
    ) return null;

    const normalizedAuthoritativeRevision = Number(authoritativeRevision);
    const hasAuthoritativeRevision = Number.isSafeInteger(normalizedAuthoritativeRevision) && normalizedAuthoritativeRevision >= 0;
    return {
        current: source.status === 'current' &&
            source.stale !== true &&
            (!hasAuthoritativeRevision || sourceRevision === normalizedAuthoritativeRevision),
        sourceRevision,
        recap,
        insights: (Array.isArray(source.insights) ? source.insights : [])
            .map(normalizeBlock)
            .filter(Boolean)
            .slice(0, 10),
        coverage: Object.entries(asRecord(source.coverage)).reduce((result, [family, status]) => {
            if (status === 'complete' || status === 'partial' || status === 'not_collected') {
                result[String(family).slice(0, 40)] = status;
            }
            return result;
        }, {}),
        dataQualityNotes: (Array.isArray(source.dataQualityNotes) ? source.dataQualityNotes : [])
            .map((note) => String(note || '').trim().slice(0, 300))
            .filter(Boolean)
            .slice(0, 20)
    };
}
