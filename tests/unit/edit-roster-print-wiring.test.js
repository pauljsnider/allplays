import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve('edit-roster.html'), 'utf8');

describe('edit roster print wiring', () => {
    it('renders a current roster print button and imports the print helper', () => {
        expect(html).toContain('id="print-roster-btn"');
        expect(html).toContain('Print Roster');
        expect(html).toContain("import { buildRosterPrintHtml } from './js/roster-print.js?v=1';");
    });

    it('clicking print roster builds content before calling window.print and blocks empty rosters', () => {
        expect(html).toContain("document.getElementById('print-roster-btn').addEventListener('click', handlePrintRoster)");
        expect(html).toContain('const { html, model } = buildRosterPrintHtml');
        expect(html).toContain('if (model.activeCount === 0)');
        expect(html).toContain('No active roster players to print.');
        expect(html.indexOf('printRoot.innerHTML = html')).toBeLessThan(html.indexOf('window.print();'));
    });
});
