import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const cardHtml = readFileSync('services/chatgpt-mcp/src/ui/schedule-card.html', 'utf8');
const serverJs = readFileSync('services/chatgpt-mcp/src/server.js', 'utf8');

describe('chatgpt-mcp ui: schedule card template', () => {
    it('renders from the Apps SDK runtime, not the network', () => {
        expect(cardHtml).toContain('window.openai');
        expect(cardHtml).toContain('toolOutput');
        expect(cardHtml).toContain('openai:set_globals');
        expect(cardHtml).not.toMatch(/fetch\(|XMLHttpRequest/);
    });

    it('inserts dynamic data safely via textContent only', () => {
        expect(cardHtml).toContain('textContent');
        expect(cardHtml).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/);
    });

    it('wires RSVP follow-up prompts and deep-link actions', () => {
        expect(cardHtml).toContain('sendFollowUpMessage');
        expect(cardHtml).toContain('Set my RSVP for ');
        expect(cardHtml).toContain('openExternal');
        expect(cardHtml).toContain('google.com/maps/search');
    });

    it('covers every RSVP state and the empty state', () => {
        for (const cls of ['going', 'maybe', 'not_going', 'not_responded']) {
            expect(cardHtml).toContain(`badge.${cls}`);
        }
        expect(cardHtml).toContain('No games or practices in this range');
    });

    it('supports light and dark themes', () => {
        expect(cardHtml).toContain('.dark');
        expect(cardHtml).toContain('prefers-color-scheme: dark');
    });
});

describe('chatgpt-mcp ui: server wiring', () => {
    it('registers the card as a skybridge resource', () => {
        expect(serverJs).toContain("registerResource('allplays-schedule-card'");
        expect(serverJs).toContain('text/html+skybridge');
        expect(serverJs).toContain('ui://widget/allplays-schedule.html');
    });

    it('attaches the output template to list_schedule', () => {
        const listScheduleBlock = serverJs.slice(serverJs.indexOf("registerTool('list_schedule'"));
        expect(listScheduleBlock).toContain("'openai/outputTemplate': SCHEDULE_CARD_URI");
        expect(listScheduleBlock).toContain('openai/toolInvocation/invoking');
    });
});
