import { describe, it, expect } from 'vitest';
import { appendLivePracticeNote } from '../../js/drills-live-practice-notes.js';

describe('live practice notes append helper', () => {
    it('appends live note to notesLog only and preserves authored notes', () => {
        const block = {
            notes: 'Coach setup reminder',
            notesLog: []
        };

        const appended = appendLivePracticeNote(block, 'Press quickly after loss', 'voice', '2026-02-27T01:25:00.000Z');

        expect(appended).toBe(true);
        expect(block.notesLog).toEqual([
            {
                type: 'voice',
                text: 'Press quickly after loss',
                createdAt: '2026-02-27T01:25:00.000Z'
            }
        ]);
        expect(block.notes).toBe('Coach setup reminder');
    });

    it('ignores empty text', () => {
        const block = { notes: 'x', notesLog: [] };
        const appended = appendLivePracticeNote(block, '   ', 'text');
        expect(appended).toBe(false);
        expect(block.notesLog).toEqual([]);
        expect(block.notes).toBe('x');
    });
});
