import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('track-statsheet summary save behavior', () => {
    it('clears rejected generated summaries and saves only textarea content', () => {
        const source = readFileSync(new URL('../../track-statsheet.html', import.meta.url), 'utf8');

        expect(source).toContain("document.getElementById('cancel-summary-btn').addEventListener('click', hideSummaryPreview);");
        expect(source).toContain("document.getElementById('close-summary-preview').addEventListener('click', hideSummaryPreview);");
        expect(source).toMatch(/const hideSummaryPreview = \(\) => \{[\s\S]*generatedSummary = '';/);
        expect(source).toContain("const summaryText = document.getElementById('summary-notes').value.trim();");
        expect(source).not.toContain("|| generatedSummary.trim()");
    });
});
