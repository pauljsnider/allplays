import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSportPeriodLabels } from '../../js/live-sport-config.js';

const liveTrackerHtml = readFileSync(new URL('../../live-tracker.html', import.meta.url), 'utf8');
const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');

describe('live tracker period selector', () => {
    it('keeps overtime and extra-period sport labels available in config', () => {
        expect(getSportPeriodLabels({ sport: 'soccer' })).toEqual(['H1', 'H2', 'ET1', 'ET2', 'PK']);
        expect(getSportPeriodLabels({ sport: 'basketball' })).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT']);
    });

    it('renders period buttons from configured labels instead of a four-button template', () => {
        expect(liveTrackerHtml).toContain('id="period-buttons"');
        expect(liveTrackerHtml).not.toContain('data-period="Q1"');
        expect(liveTrackerSource).not.toContain('.slice(0, 5)');
        expect(liveTrackerSource).toContain('const resolvedLabels = labels.length ? labels : [fallbackLabel];');
        expect(liveTrackerSource).toContain('els.periodButtons.innerHTML = resolvedLabels.map((label) => `');
        expect(liveTrackerSource).toContain("button.addEventListener('click', () => setPeriod(button.dataset.period));");
    });
});
