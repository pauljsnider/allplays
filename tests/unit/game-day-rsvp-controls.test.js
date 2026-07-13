import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createGameDayRsvpController } from '../../js/game-day-rsvp-controls.js';

class MockElement {
    constructor(id = '', documentRef = null) {
        this.id = id;
        this._innerHTML = '';
        this.textContent = '';
        this.documentRef = documentRef;
    }

    set innerHTML(value) {
        this._innerHTML = value;
        if (this.documentRef && value.includes('id="coach-rsvp-status"')) {
            this.documentRef.elements.set('coach-rsvp-status', new MockElement('coach-rsvp-status', this.documentRef));
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }
}

function createDocumentRef() {
    const documentRef = {
        elements: new Map(),
        getElementById(id) {
            return this.elements.get(id) || null;
        }
    };
    documentRef.elements.set('rsvp-panel', new MockElement('rsvp-panel', documentRef));
    return documentRef;
}

describe('game day RSVP controls', () => {
    it('moves a player between sections, updates counts, and shows Saved on the current status element', async () => {
        const documentRef = createDocumentRef();
        const state = {
            teamId: 'team-1',
            gameId: 'game-1',
            user: { uid: 'coach-1', displayName: 'Coach One' },
            rsvpBreakdown: {
                going: [],
                maybe: [],
                not_going: [],
                not_responded: [
                    { playerId: 'p1', playerName: 'Avery', playerNumber: '7', response: 'not_responded' }
                ]
            }
        };
        const submitRsvpForPlayer = vi.fn(async (_teamId, _gameId, _userId, payload) => payload);
        const loadRsvps = vi.fn(async () => {
            const latestResponse = submitRsvpForPlayer.mock.calls.at(-1)?.[3]?.response;
            state.rsvpBreakdown = {
                going: latestResponse === 'going'
                    ? [{ playerId: 'p1', playerName: 'Avery', playerNumber: '7', response: 'going' }]
                    : [],
                maybe: latestResponse === 'maybe'
                    ? [{ playerId: 'p1', playerName: 'Avery', playerNumber: '7', response: 'maybe' }]
                    : [],
                not_going: latestResponse === 'not_going'
                    ? [{ playerId: 'p1', playerName: 'Avery', playerNumber: '7', response: 'not_going' }]
                    : [],
                not_responded: latestResponse
                    ? []
                    : [{ playerId: 'p1', playerName: 'Avery', playerNumber: '7', response: 'not_responded' }]
            };
        });
        const controller = createGameDayRsvpController({
            state,
            documentRef,
            escapeHtml: (value) => String(value ?? ''),
            submitRsvpForPlayer,
            loadRsvps,
            setTimeoutFn: vi.fn()
        });

        controller.renderRsvpPanel();
        expect(documentRef.getElementById('rsvp-panel').innerHTML).toContain('No Response (1)');

        await controller.setCoachPlayerRsvp('p1', 'going');
        expect(documentRef.getElementById('rsvp-panel').innerHTML).toContain('Going (1)');
        expect(documentRef.getElementById('coach-rsvp-status').textContent).toBe('Saved');

        await controller.setCoachPlayerRsvp('p1', 'maybe');
        expect(documentRef.getElementById('rsvp-panel').innerHTML).toContain('Maybe (1)');
        expect(documentRef.getElementById('coach-rsvp-status').textContent).toBe('Saved');

        await controller.setCoachPlayerRsvp('p1', 'not_going');
        expect(documentRef.getElementById('rsvp-panel').innerHTML).toContain('Not Going (1)');
        expect(documentRef.getElementById('coach-rsvp-status').textContent).toBe('Saved');

        expect(submitRsvpForPlayer).toHaveBeenNthCalledWith(1, 'team-1', 'game-1', 'coach-1', {
            displayName: 'Coach One',
            playerId: 'p1',
            response: 'going'
        });
        expect(submitRsvpForPlayer).toHaveBeenNthCalledWith(2, 'team-1', 'game-1', 'coach-1', {
            displayName: 'Coach One',
            playerId: 'p1',
            response: 'maybe'
        });
        expect(submitRsvpForPlayer).toHaveBeenNthCalledWith(3, 'team-1', 'game-1', 'coach-1', {
            displayName: 'Coach One',
            playerId: 'p1',
            response: 'not_going'
        });
    });

    it('renders escaped identities for responses that are not linked to roster players', () => {
        const documentRef = createDocumentRef();
        const controller = createGameDayRsvpController({
            state: {
                rsvpBreakdown: {
                    going: [],
                    maybe: [],
                    not_going: [],
                    not_responded: [],
                    unmatchedResponders: [{
                        responderUserId: 'parent-1',
                        responderName: '<Parent One>',
                        response: 'maybe'
                    }]
                }
            },
            documentRef,
            escapeHtml: (value) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
            submitRsvpForPlayer: vi.fn(),
            loadRsvps: vi.fn()
        });

        controller.renderRsvpPanel();

        const html = documentRef.getElementById('rsvp-panel').innerHTML;
        expect(html).toContain('Unmatched parent responses (1)');
        expect(html).toContain('&lt;Parent One&gt; — Maybe');
        expect(html).not.toContain('<Parent One>');
    });
});

describe('game day RSVP wiring', () => {
    it('imports the RSVP controller helper and exports the click handler from that controller', () => {
        const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

        expect(source).toContain("import { createGameDayRsvpController } from './js/game-day-rsvp-controls.js?v=2';");
        expect(source).toContain('const gameDayRsvpController = createGameDayRsvpController({');
        expect(source).toContain('window.setCoachPlayerRsvp = gameDayRsvpController.setCoachPlayerRsvp;');
        expect(source).toContain('gameDayRsvpController.renderRsvpPanel();');
        expect(source).toContain('unmatchedResponders: Array.isArray(breakdown.unmatchedResponders)');
    });

    it('loads RSVP context for all-confirmed streaming team permissions', () => {
        const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

        expect(source).toContain("String(team.teamPermissions?.streaming?.mode || '').toLowerCase() === 'all_confirmed'");
    });
});
