import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAISummaryEnabled } from '../../js/track-ai-summary.js';

describe('track finish modal AI summary gating', () => {
  it('requires explicit enablement for AI summary', () => {
    expect(isAISummaryEnabled()).toBe(false);
    expect(isAISummaryEnabled(true)).toBe(true);
    expect(isAISummaryEnabled(false)).toBe(false);
  });

  it('wires AI summary behind an availability gate', () => {
    const source = readFileSync(new URL('../../track.html', import.meta.url), 'utf8');

    expect(source).toContain("import { isAISummaryEnabled, applyAISummaryAvailability } from './js/track-ai-summary.js';");
    expect(source).toContain('const aiSummaryEnabled = isAISummaryEnabled();');
    expect(source).toContain('applyAISummaryAvailability({');
    expect(source).toContain('if (aiSummaryEnabled) {');
    expect(source).toContain("document.getElementById('generateAISummary').addEventListener('click', generateAIMatchReport);");
  });
});
