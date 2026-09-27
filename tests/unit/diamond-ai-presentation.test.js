import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizePublishedDiamondAiArtifact } from '../../js/diamond-ai-presentation.js';

describe('Diamond AI report presentation', () => {
    const artifact = {
        schemaVersion: 1,
        trackingEngine: 'diamond-v2',
        published: true,
        status: 'current',
        stale: false,
        sourceRevision: 12,
        recap: { text: 'Falcons won 4-3.', citations: [{ eventId: 'event-12', revision: 12 }] },
        insights: [{ text: 'Avery had 2 hits.', citations: [{ eventId: 'event-8', revision: 8 }] }],
        coverage: { batting: 'complete', fielding: 'partial', sensors: 'not_collected' },
        dataQualityNotes: ['Fielding detail was partial.']
    };

    it('keeps only bounded cited public content at the authoritative revision', () => {
        expect(normalizePublishedDiamondAiArtifact(artifact, 12)).toMatchObject({
            current: true,
            sourceRevision: 12,
            recap: { text: 'Falcons won 4-3.' },
            insights: [{ text: 'Avery had 2 hits.' }]
        });
        expect(normalizePublishedDiamondAiArtifact(artifact, 13)).toMatchObject({ current: false });
    });

    it('rejects unpublished, uncited, and non-Diamond values', () => {
        expect(normalizePublishedDiamondAiArtifact({ ...artifact, published: false }, 12)).toBeNull();
        expect(normalizePublishedDiamondAiArtifact({ ...artifact, recap: { text: 'No source', citations: [] } }, 12)).toBeNull();
        expect(normalizePublishedDiamondAiArtifact({ ...artifact, trackingEngine: 'legacy' }, 12)).toBeNull();
    });

    it('wires the legacy report to the same correction-aware presentation boundary', () => {
        const html = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
        expect(html).toContain("import { normalizePublishedDiamondAiArtifact } from './js/diamond-ai-presentation.js?v=1';");
        expect(html).toContain('id="published-diamond-ai-recap"');
        expect(html).toContain('The old recap is hidden until a manager publishes a new cited draft.');
        expect(html).toContain('escapeHtml(publishedAiRecap.recap.text)');
    });
});
